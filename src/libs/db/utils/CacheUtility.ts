import {createWriteStream, existsSync, mkdirSync, rename} from "node:fs";
import {httpsClient} from "@lib/request";
import {Track} from "@lib/player/queue";
import {Constructor} from "@handler";
import {Logger} from "@lib/logger";
import path from "node:path";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Путь до директории с кешированными данными
 */
const cache = env.get("cache.dir");

/**
 * @author SNIPPIK
 * @description Класс для кеширования аудио и картинок
 * @class CacheUtility
 * @public
 */
export class CacheUtility {
    /**
     * @description Класс кеширования данных
     * @readonly
     * @private
     */
    private readonly _data = new CacheData();

    /**
     * @description Класс кеширования аудио файлов
     * @readonly
     * @private
     */
    private readonly _audio = new CacheAudio();

    /**
     * @description Выдаем класс для кеширования аудио
     * @public
     */
    public get audio() { return this._audio; };

    /**
     * @description Сохраняем данные в класс
     * @param track
     */
    public set = (track: Track) => {
        const f_track = this._data.getTrack(track.id);

        if (f_track) return;

        this._data.setTrack(track);
    };

    /**
     * @description Выдаем данные из класса
     * @param ID
     */
    public get = (ID: string) => {
        return this._data.getTrack(ID);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для сохранения данных о треке
 * @support track, author
 * @class CacheData
 * @protected
 */
class CacheData {
    /**
     * @description База данных треков
     * @private
     */
    private readonly data = {
        /**
         * @description Кешированные треки
         */
        tracks: new Map<string, Track>(),

        /**
         * @description Кешированные авторы треков
         */
        artists: new Map<string, Track.artist>()
    };

    /**
     * @description Выдает сохраненный трек из базы
     * @param ID
     */
    public getTrack = (ID: string) => {
        return this.data.tracks.get(ID);
    };

    /**
     * @description Сохраняет трек в базу данных
     * @param track
     */
    public setTrack = (track: Track) => {
        const song = this.data.tracks.get(track.id);

        // Если уже сохранен трек
        if (song) return;

        // @ts-ignore
        this.data.tracks.set(track.id, track);
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
    public constructor() {
        super({
            name: "AudioFile",
            duration: 20e3,
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
            execute: (track) => new Promise<boolean>((resolve) => {
                setImmediate(() => this.remove(track));

                new httpsClient(track.link).request.then((req) => {
                    if (req instanceof Error) return resolve(false);
                    else if ("pipe" in req) {
                        const status = this.status(track);
                        const file = createWriteStream(status.path);

                        file.once("ready", () => req.pipe(file as any));
                        file.once("error", console.warn);
                        file.once("finish", () => {
                            const refreshName = this.status(track).path.split(".raw")[0];
                            rename(status.path, `${refreshName}.opus`, () => null);

                            if (!req.destroyed) req.destroy();
                            if (!file.destroyed) {
                                file.destroy();
                                file.end();
                            }
                            Logger.log("DEBUG", `[Download] in ${refreshName}`);

                            return resolve(true);
                        });
                    }

                    return resolve(false);
                });
            })
        });
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     */
    public status = (track: Track): { status: "not" | "final" | "download", path: string } => {
        try {
            const dir = `${path.resolve(`${cache}/Audio/[${track.id}]`)}`;
            const isOpus = existsSync(`${dir}.opus`), isRaw = existsSync(`${dir}.raw`);

            return {status: isOpus ? "final" : isRaw ? "download" : "not", path: dir + (isOpus ? `.opus` : `.raw`)}
        } catch {
            return {status: "not", path: null};
        }
    };
}