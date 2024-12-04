import {API} from "@lib/handler";
import {Track} from "@lib/player/queue";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class Database_APIs
 * @public
 */
export class Database_APIs {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    protected readonly _platforms = {
        /**
         * @description Поддерживаемые платформы
         * @protected
         */
        supported: [] as API.request[],

        /**
         * @description Платформы с отсутствующими данными для авторизации
         * @protected
         */
        authorization: [] as API.platform[],

        /**
         * @description Платформы с возможностью получить аудио
         * По-умолчанию запрос идет к track
         * @protected
         */
        audio: [] as API.platform[],

        /**
         * @description Заблокированные платформы, только через owner.list
         * @protected
         */
        block: [] as API.platform[]
    };
    /**
     * @description База с лимитами обрабатываемых данных
     * @protected
     * @readonly
     */
    protected readonly _limits = {
        /**
         * @description Кол-во получаемых элементов трека при получении плейлиста
         * @protected
         */
        playlist: parseInt(env.get("APIs.limit.playlist")),

        /**
         * @description Кол-во получаемых элементов трека при получении альбома
         * @protected
         */
        album: parseInt(env.get("APIs.limit.album")),

        /**
         * @description Кол-во получаемых элементов трека при поиске
         * @protected
         */
        search: parseInt(env.get("APIs.limit.search")),

        /**
         * @description Кол-во получаемых элементов трека при запросе треков автора
         * @protected
         */
        author: parseInt(env.get("APIs.limit.author"))
    };

    /**
     * @description Получаем лимиты по запросам
     * @return object
     * @public
     */
    public get limits() { return this._limits; };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._platforms; };

    /**
     * @description Исключаем платформы из общего списка
     * @return API.request[]
     * @public
     */
    public get allow() {
        return this._platforms.supported.filter((platform) => platform.name !== "DISCORD" && platform.auth);
    };

    /**
     * @description Ищем аудио если платформа может самостоятельно выдать аудио
     * @param track - трек у которого нет аудио
     * @readonly
     * @public
     */
    public readonly fetchAllow = (track: Track): Promise<string | Error> => {
        return new Promise(async (resolve) => {
            const api = new API.response(track.platform).get("track");

            // Если нет такого запроса
            if (!api) return resolve(Error(`[Song/${track.platform}]: not found callback for track`));

            // Если исходник уже не актуален, то получаем новый
            try {
                const song = await api.callback(track.url, {audio: true});

                // Если не удалось получить новый исходник
                if (song instanceof Error) return resolve(song);

                // Выдаем новый исходник
                return resolve(song.link);
            } catch (err) {
                return resolve(err);
            }
        });
    };

    /**
     * @description Получаем ссылку на трек если прошлая уже не актуальна
     * @param track - трек у которого нет аудио
     * @readonly
     * @public
     */
    public readonly fetch = (track: Track): Promise<string | Error> => {
        return new Promise(async (resolve) => {
            const platform = new API.response(this.platforms.supported.find((plt) => plt.requests.length >= 2 && plt.audio).name);

            try {
                // Ищем подходящий трек
                const tracks = await platform.get("search").callback(`${track.artist.title} - ${track.title}`, {limit: 5});
                if (tracks instanceof Error || tracks.length === 0) return resolve(null);

                // Если он был найден, то получаем исходник трека
                const song = await platform.get("track").callback(tracks?.at(0)?.url, {audio: true});
                if (song instanceof Error || !song.link) return resolve(null);

                // Отдаем исходник трека
                return resolve(song.link);
            } catch (err) {
                return resolve(Error(err));
            }
        });
    };
}