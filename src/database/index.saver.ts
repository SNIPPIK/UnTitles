import { PromiseCycle } from "#structures/tools/Cycle";
import { Process } from "#core/audio/process";
import { Logger } from "#structures/logger";
import type { Track } from "#core/queue";
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
export class MetaSaver {
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
     * @description Бд треков, для повторного использования
     * @private
     */
    private tracks: Map<string, Track.data> = !this.inFile ? new Map<string, Track.data>() : null;

    /**
     * @description Сохраняем трек в локальную базу данных
     * @param track - Кешируемый трек
     * @param api - Ссылка на платформу
     * @returns Promise<void>
     * @public
     */
    public set = async (track: Track.data, api: string): Promise<void> => {
        // Если нельзя сохранять в файлы
        if (!this.inFile) {
            const Path = path.join(this._dirname, "Data", api, `${track.id}.json`);

            if (!fs.existsSync(Path)) {
                try {
                    const dirPath = path.dirname(Path);
                    await afs.mkdir(dirPath, { recursive: true });

                    // Записываем данные в файл
                    await afs.writeFile(Path, JSON.stringify(
                        {
                            track: {
                                ...track,
                                audio: null
                            }
                        }, null, 2), "utf-8");
                } catch (error) {
                    console.error("Failed to write track cache:", error);
                }
            }
        } else {
            const song = this.tracks.get(track.id);

            // Если уже сохранен трек
            if (song) return null;

            this.tracks.set(track.id, track);
        }

        return null;
    };

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     * @returns Track.data
     * @public
     */
    public get = (ID: string): Track.data => {
        // Если нельзя сохранять в файлы
        if (this.inFile) {
            // Если есть трек в кеше
            if (fs.existsSync(`${this._dirname}/Data/${ID}.json`)) {
                try {
                    // Если трек кеширован в файл
                    const json = JSON.parse(fs.readFileSync(`${this._dirname}/Data/${ID}.json`, "utf8"));

                    // Если трек был найден среди файлов
                    if (json) return json.track;
                } catch {
                    return null;
                }
            }
        }

        // Если включен режим без кеширования в файл
        else {
            const track = this.tracks.get(ID.split("/").at(-1));

            // Если трек кеширован в память, то выдаем данные
            if (track) return track;
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
            drift: true,
            custom: {
                push: (track) => {
                    // Защита от повторного добавления
                    setImmediate(() => {
                        const find = this.filter((item) => track.url === item.url);
                        if (find.length > 1) this.delete(find[0]);
                    });
                }
            },
            filter: (item) => {
                const names = this.status(item);

                // Если такой трек уже есть в системе кеширования
                if (names.status === "ended" || item.time.total > 500 || item.time.total === 0) {
                    this.delete(item);
                    return false;
                }

                // Если нет директории то, создаем ее
                if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");
                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    fs.mkdirSync(dirs.join("/"), { recursive: true });
                }

                return true;
            },
            execute: (track) => {
                return new Promise<boolean>((resolve) => {
                    const status = this.status(track);

                    // Создаем ffmpeg для скачивания трека
                    const ffmpeg = new Process([
                        "-i", track.link,
                        "-f", `opus`,
                        `${status.path}.opus`
                    ]);

                    // Если была получена ошибка
                    ffmpeg.stdout.once("error", () => {
                        ffmpeg.destroy();
                        this.delete(track);

                        // Удаляем файл
                        fs.unlink(`${status.path}.opus`, (err) => Logger.log("ERROR", err));
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("end", () => {
                        fs.stat(`${status.path}.opus`, (err, stats) => {
                            // Если файл не проходит проверку
                            if (err || stats.size < 10) fs.unlink(`${status.path}.opus`, (err) => Logger.log("ERROR", err));
                        });

                        ffmpeg.destroy();
                        this.delete(track);
                        return resolve(true);
                    });
                });
            }
        });
    }

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     * @public
     */
    public status = (track: Track | string): { status: "not-ended" | "ended" | "download", path: string } => {
        let file: string;

        if (typeof track !== "string") {
            file = `${this._dirname}/Audio/${track.api.url}/${track.ID}`;

            // Если трека нет в очереди, значит он есть
            if (!this.has(track)) {
                // Если файл все таки есть
                if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
            }

            // Выдаем что ничего нет
            return { status: "not-ended", path: file };
        } else {
            file = `${this._dirname}/Audio/${track}`;

            // Если файл все таки есть
            if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
        }

        // Выдаем что ничего нет
        return { status: "not-ended", path: file };
    };
}