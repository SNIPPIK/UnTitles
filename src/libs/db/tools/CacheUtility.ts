import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
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
        audio: new CacheAudio()
    };

    /**
     * @description Выдаем класс для кеширования аудио
     * @public
     */
    public get audio() { return this.data.audio; };

    /**
     * @description Сохраняем данные в класс
     * @param track
     */
    public set = (track: Track) => {
        const song = this.data.tracks.get(track.id);

        // Если уже сохранен трек
        if (song) return;

        this.data.tracks.set(track.id, track);
    };

    /**
     * @description Выдаем данные из класса
     * @param ID
     */
    public get = (ID: string) => { return this.data.tracks.get(ID); };
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
    private readonly cache: string = env.get("cache.dir");

    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor() {
        super({
            name: "AudioFile",
            duration: "promise",
            filter: (item) => {
                const names = this.status(item);

                //Если уже скачено или не подходит для скачивания то, пропускаем
                if (names.status === "final" || item.time.total === 0 && item.time.total >= 800) {
                    this.remove(item);
                    return false;

                    //Если нет директории автора то, создаем ее
                } else if (!existsSync(names.path)) {
                    let dirs = names.path.split("/");

                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    mkdirSync(dirs.join("/"), {recursive: true});
                }
                return true;
            },
            execute: (track) => {
                return new Promise<boolean>((resolve, reject) => {
                    setImmediate(() => this.remove(track));

                    new httpsClient(track.link).request.then((req) => {
                        if (req instanceof Error) return resolve(false);
                        else if ("pipe" in req) {
                            const status = this.status(track);
                            const file = createWriteStream(status.path)
                                // Если произошла ошибка при создании файла
                                .once("error", (error) => {
                                    return reject(error);
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

                                    // Меняем тип файла на opus
                                    rename(status.path, `${name}.opus`, () => null);
                                    return resolve(true);
                                });
                        }

                        return resolve(false);
                    });
                });
            }
        });
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     */
    public status = (track: Track): { status: "not" | "final" | "download", path: string } => {
        try {
            const dir = `${path.resolve(`${this.cache}/Audio/[${track.id}]`)}`;
            const isOpus = existsSync(`${dir}.opus`), isRaw = existsSync(`${dir}.raw`);

            return {status: isOpus ? "final" : isRaw ? "download" : "not", path: dir + (isOpus ? `.opus` : `.raw`)}
        } catch {
            return {status: "not", path: null};
        }
    };
}