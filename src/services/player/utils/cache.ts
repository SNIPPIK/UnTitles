import path from "node:path";
import fs from "node:fs";

// @service modules
import {Process} from "@service/voice";
import {Track} from "@service/player";
import {env} from "@handler";
import {Cycle} from "@utils";

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
        tracks: !this.inFile ? new Map<string, Track>() : null as Map<string, Track>,

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
     */
    public set = (track: Track) => {
        // Если включен режим без кеширования в файл
        if (!this.inFile) {
            const song = this.data.tracks.get(track.ID);

            // Если уже сохранен трек
            if (song) return;

            this.data.tracks.set(track.ID, track);
            return;
        }

        setImmediate(async () => {
            // Сохраняем данные в файл
            if (!fs.existsSync(`${this.dirname}/Data/${track.api.url}/${track.ID}.json`)) {
                fs.mkdirSync(`${this.dirname}/Data/${track.api.url}`, {recursive: true});

                // Создаем файл
                fs.createWriteStream(`${this.dirname}/Data/${track.api.url}/${track.ID}.json`).destroy();

                // Записываем данные в файл
                fs.writeFile(`${this.dirname}/Data/${track.api.url}/${track.ID}.json`, JSON.stringify({
                    track: {
                        ...track["_information"]["_track"],
                        time: track["_information"]["_duration"],
                        audio: null
                    },
                    api: track["_information"]["_api"]
                }), () => {});
            }
        });
    };

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     */
    public get = (ID: string): Track | null => {
        // Если включен режим без кеширования в файл
        if (!this.inFile) {
            const track = this.data.tracks.get(ID);

            // Если трек кеширован в память, то выдаем данные
            if (track) return track;
            return null;
        }

        // Если есть трек в кеше
        if (fs.existsSync(`${this.dirname}/Data/${ID}.json`)) {
            try {
                // Если трек кеширован в файл
                const json = JSON.parse(fs.readFileSync(`${this.dirname}/Data/${ID}.json`, "utf8"));

                // Если трек был найден среди файлов
                if (json) return new Track(json.track, json.api);
            } catch {
                return null;
            }
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
class CacheAudio extends Cycle<Track> {
    /**
     * @description Путь до директории с кешированными данными
     * @readonly
     * @private
     */
    private readonly cache_dir: string;

    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor(cache_dir: string) {
        super({
            name: "AudioFile",
            duration: "promise",
            filter: (item) => {
                const names = this.status(item);

                // Если трек уже есть в кеше или не возможно кешировать из-за длительности
                if (names.status === "ended" || item.time.total > 600) {
                    this.remove(item);
                    return false;
                }

                // Если нет директории то, создаем ее
                else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");

                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    fs.mkdirSync(dirs.join("/"), {recursive: true});
                }
                return true;
            },
            execute: (track) => {
                return new Promise<boolean>(async (resolve) => {
                    const status = this.status(track);

                    // Создаем ffmpeg для скачивания трека
                    const ffmpeg = new Process([
                        "-i", track.link,
                        "-f", `opus`,
                        `${status.path}.opus`
                    ]);

                    // Если была получена ошибка
                    ffmpeg.stdout.once("error", () => {
                        this.remove(track);
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("end", () => {
                        this.remove(track);
                        return resolve(true);
                    });
                });
            }
        });

        this.cache_dir = cache_dir;
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     */
    public status = (track: Track): { status: "not-ended" | "ended" | "download", path: string } => {
        const file = `${this.cache_dir}/Audio/${track.api.url}/${track.ID}`;

        // Если трека нет в очереди, значит он есть
        if (!this.match(track)) {
            // Если файл все таки есть
            if (fs.existsSync(`${file}.opus`)) return { status: "ended", path: `${file}.opus`};
        }

        // Выдаем что ничего нет
        return { status: "not-ended", path: file };
    };
}