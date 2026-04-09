import type { APIRequestData } from "#handler/rest";
import { Logger, PromiseCycle } from "#structures";
import { Process } from "#core/audio/process";
import { Track } from "#core/queue";
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
    /**
     * @description Можно ли сохранять файлы
     * @returns boolean
     * @public
     */
    public inFile = env.get("cache.file") as boolean;

    /**
     * @description Путь до директории с кешированными данными
     * @returns string
     * @private
     */
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
    /**
     * @description Путь до директории с кешированными данными
     * @returns string
     * @private
     */
    public _dirname = path.resolve(env.get("cache.dir"));

    public constructor() {
        super({
            duration: 30e3,
            custom: {
                push: (track) => {
                    // Удаляем дубликаты по URL (асинхронно, чтобы избежать мутации во время итерации)
                    setImmediate(() => {
                        const duplicates = Array.from(this).filter(t => t.url === track.url);
                        for (let i = 1; i < duplicates.length; i++) {
                            this.delete(duplicates[i]);
                        }
                    })
                }
            },
            filter: (item) => {
                const names = this.status(item);

                // Если такой трек уже есть в системе кеширования
                if (names.status === "ended" || item.time.total > 500 || item.time.total === 0 || item.api.type === "technical") {
                    this.delete(item);
                    return false;
                }

                // Если нет директории то, создаем ее
                else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");
                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    afs.mkdir(dirs.join("/"), { recursive: true });
                }

                return true;
            },
            execute: (track) => new Promise<boolean>((resolve) => {
                if (track.api.type === "technical") return resolve(false);

                const status = this.status(track);
                const args = [
                    "-i", track.link,
                    "-f", `opus`,
                    `${status.path}.opus`
                ];

                Logger.log("DEBUG", `[AudioCache/Start]: Save ${status.path}.opus`);

                // Если платформа не может играть нативно из сети
                if (track.proxy && track.link.startsWith("http")) {
                    const proxy = env.get("APIs.proxy", null);

                    // Если есть прокси
                    if (proxy) {
                        const isSocks = proxy.startsWith("socks");

                        // Если протокол socks
                        if (isSocks) {
                            const path = proxy.split(":/")[1];

                            // Если нашлись данные для входа
                            if (path.match(/@/)) {
                                args.unshift("-http_proxy", `http:/${proxy.split(":/")[1].split("@")[1]}`);
                            }

                            // Если данных для входа нет
                            else args.unshift("-http_proxy", `http:/${proxy.split(":/")[1]}`);
                        }

                        // Если протокол http
                        else args.unshift("-http_proxy", `http:/${proxy.split(":/")[1]}`);
                    }
                }

                // Создаем ffmpeg для скачивания трека
                const ffmpeg = new Process(args);

                // Если была получена ошибка
                ffmpeg.stdout.once("error", async () => {
                    ffmpeg.destroy();
                    this.delete(track);

                    // Удаляем файл
                    if (fs.existsSync(status.path)) await afs.unlink(`${status.path}.opus`);
                    return resolve(false);
                });

                // Если запись была завершена
                ffmpeg.stdout.once("end", async () => {
                    if (fs.existsSync(status.path)) {
                        const data = await afs.stat(`${status.path}.opus`);

                        // Если файл не проходит проверку
                        if (data.size < 10) await afs.unlink(`${status.path}.opus`);
                    }

                    Logger.log("DEBUG", `[AudioCache/End]: Saved ${status.path}.opus`);

                    ffmpeg.destroy();
                    this.delete(track);
                    return resolve(true);
                });
            })
        });
    }

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     * @public
     */
    public status = (track: Track | string): { status: "not-ended" | "ended" | "download", path: string } => {
        let file: string = `${this._dirname}/Audio/${track}`;

        if (typeof track !== "string") {
            file = `${this._dirname}/Audio/${track.api.url}/${track.ID}`;

            // Если трека нет в очереди, значит он есть
            if (!this.has(track)) {
                // Если файл есть
                if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
            }

            // Выдаем что ничего нет
            return { status: "not-ended", path: file };
        } else {
            // Если файл все-таки есть
            if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
        }

        // Выдаем что ничего нет
        return {
            status: "not-ended",
            path: file
        };
    };
}