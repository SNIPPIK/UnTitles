import {Track} from "@lib/player/queue";

/**
 * @author SNIPPIK
 * @description Класс для кеширования аудио и картинок
 * @public
 */
class CacheUtility {

}

/**
 * @author SNIPPIK
 * @description Класс для сохранения данных о треке
 * @support track, author
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

}

/**
 * @author SNIPPIK
 * @description Класс для сохранения картинок
 * @support jpg, png
 * @protected
 */
class CacheImage {

}

/**
 * @author SNIPPIK
 * @description Класс для сохранения аудио файлов
 * @support ogg/opus
 */
class CacheAudio {
    /**
     * @description База сохраненных треков
     * @readonly
     * @private
     */
    private readonly audios = new Map<string, string>();

    /**
     * @description Функция сохранения исходника трека
     * @param track - трек который надо сохранить
     */
    public readonly save = (track: Track) => {
        const item = this.audios.get(track.url);

        // Если трек уже сохранен
        if (item) return;

        // Процесс сохранения трека (WIP)
    };

    /**
     * @description Функция получения исходников трека
     * @param track - трек который надо найти в кеше
     */
    public readonly get = (track: Track) => {
       return this.audios.get(track.url);
    };
}