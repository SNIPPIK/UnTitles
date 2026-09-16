import { httpsClient, httpsStatusCode, Logger } from "#structures";
import { Track } from "#core/queue/index.js";
import { sdb } from "#db/worker";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Безопасное время для буферизации трека (сек).
 * @const TRACK_BUFFERED_TIME
 * @public
 */
export const TRACK_BUFFERED_TIME = 500;

/**
 * @author SNIPPIK
 * @description Ошибка временного характера: timeout, 5xx, обрыв соединения.
 * Не означает, что ссылка битая — её нужно просто повторить без сброса.
 * @class TransientError
 * @private
 */
class TransientError extends Error {
    public constructor(message: string) {
        super(message);
        // Имя нужно, чтобы отличать TransientError от прочих Error через instanceof.
        this.name = "TransientError";
    }
}

/**
 * @author SNIPPIK
 * @description Резолвер ресурсов с поддержкой экспоненциальной паузы между попытками.
 *
 * При ошибке резолвер различает два случая:
 * - TransientError — временный сбой, ссылка сохраняется и повторяется та же попытка;
 * - прочие ошибки — ссылка сбрасывается, следующая попытка запросит её заново
 *   через `prepare(track, attempt, refreshLink = true)`.
 *
 * @class ResourceProvider
 * @private
 */
class ResourceProvider<T extends Track> {
    public constructor(
        /**
         * Функция подготовки/получения ссылки на ресурс.
         *
         * @param track       — трек, для которого ищется ссылка.
         * @param attempt     — номер текущей попытки (начиная с 0).
         * @param hadLink     — при `true` требуется повтор ссылки у платформы
         *                      (после настоящей ошибки HEAD); при `false` можно
         *                      использовать существующую ссылку.
         */
        private readonly prepare: (track: T, attempt: number, hadLink: boolean) => Promise<string | Error>,
        private readonly options = { retries: 3, initialDelay: 70 }
    ) {};

    /**
     * @description Пытается разрешить путь к ресурсу, экспоненциально увеличивая паузу между попытками.
     *
     * # Аргументы
     * * `track` — трек, для которого нужно получить рабочий URL.
     *
     * # Возвращаемое значение
     * Строка с URL при успехе; объект `Error` при исчерпании попыток.
     *
     * # Побочные эффекты
     * Устанавливает `track.link` на успешный URL.
     * При ошибках обнуляет `track.link`, чтобы форсировать повтор.
     */
    public async resolve(track: T): Promise<string | Error> {
        let lastError: Error | string = "Unknown error";
        // true — на следующей попытке prepare должен обновить ссылку через API,
        // а не гонять полный поиск по платформам.
        let refreshLink = false;

        for (let attempt = 0; attempt < this.options.retries; attempt++) {
            // Пытаемся получить ссылку через prepare.
            const result = await this.prepare(track, attempt, refreshLink);

            // Успех: сохраняем ссылку в трек и возвращаем.
            if (typeof result === "string") {
                track.link = result;
                return result;
            }

            // Запоминаем ошибку на случай исчерпания попыток.
            lastError = result;

            if (result instanceof TransientError) {
                // Временный сбой — не трогаем ссылку, повторим ту же попытку.
                refreshLink = false;
            } else {
                // Настоящая ошибка: помечаем, что в следующий раз надо повторить,
                // и сбрасываем битую ссылку.
                refreshLink = !!track.link;
                track.link = null;
            }

            // Пауза с экспоненциальным ростом перед следующей попыткой.
            if (attempt < this.options.retries - 1) {
                const delay = this.options.initialDelay * Math.pow(2, attempt);
                await this.sleep(delay);
            }
        }

        // Возвращаем ошибку: сам объект Error или обёртку над строкой.
        return lastError instanceof Error
            ? lastError
            : Error(`[ResourceResolver]: Max retries reached. Last error: ${lastError}`);
    };

    /// Асинхронная пауза указанной длительности (мс).
    private sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @author SNIPPIK
 * @description Резолвер текстов треков.
 *
 * В отличие от `ResourceProvider`, тексты обычно получаются за одну попытку,
 * поэтому повторов и пауз здесь нет.
 *
 * @class LyricsProvider
 * @private
 */
class LyricsProvider<T extends Track> {
    public constructor(
        /**
         * Функция получения текста для трека.
         *
         * @param track — трек, для которого запрашиваются слова.
         * @returns Строка с текстом, `undefined`, если текста нет, или `Error` при сбое.
         */
        private readonly prepare: (track: T) => Promise<string | Error>,
    ) {};

    /**
     * @description Единственная попытка получить текст песни.
     *
     * # Аргументы
     * * `track` — целевой трек.
     *
     * # Возвращаемое значение
     * Текст, `undefined` при отсутствии, или `Error` при сетевой/серверной ошибке.
     */
    public async resolve(track: T): Promise<string | Error> {
        return this.prepare(track);
    };
}

/**
 * @author SNIPPIK
 * @description Набор провайдеров для разрешения ресурсов, связанных с треком:
 * аудиопоток (URL) и текст песни.
 *
 * `audio` — устойчивый провайдер с ретраями и корректировкой ссылки.
 * `lyrics` — одноразовый провайдер текста.
 *
 * @class TrackResolvers
 * @private
 */
export class TrackResolvers {
    public static providers = {
        /**
         * @description Провайдер аудио: проверяет кэш, при необходимости
         * запрашивает ссылку у платформы и валидирует её через HEAD.
         * @public
         */
        audio: new ResourceProvider(async (track, attempt, refreshLink) => {
            // Проверяем кэш сохранённого аудио.
            const status = await sdb.audio_saver?.status(track);
            if (status?.status === "ended") return status?.path;

            // Если ссылки нет — нужно её получить.
            if (!track.link) {
                // refreshLink — пришли сюда после НАСТОЯЩЕЙ ошибки HEAD →
                // нужен только повтор ссылки у исходной платформы.
                // Attempt < 1 — самая первая попытка, тоже пробуем родную платформу.
                const hasReply = refreshLink || attempt < 1;
                const songs = await db.api.fetchAudioLink(track, hasReply);

                if (songs instanceof Error) return songs;

                // Перебираем кандидатов, берём первый валидный.
                for (let trk of songs) {
                    if (trk instanceof Error) continue;

                    // Прокидываем путь для будущего симлинка.
                    (trk as any).similarTrackPath = status?.path;

                    // Проверяем доступность через HEAD.
                    const song = await this.head(trk);
                    if (song instanceof Error) continue;

                    // Переносим прокси и ссылку в исходный трек.
                    track.proxy = trk.api.proxy;
                    track.link = trk.link;
                    return song;
                }

                // Ни один кандидат не подошёл.
                return Error("Resource has not found");
            }

            // Ссылка уже есть и это HTTP-URL — валидируем через HEAD.
            if (track.link?.startsWith?.("http")) {
                (track as any).similarTrackPath = status?.path;
                const song = await this.head(track);

                // Если это TransientError — резолвер повторит ту же ссылку,
                // если настоящая ошибка — сбросит и пойдёт за новой.
                if (song instanceof Error) return song;

                track.link = song;
                return song;
            }

            // Локальный путь или иная не-HTTP ссылка — возвращаем как есть.
            return track.link;
        }),

        /**
         * @description Провайдер текста песни: запрос к lrclib.net по имени
         * исполнителя и названию трека.
         * @public
         */
        lyrics: new LyricsProvider(async (track) => {
            // Запрос к публичному API текстов.
            const api = await new httpsClient({
                url:
                    `https://lrclib.net/api/get` +
                    `?artist_name=${encodeURIComponent(track.artist.title)}` +
                    `&track_name=${encodeURIComponent(track.name)}`,
                userAgent: true,
                timeout: 10e3
            }).toJson;

            // Если получаем вместо данных ошибку — пробрасываем её.
            if (api instanceof Error) return api;

            // Если текст не найден.
            else if (api.statusCode === 404) return undefined;

            // Сохраняем текст в поле трека для последующего доступа.
            track["_lyrics"] = api?.syncedLyrics || api?.plainLyrics;

            // Отдаём вызывающему тексту.
            return api?.syncedLyrics || api?.plainLyrics;
        })
    };

    /**
     * @description Проверяет доступность аудио по URL через HEAD-запрос,
     * обрабатывает редиректы и при необходимости ставит трек в очередь на сохранение.
     *
     * # Аргументы
     * * `track` — трек со ссылкой и (опционально) прокси.
     *
     * # Возвращаемое значение
     * Актуальный URL при успехе; `Error` при настоящей ошибке или
     * `TransientError` при временном сбое.
     *
     * # Побочные эффекты
     * - обновляет `track.link` при редиректе;
     * - создаёт ссылку при локальной ссылке;
     * - добавляет трек в очередь сохранения, если `sdb.audio_saver` доступен.
     *
     * @private
     * @static
     */
    private static head = async (track: Track): Promise<string | Error> => {
        // Если вдруг попадет не ссылка — работаем как с локальным файлом.
        if (!track.link?.startsWith("http")) {
            // Делаем линковку.
            if (sdb.audio_saver) await sdb.audio_saver.symlink(track);
            return track.link;
        }

        // Создаём клиент HEAD-запроса; при наличии прокси — через агент.
        const client = new httpsClient({ url: track.link, agent: track.proxy ? sdb.proxy : null });
        const status = await client.toHead;

        // Клиент не получил ответа
        if (!status.statusCode) {
            const err = new TransientError(`HEAD transient failure: status=${status}, url=${track.link}`);
            Logger.log("WARN", err.message);
            return err;
        }

        // Преобразуем статус в понятную ошибку (или null).
        const error = httpsStatusCode.parse(status);

        // Если было перенаправление запроса — сохраняем актуальную ссылку.
        if (client.redirect) track.link = client.redirect;

        // Резолвер поймает это, обнулит ссылку и вызовет prepare снова.
        if (error) {
            Logger.log(
                "ERROR",
                `\nSource aborted\n` +
                `┌ Stack:    ${error}\n` +
                `├ Redirect: ${client.redirect}\n` +
                `└ URL:      ${track.link}`
            );

            return error;
        }

        // Ссылка валидна: можно ставить трек в очередь сохранения.
        if (sdb.audio_saver) sdb.audio_saver.add(track);
        return track.link;
    };
}