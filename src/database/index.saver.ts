import type { APIRequestData } from "#handler/rest/index.js";
import { Logger, PromiseCycle } from "#structures";
import { Process } from "#core/audio/process.js";
import { Track } from "#core/queue/index.js";
import afs from "node:fs/promises";
import { env } from "#app/env";
import path from "node:path";
import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Утилита для скачивания метаданных треков
 * @class MetaSaver
 * @public
 */
export class MetaSaver<T extends APIRequestData.Track | APIRequestData.List> {
    /** Можно ли сохранять файлы */
    public inFile = env.get("cache.file") as boolean;

    /** Путь до директории с кешированными данными */
    public _dirname = path.resolve(env.get("cache.dir"));

    /**
     * @description Сохраняем трек в локальную базу данных
     * @param track - Кешируемый трек
     * @param api - Ссылка на платформу
     * @returns void
     * @public
     */
    public set = (track: T, api: string) => queueMicrotask(async () => {
        // Если можно сохранять в файлы
        if (this.inFile) {
            const Path = path.join(this._dirname, "Data", api, `${track.id}.json`);

            if (Path && !fs.existsSync(Path)) {
                try {
                    const dirPath = path.dirname(Path);
                    await afs.mkdir(dirPath, { recursive: true });

                    // Записываем данные в файл
                    await afs.writeFile(Path, JSON.stringify(track, null, 2), "utf-8");
                } catch (error) {
                    console.error("Failed to write track cache:", error);
                }
            }
        }

        return null;
    });

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     * @returns T
     * @public
     */
    public get = (ID: string): T => {
        // Если можно сохранять в файлы
        if (this.inFile) {
            // Если есть трек в кеше
            if (fs.existsSync(`${this._dirname}/Data/${ID}.json`)) {
                try {
                    // Если трек кеширован в файл
                    const json = JSON.parse(fs.readFileSync(`${this._dirname}/Data/${ID}.json`, "utf8"));

                    // Если трек был найден среди файлов
                    if (json) return json?.track ?? json;
                } catch {
                    return null;
                }
            }
        }

        return null;
    };
}

/**
 * @author SNIPPIK
 * @description Утилита для скачивания аудио данных
 * @class AudioSaver
 * @extends PromiseCycle<Track>
 * @public
 */
export class AudioSaver extends PromiseCycle<Track> {
    /** Путь до директории с кешированными данными */
    public _dirname = path.resolve(env.get("cache.dir"));

    public constructor() {
        super({
            duration: 30e3,
            custom: {
                push: (track) => {
                    // Удаляем дубликаты по URL (асинхронно, чтобы избежать мутации во время итерации)
                    setImmediate(() => {
                        const duplicates = this.filter(t => t.url === track.url);
                        for (let i = 1; i < duplicates.length; i++) {
                            this.delete(duplicates[i]);
                        }
                    })
                }
            },
            filter: async (item) => {
                const names = await this.status(item);

                // Если такой трек уже есть в системе кеширования
                if (names.status === "ended" || item.time.total > 500 || item.time.total === 0 || item.api.type === "technical") {
                    this.delete(item);
                    return false;
                }

                // Если нет директории то, создаем ее
                else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");
                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    await afs.mkdir(dirs.join("/"), { recursive: true });
                }

                return true;
            },
            execute: (track) => this.lowPriorityExecute(track)
        });
    }

    /**
     * Опускаем приоритет задачи в самый низ очереди Event Loop
     */
    private lowPriorityExecute = async(track: Track): Promise<boolean> => this.download(track);

    /**
     * Загружает аудиофайл, соответствующий треку, с использованием ffmpeg.
     *
     * Основной метод процесса сохранения аудио:
     * 1. Вычисляет целевой путь к файлу через `this.status(track)`.
     * 2. Пытается создать символическую ссылку (если трек уже имеет локальную копию).
     * 3. Если `track.link` — удалённый URL, запускает ffmpeg для скачивания и конвертации в opus.
     *    Скачанный временный файл `.tmp` по завершении перемещается в целевой путь.
     * 4. Для удалённых файлов, у которых задан `similarTrackPath`, после успешного скачивания
     *    создаётся символическая ссылка с обновлённым локальным путём.
     *
     * **Возвращаемое значение:**
     * - Для локальных файлов (`link` начинается с `/` или содержит `:\\`) — **синхронно `false`**,
     *   так как скачивание не требуется.
     * - Для удалённых файлов — **`Promise<boolean>`**, разрешающийся значением `true`
     *   при успешном завершении ffmpeg и корректном размере файла, иначе `false`.
     *
     * **Таймаут:** Если ffmpeg не завершается в течение 60 секунд, операция считается неудачной.
     *
     * **Безопасность:** Все ошибки обрабатываются, временные файлы подчищаются при неудаче.
     *
     * @param track - Объект трека, содержащий `link`, `ID`, `similarTrackPath` и другие метаданные.
     *
     * @returns `Promise<boolean>` — `true`, если удалённый файл успешно загружен и перемещён,
     *          или `false` для локальных файлов / при любой ошибке.
     */
    private download = async (track: Track): Promise<boolean> => {
        // Получаем целевой путь сохранения и временный путь для загрузки.
        const { path: targetFile } = await this.status(track);
        const tmp = targetFile + ".tmp";

        const similarPath = (track as any).similarTrackPath;
        const isLocalFile = track.link.startsWith("/") || track.link.includes(":\\");

        // --- Попытка линковки (второй проход или локальный файл) ---
        // Этот вызов может создать симлинк, если трек уже существует локально.
        await this.symlink(track);

        // --- Скачивание (только для удалённых файлов) ---
        if (!isLocalFile) {
            // Аргументы ffmpeg: входной URL, формат opus, выходной временный файл.
            const args = ["-i", track.link, "-f", "opus", tmp];
            this.applyProxy(args, track); // Добавляет прокси-аргументы, если необходимо.

            // Оборачиваем процесс ffmpeg в промис с контролем таймаута.
            return new Promise((resolve) => {
                const ffmpeg = new Process(args);

                let finished = false;

                /**
                 * Единая точка завершения — вызывается при любом исходе.
                 * Гарантирует, что промис разрешится ровно один раз.
                 *
                 * @param success - Успешно ли завершилось скачивание.
                 */
                const finish = async (success: boolean) => {
                    if (finished) return;
                    finished = true;

                    clearTimeout(timeout);

                    if (!success) {
                        // При неудаче удаляем временный файл, если он остался.
                        await afs.rm(tmp, { force: true }).catch(() => {});
                    }

                    ffmpeg.destroy();
                    resolve(success);
                };

                // Таймаут 60 секунд — если ffmpeg завис, считаем неудачей.
                const timeout = setTimeout(() => {
                    finish(false);
                }, 60_000).unref();

                // Ошибка потока stdout — немедленное завершение с ошибкой.
                ffmpeg.stdout.once("error", () => {
                    void finish(false);
                });

                // Корректное завершение потока ffmpeg — проверяем результат.
                ffmpeg.stdout.once("end", async () => {
                    try {
                        // Проверяем размер временного файла (должен быть не менее 1024 байт).
                        const stat = await afs.stat(tmp);
                        if (stat.size < 1024) {
                            return void finish(false);
                        }

                        // Перемещаем временный файл на постоянное место.
                        await afs.rename(tmp, targetFile);

                        Logger.log("DEBUG", `[AudioSaver/Success]: ${track.ID}`);

                        // Если для трека указан путь симлинка, создаём его,
                        // предварительно подменив link на локальный путь.
                        if (similarPath) {
                            void (async () => {
                                try {
                                    track.link = targetFile;
                                    await this.symlink(track);
                                } catch (e) {
                                    Logger.log("DEBUG", `[AudioSaver/Link]: ${e}`);
                                }
                            })();
                        }

                        await finish(true);
                    } catch {
                        await finish(false);
                    }
                });
            });
        }

        // Для локального файла скачивание не требуется — сразу возвращаем false.
        return false;
    };

    /**
     * Создаёт символическую ссылку для похожего трека, используя информацию из объекта `track`.
     *
     * Метод проверяет, задан ли у трека путь `similarTrackPath` и является ли основной `link`
     * абсолютным (Unix-стиль `/...` или Windows-стиль `C:\...`). Если всё корректно,
     * создаёт относительную символическую ссылку из каталога `similarTrackPath` на целевой файл.
     *
     * **Побочный эффект:** при успешном создании ссылки свойство `similarTrackPath` у переданного
     * объекта `track` обнуляется (`null`), сигнализируя, что ссылка больше не нужна.
     *
     * **Безопасность:** метод перехватывает все возможные исключения, логирует их с уровнем `DEBUG`
     * и всегда возвращает булево значение, никогда не пробрасывая ошибку вызывающему коду.
     *
     * @param track - Объект трека. Ожидаются свойства:
     *   - `link: string` — абсолютный путь к исходному аудиофайлу (на который будет указывать ссылка).
     *   - `similarTrackPath?: string | null` — путь, по которому должна быть создана символическая ссылка.
     *     Если не задан или уже равен `link`, метод сразу возвращает `false`.
     *
     * @returns `Promise<boolean>`:
     *   - `true` — ссылка успешно создана (или уже существовала и указывала на тот же файл).
     *   - `false` — операция не выполнена: не задан `similarTrackPath`, `link` не является абсолютным,
     *     целевой файл не существует, или произошла ошибка при работе с файловой системой.
     *
     * @example
     * ```ts
     * const track = {
     *   link: '/music/song.mp3',
     *   similarTrackPath: '/links/song_link.mp3'
     * };
     * const ok = await audioSaver.symlink(track);
     * console.log(ok); // true, если ссылка создана
     * console.log(track.similarTrackPath); // null
     * ```
     */
    public symlink = async (track: Track): Promise<boolean> => {
        const linkPath = (track as any).similarTrackPath;

        // Если путь для ссылки не задан — выходим.
        if (!linkPath) return false;

        // Принимаем только абсолютные пути, чтобы избежать неоднозначности.
        if (!(track.link.startsWith("/") || track.link.includes(":\\"))) return false;

        const target = track.link;

        // Нет смысла создавать ссылку, указывающую на саму себя.
        if (linkPath === target) return false;

        try {
            // Убеждаемся, что исходный файл существует.
            await afs.access(target);

            // Проверяем, не указывает ли уже существующая ссылка на нужный файл.
            try {
                if ((await afs.readlink(linkPath)) === target) {
                    // Ссылка уже корректна — сбрасываем флаг и выходим.
                    (track as any).similarTrackPath = null;
                    return true;
                }
            } catch {
                // readlink выбросит ошибку, если файла нет или это не симлинк — игнорируем.
            }

            // Создаём родительские директории для ссылки, если их нет.
            await afs.mkdir(path.dirname(linkPath), { recursive: true });

            // Если по пути `linkPath` уже существует символическая ссылка — удаляем её,
            // чтобы беспрепятственно создать новую.
            try {
                const stat = await afs.lstat(linkPath);
                if (stat.isSymbolicLink()) {
                    await afs.unlink(linkPath);
                } else {
                    // Это не симлинк, перезаписывать небезопасно — отказываемся.
                    return false;
                }
            } catch {
                // Файл не существует — это нормально, продолжаем.
            }

            // Создаём относительную символическую ссылку для переносимости.
            await afs.symlink(
                path.relative(path.dirname(linkPath), target),
                linkPath
            );

            // Ссылка готова — снимаем необходимость повторных попыток.
            (track as any).similarTrackPath = null;

            Logger.log("DEBUG", `[AudioSaver/Link]: ${linkPath} -> ${target}`);
            return true;
        } catch (e: any) {
            // Любая ошибка (нет доступа, диск переполнен и т.д.) приводит к graceful-возврату.
            Logger.log("DEBUG", `[AudioSaver/Link]: ${e.message}`);
            return false;
        }
    };

    /**
     * Определяет статус загрузки трека и возвращает актуальный путь к файлу.
     *
     * Метод проверяет существование готового `.opus`-файла и временного `.tmp`-файла
     * в директории трека. На основе этого возвращает один из трёх статусов:
     * - `"ended"`     – готовый файл существует (загрузка завершена).
     * - `"download"`  – существует только временный файл (загрузка в процессе).
     * - `"not-ended"` – ни готового, ни временного файла нет.
     *
     * **Важно:** Свойство `path` **всегда** указывает на финальный `.opus`-файл,
     * даже если на данный момент существует только `.tmp`. Это позволяет вызывающему
     * коду сразу знать целевой путь для перемещения/открытия после завершения загрузки.
     *
     * @param track - Объект трека с полями `api.url`, `ID` или строка-идентификатор.
     *   Если передана строка, директорией считается `{base}/Audio/<строка>`.
     *
     * @returns Объект с полями:
     *   - `status` — `"ended" | "download" | "not-ended"`.
     *   - `path`   — абсолютный путь к финальному `.opus`-файлу трека.
     *
     * @example
     * ```ts
     * const { status, path } = await downloader.status(track);
     * if (status === "ended") {
     *   console.log("Трек уже загружен:", path);
     * }
     * ```
     */
    public status = async (track: Track | string) => {
        const basePath = typeof track === "string"
            ? `${this._dirname}/Audio/${track}`
            : `${this._dirname}/Audio/${track.api.url}/${track.ID}`;
        const file = basePath + '.opus';
        const tmp  = file + '.tmp';

        try {
            await afs.access(file);
            return { status: "ended", path: file };
        } catch {}

        try {
            await afs.access(tmp);
            return { status: "download", path: file };
        } catch {}

        return { status: "not-ended", path: file };
    };

    /**
     * Добавляет к аргументам ffmpeg параметры HTTP-прокси, если трек этого требует.
     *
     * Прокси применяется только при одновременном выполнении условий:
     * 1. У трека установлен флаг `proxy` (например, `track.proxy === true`).
     * 2. Ссылка трека начинается с `http` (игнорируются локальные файлы).
     * 3. В переменной окружения `APIs.proxy` задан адрес прокси-сервера.
     *
     * Адрес извлекается из строки вида `"http://user:pass@host:port"` путём отсечения протокола,
     * после чего добавляется в начало массива аргументов:
     * `"-http_proxy"`, `"http://host:port"`.
     *
     * Изменяет массив `args` **на месте**.
     *
     * @param args  - Текущий массив аргументов для `Process(ffmpeg)`. Будет модифицирован.
     * @param track - Объект трека, содержащий `link` и флаг `proxy`.
     *
     * @private
     */
    private applyProxy(args: string[], track: Track) {
        if (!track.proxy || !track.link.startsWith("http")) return;

        const proxy = env.get("APIs.proxy");
        if (!proxy) return;

        args.unshift(
            "-http_proxy",
            `http:/${proxy.split(":/")[1]}`
        );
    };
}