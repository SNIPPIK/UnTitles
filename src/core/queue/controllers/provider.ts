import { httpsClient, httpsStatusCode, Logger } from "#structures";
import { RestAPIAgent } from "#handler/rest";
import { Track } from "#core/queue";
import { sdb } from "#worker/db";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Время ожидания проверки трека
 * @const TRACK_CHECK_WAIT
 * @public
 */
export const TRACK_CHECK_WAIT = 10e3;

/**
 * @author SNIPPIK
 * @description Безопасное время для буферизации трека
 * @const TRACK_BUFFERED_TIME
 * @public
 */
export const TRACK_BUFFERED_TIME = 500;

/**
 * @author SNIPPIK
 * @description Резолвер ресурсов с поддержкой экспоненциальной паузы и защитой от утечек
 * @class ResourceResolver
 * @private
 */
export class ResourceProvider {
    constructor(
        private readonly prepare: (track: Track) => Promise<string | Error>,
        private readonly options = { retries: 2, initialDelay: 70 }
    ) {};

    /**
     * @description Пытается разрешить путь к ресурсу, плавно увеличивая паузы при ошибках
     * @public
     */
    public async resolve(track: Track): Promise<string | Error> {
        let lastError: Error | string = "Unknown error";

        for (let attempt = 0; attempt < this.options.retries; attempt++) {
            // Пытаемся подготовить ресурс
            const result = await this.prepare(track);

            // Если успех — сразу отдаем результат
            if (typeof result === "string") {
                track.link = result;
                return result;
            }

            // Если ошибка — логируем и готовимся к следующей попытке
            lastError = result;
            track.link = null; // Сбрасываем битую ссылку, чтобы prepare искал заново

            // Если это не последняя попытка — ждем (Exponential Backoff)
            if (attempt < this.options.retries - 1) {
                const delay = this.options.initialDelay * Math.pow(2, attempt);
                await this.sleep(delay);
            }
        }

        return lastError instanceof Error ? lastError : new Error(`[ResourceResolver]: Max retries reached. Last error: ${lastError}`);
    };

    private sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @author SNIPPIK
 * @description
 * @class TrackResolvers
 * @private
 */
export class TrackResolvers {
    protected static providers = {
        /**
         * @description Провайдеры для поддержания аудио и прочего
         * @public
         */
        audio: new ResourceProvider(async (track) => {
            const status = sdb.audio_saver?.status(track);

            // Проверка кеша (мгновенно)
            if (status?.status === "ended") return status.path;

            // Если ссылки нет — ищем через API
            if (!track.link) {
                const songs = await db.api.fetchAudioLink(track);

                if (songs instanceof Error) return songs;

                for (let trk of songs) {
                    if (trk instanceof Error) continue;

                    const song = await this.head(trk);
                    if (song instanceof Error) return song;

                    track.proxy = trk.api.proxy;
                    track.link = trk.link;
                    return song;
                }
                return new Error("Resource has not found");
            }

            // Проверяем HTTP HEAD (если это ссылка)
            if (track.link.startsWith("http")) {
                const song = await this.head(track);
                if (song instanceof Error) return song;
                return song;
            }

            return track.link;
        })
    };

    private static head = async (track: Track): Promise<string | Error> => {
        const client = new httpsClient({ url: track.link, agent: track.proxy ? RestAPIAgent : null, sessionTimeout: 5e3, timeout: 5e3 });
        const status = await client.toHead;
        const error = httpsStatusCode.parse(status);

        // Если было перенаправление запроса
        if (client.redirect) track.link = client.redirect;

        // Резолвер поймает это, обнулит ссылку и вызовет prepare снова
        if (error) {
            Logger.log(
                "ERROR",
                `\nUnhandled Rejection Track\n` +
                `┌ Stack:    ${error}\n` +
                `├ Redirect: ${client.redirect}\n` +
                `└ URL:      ${track.link}`
            );

            return error;
        }

        // Если можно сохранять аудио
        if (sdb.audio_saver) sdb.audio_saver.add(track);
        return track.link;
    };
}