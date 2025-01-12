import {createWriteStream, existsSync, mkdirSync, rename, stat, unlink, writeFile, readFileSync} from "node:fs";
import {httpsClient} from "@lib/request";
import {Track} from "@lib/player/track";
import {Constructor} from "@handler";
import path from "node:path";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Класс для кеширования аудио и картинок
 * @class CacheUtility
 * @public
 */
export class CacheUtility {
    /**
     * @author SNIPPIK
     * @description Путь до директории с кешированными данными
     * @readonly
     * @private
     */
    private readonly cache: string = env.get("cache.dir");

    /**
     * @author SNIPPIK
     * @description Можно ли сохранять файлы
     * @readonly
     * @private
     */
    private readonly cache_file: string = env.get("cache.file");

    /**
     * @description База данных треков
     * @readonly
     * @private
     */
    private readonly data = {
        /**
         * @description Кешированные треки
         */
        tracks: new Map<string, Track>(),

        /**
         * @description Класс кеширования аудио файлов
         */
        audio: this.cache_file ? new CacheAudio(this.cache) : null
    };

    /**
     * @description Выдаем класс для кеширования аудио
     * @public
     */
    public get audio() {
        if (!this.cache_file) return null;
        return this.data.audio;
    };

    /**
     * @description Сохраняем данные в класс
     * @param track - Кешируемый трек
     */
    public set = (track: Track) => {
        // Если включен режим без кеширования в файл
        if (!this.cache_file) {
            const song = this.data.tracks.get(track.id);

            // Если уже сохранен трек
            if (song) return;

            this.data.tracks.set(track.id, track);
            return;
        }

        // Если нет директории Data
        if (!existsSync(`${this.cache}/Data`)) {
            let dirs = `${this.cache}/Data`.split("/");
            mkdirSync(dirs.join("/"), {recursive: true});
        }

        // Сохраняем данные в файл
        if (!existsSync(`${this.cache}/Data/[${track.id}].json`)) {
            createWriteStream(`${this.cache}/Data/[${track.id}].json`);

            writeFile(`${this.cache}/Data/[${track.id}].json`, JSON.stringify({
                ...track["_track"],
                time: { total: `${track["_duration"]["total"]}` },
                // Не записываем в кеш аудио, он будет в кеше
                audio: null
            }), () => null);
        }
    };

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     */
    public get = (ID: string) => {
        // Если включен режим без кеширования в файл
        if (!this.cache_file) {
            const track = this.data.tracks.get(ID);

            // Если трек кеширован в память, то выдаем данные
            if (track) return track;
            return null;
        }

        // Если есть трек в кеше
        if (existsSync(`${this.cache}/Data/[${ID}].json`)) {
            // Если трек кеширован в файл
            const json = JSON.parse(readFileSync(`${this.cache}/Data/[${ID}].json`, 'utf8'));

            // Если трек был найден среди файлов
            if (json) return new Track(json._track);
        }
        return null;
    };
}

/**
 * @author SNIPPIK
 * @description Класс для сохранения аудио файлов
 * @support ogg/opus
 * @class CacheAudio
 * @protected
 */
class CacheAudio extends Constructor.Cycle<Track> {
    /**
     * @author SNIPPIK
     * @description Путь до директории с кешированными данными
     */
    private readonly cache_dir: string = null;

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

                //Если уже скачено или не подходит для скачивания то, пропускаем
                if (names.status === "final" || item.time.total > 600) {
                    this.remove(item);
                    return false;

                    //Если нет директории то, создаем ее
                } else if (!existsSync(names.path)) {
                    let dirs = names.path.split("/");

                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    mkdirSync(dirs.join("/"), {recursive: true});
                }
                return true;
            },
            execute: (track) => {
                return new Promise<boolean>((resolve) => {
                    new httpsClient(track.link).request.then((req) => {
                        if (req instanceof Error) return resolve(false);
                        else if ("pipe" in req) {
                            const status = this.status(track);
                            const file = createWriteStream(status.path)
                                // Если произошла ошибка при создании файла
                                .once("error", () => {
                                    return resolve(false);
                                })

                                // Производим запись в файл
                                .once("ready", () => {
                                    req.pipe(file);
                                })

                                // Если запись была завершена
                                .once("finish", () => {
                                    const name = this.status(track).path.split(".raw")[0];

                                    // Заканчиваем запись на файл
                                    if (!file.destroyed) {
                                        file.destroy();
                                        file.end();
                                    }

                                    // Удаляем подключение
                                    if (!req.destroyed) req.destroy();

                                    // Проверяем размер файла
                                    stat(`${name}.raw`, (_, file) => {
                                        // Если вес файла менее 100 байт, то его надо удалить
                                        if (file && file.size < 100) {
                                            unlink(`${name}.raw`, () => {});
                                            return resolve(false);
                                        }

                                        // Файл успешно скачан и готов
                                        rename(status.path, `${name}.opus`, () => null);
                                        return resolve(true);
                                    });
                                });
                        }

                        return resolve(false);
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
    public status = (track: Track): { status: "not" | "final" | "download", path: string } => {
        try {
            const dir = `${path.resolve(`${this.cache_dir}/Audio/[${track.id}]`)}`;
            const isOpus = existsSync(`${dir}.opus`), isRaw = existsSync(`${dir}.raw`);

            return {status: isOpus ? "final" : isRaw ? "download" : "not", path: dir + (isOpus ? `.opus` : `.raw`)}
        } catch {
            return {status: "not", path: null};
        }
    };
}