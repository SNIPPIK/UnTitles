import {Song} from "@lib/player/queue";
import {API} from "@lib/handler";
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
         */
        supported: [] as API.request[],

        /**
         * @description Платформы с отсутствующими данными для авторизации
         */
        authorization: [] as API.platform[],

        /**
         * @description Платформы с возможностью получить аудио
         * По-умолчанию запрос идет к track
         */
        audio: [] as API.platform[],

        /**
         * @description Заблокированные платформы, только через owner.list
         */
        block: [] as API.platform[]
    };
    /**
     * @description База с лимитами обрабатываемых данных
     * @protected
     * @readonly
     */
    protected readonly _limits = {
        playlist: parseInt(env.get("APIs.limit.playlist")),
        album: parseInt(env.get("APIs.limit.album")),

        search: parseInt(env.get("APIs.limit.search")),
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
    public get allow() { return this._platforms.supported.filter((platform) => platform.name !== "DISCORD" && platform.auth); };

    /**
     * @author SNIPPIK
     * @description Ищем аудио если платформа может самостоятельно выдать аудио
     * @param track - трек у которого нет аудио
     */
    public readonly fetchAllow = (track: Song): Promise<string | Error> => {
        return new Promise(async (resolve) => {
            const api = new API.response(track.platform).find("track");

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
     */
    public readonly fetch = (track: Song): Promise<string | Error> => {
        return new Promise(async (resolve) => {
            const platform = new API.response(this.platforms.supported.find((plt) => plt.requests.length >= 2 && plt.audio).name);

            try {
                // Ищем подходящий трек
                const tracks = await platform.find("search").callback(`${track.author.title} - ${track.title}`, {limit: 5});
                if (tracks instanceof Error || tracks.length === 0) return resolve(null);

                // Если он был найден, то получаем исходник трека
                const song = await platform.find("track").callback(tracks?.at(0)?.url, {audio: true});
                if (song instanceof Error || !song.link) return resolve(null);

                // Отдаем исходник трека
                return resolve(song.link);
            } catch (err) {
                return resolve(Error(err));
            }
        });
    };
}