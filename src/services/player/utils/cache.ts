import { AsyncCycle } from "#structures";
import { Process } from "#service/voice";
import { Track } from "#service/player";
import afs from "node:fs/promises";
import { env } from "#app/env";
import path from "node:path";
import fs from "node:fs";

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
     * @public
     */
    public get audio(): null | CacheAudio {
        if (!this._options.inFile) return null;
        return this.data.audio;
    };

    /**
     * @description Путь до директории кеширования
     * @public
     */
    public get dirname() { return this._options.dirname; };

    /**
     * @description Можно ли сохранять кеш в файл
     * @public
     */
    public get inFile() { return this._options.inFile; };

    /**
     * @description Сохраняем данные в класс
     * @param track - Кешируемый трек
     * @param api - Ссылка на платформу
     */
    public set = async (track: Track.data, api: string) => {
        if (this.inFile) {
            const filePath = path.join(this.dirname, "Data", api, `${track.id}.json`);

            if (!fs.existsSync(filePath)) {
                try {
                    const dirPath = path.dirname(filePath);
                    await afs.mkdir(dirPath, {recursive: true});

                    const data = {
                        track: {
                            ...track,
                            audio: null
                        }
                    };

                    // Записываем данные в файл
                    await afs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
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
     */
    public get = (ID: string): Track.data | null => {
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
 * @private
 */
class CacheAudio extends AsyncCycle<Track> {
    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor(private readonly cache_dir: string) {
        super({
            custom: {
                push: (track) => {
                    // Защита от повторного добавления
                    setImmediate(async () => {
                        const find = this.filter((item) => track.url === item.url);
                        if (find.length > 1) this.delete(find[0]);
                    });
                }
            },
            filter: (item) => {
                const names = this.status(item);

                // Если такой трек уже есть в системе кеширования
                if (names.status === "ended" || item.time.total > 1000) {
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
                        this.delete(track);
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("end", async () => {
                        const isValid = await this.validateFile(`${status.path}.opus`);
                        if (!isValid) {
                            fs.unlinkSync(`${status.path}.opus`);
                            this.delete(track);
                            return resolve(false);
                        }

                        this.delete(track);
                        return resolve(true);
                    });
                });
            }
        });
    };

    /**
     * @description Проверяет, является ли файл корректным аудио
     * @param filePath - Путь до файла
     */
    private async validateFile(filePath: string): Promise<boolean> {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size < 1024) return false;

            const ffmpeg = new Process([
                "-v", "error",
                "-i", filePath,
                "-f", "null",
                "-"
            ]);

            return new Promise((resolve) => {
                ffmpeg.stdout.once("end", () => resolve(true));
                ffmpeg.stdout.once("error", () => resolve(false));
            });
        } catch (err) {
            return false;
        }
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
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