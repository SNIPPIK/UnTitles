import {CacheAudio} from "./CacheAudio";
import {Track} from "@lib/player";
import path from "node:path";
import fs from "node:fs";
import {env} from "@env"

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
    private readonly cache: string = path.resolve(env.get("cache.dir"));

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
        if (!fs.existsSync(`${this.cache}/Data`)) {
            let dirs = `${this.cache}/Data`.split("/");
            fs.mkdir(dirs.join("/"), {recursive: true}, () => {});
        }

        // Сохраняем данные в файл
        if (!fs.existsSync(`${this.cache}/Data/[${track.id}].json`)) {
            // Создаем файл
            fs.createWriteStream(`${this.cache}/Data/[${track.id}].json`).destroy();

            // Записываем данные в файл
            fs.writeFile(`${this.cache}/Data/[${track.id}].json`, JSON.stringify({
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
        if (fs.existsSync(`${this.cache}/Data/[${ID}].json`)) {
            // Если трек кеширован в файл
            const json = JSON.parse(fs.readFileSync(`${this.cache}/Data/[${ID}].json`, 'utf8'));

            // Если трек был найден среди файлов
            if (json) return new Track(json);
        }
        return null;
    };
}