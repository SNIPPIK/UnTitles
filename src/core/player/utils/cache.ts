import { PromiseCycle } from "#structures";
import afs from "node:fs/promises";
import { env } from "#app/env";
import path from "node:path";
import fs from "node:fs";

// Low level
import { PLAYER_BUFFERED_TIME } from "#core/player";
import { Process } from "#core/audio";
import { Track } from "#core/queue";

/**
 * @author SNIPPIK
 * @description Класс для кеширования аудио и данных о треках
 * @class CacheUtility
 * @readonly
 * @public
 */
export class CacheUtility {
    /**
     * @description Параметры утилиты кеширования
     * @readonly
     * @private
     */
    private readonly _options = {
        /**
         * @description Путь до директории с кешированными данными
         * @private
         */
        dirname: path.resolve(env.get("cache.dir")),

        /**
         * @description Можно ли сохранять файлы
         */
        inFile: env.get("cache.file"),

        /**
         * @description Включена ли система кеширования
         */
        isOn: env.get("cache")
    };

    /**
     * @description База данных треков
     * @readonly
     * @private
     */
    private readonly data = {
        /**
         * @description Кешированные треки
         */
        tracks: !this.inFile ? new Map<string, Track.data>() : null as Map<string, Track.data>,

        /**
         * @description Класс кеширования аудио файлов
         */
        audio: this.inFile ? new CacheAudio(this._options.dirname) : null as CacheAudio
    };

    /**
     * @description Выдаем класс для кеширования аудио
     * @returns CacheAudio
     * @public
     */
    public get audio(): CacheAudio {
        if (!this._options.inFile) return null;
        return this.data.audio;
    };

    /**
     * @description Путь до директории кеширования
     * @returns string
     * @public
     */
    public get dirname() { return this._options.dirname; };

    /**
     * @description Можно ли сохранять кеш в файл
     * @returns string
     * @public
     */
    public get inFile() { return this._options.inFile; };

    /**
     * @description Сохраняем данные в класс
     * @param track - Кешируемый трек
     * @param api - Ссылка на платформу
     * @returns Promise<void>
     * @public
     */
    public set = async (track: Track.data, api: string) => {
        if (this.inFile) {
            const filePath = path.join(this.dirname, "Data", api, `${track.id}.json`);

            if (!fs.existsSync(filePath)) {
                try {
                    const dirPath = path.dirname(filePath);
                    await afs.mkdir(dirPath, { recursive: true });

                    // Записываем данные в файл
                    await afs.writeFile(filePath, JSON.stringify(
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
            const song = this.data.tracks.get(track.id);

            // Если уже сохранен трек
            if (song) return;

            this.data.tracks.set(track.id, track);
        }
    };

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     * @returns Track.data
     * @public
     */
    public get = (ID: string): Track.data => {
        if (this.inFile) {
            // Если есть трек в кеше
            if (fs.existsSync(`${this.dirname}/Data/${ID}.json`)) {
                try {
                    // Если трек кеширован в файл
                    const json = JSON.parse(fs.readFileSync(`${this.dirname}/Data/${ID}.json`, "utf8"));

                    // Если трек был найден среди файлов
                    if (json) return json.track;
                } catch {
                    return null;
                }
            }
        }

        // Если включен режим без кеширования в файл
        else {
            const track = this.data.tracks.get(ID.split("/").at(-1));

            // Если трек кеширован в память, то выдаем данные
            if (track) return track;
        }

        return null;
    };
}

/**
 * @author SNIPPIK
 * @description Класс для сохранения аудио файлов
 * @support ogg/opus
 * @class CacheAudio
 * @extends PromiseCycle
 * @private
 */
class CacheAudio extends PromiseCycle<Track> {
    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor(private readonly cache_dir: string) {
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
                if (names.status === "ended" || item.time.total > PLAYER_BUFFERED_TIME || item.time.total === 0) {
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
                        fs.unlinkSync(`${status.path}.opus`);
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("end", () => {
                        ffmpeg.destroy();
                        this.delete(track);
                        return resolve(true);
                    });
                });
            }
        });
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     * @public
     */
    public status = (track: Track | string): { status: "not-ended" | "ended" | "download", path: string } => {
        let file: string;

        if (track instanceof Track) {
            file = `${this.cache_dir}/Audio/${track.api.url}/${track.ID}`;

            // Если трека нет в очереди, значит он есть
            if (!this.has(track)) {
                // Если файл все таки есть
                if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
            }

            // Выдаем что ничего нет
            return { status: "not-ended", path: file };
        } else {
            file = `${this.cache_dir}/Audio/${track}`;

            // Если файл все таки есть
            if (fs.existsSync(`${file}.opus`)) return {status: "ended", path: `${file}.opus`};
        }

        // Выдаем что ничего нет
        return { status: "not-ended", path: file };
    };
}