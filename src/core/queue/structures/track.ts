import { TrackResolvers, TRACK_BUFFERED_TIME, TRACK_CHECK_WAIT } from "#core/queue/controllers/provider";
import { APIRequestData, RestServerSide } from "#handler/rest";
import { httpsClient } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Базовый класс трека, для использования трека. Трек не привязан к чему либо!
 * @class Track
 * @extends TrackResolvers
 * @public
 */
export class Track extends TrackResolvers {
    /**
     * @description Здесь хранятся данные времени трека
     * @protected
     */
    protected _duration: TrackDuration;

    /**
     * @description Параметр для сохранения lyrics
     * @protected
     */
    protected _lyrics: string | null;

    /**
     * @description Пользователя включивший трек
     * @protected
     */
    protected _user: {
        /**
         * @description ID пользователя
         * @readonly
         */
        readonly id: string;

        /**
         * @description Имя/ник пользователя
         * @readonly
         */
        readonly username: string;

        /**
         * @description Ссылка на аватар пользователя
         * @readonly
         */
        readonly avatar?: string | null;
    };

    /**
     * @description Можно ли включать трек с другого ip адреса
     * @public
     */
    public proxy: boolean = false;

    /**
     * @description Идентификатор трека
     * @returns string
     * @public
     */
    public get ID() {
        return this._track.id;
    };

    /**
     * @description Ссылки трека на его самого
     * @returns string
     * @public
     */
    public get url() {
        return this._track.url;
    };

    /**
     * @description Наименование трека
     * @returns string
     * @public
     */
    public get name() {
        return this._track.title;
    };

    /**
     * @description Получаем отредактированное название трека в формате time [author](author_url) - [title](track_url)
     * @returns string
     * @public
     */
    public get name_replace() {
        // Удаляем лишнее скобки
        const title = `[${this._track.title.substring(0, 45)}](${this.url})`;
        const artist = `[${this.artist.title.substring(0, 45)}](${this.artist.url})`;

        if (this._api?.name === "YOUTUBE") return `\`\`${this._duration.split}\`\` ${title}`;
        return `\`\`${this._duration.split}\`\` ${artist} - ${title}`;
    };

    /**
     * @description Получаем превью трека
     * @returns { url: string }
     * @public
     */
    public get image(): { url: string } {
        // Если нет картинки
        if (!this._track?.image) return { url: db.images.no_image };
        return {
            url: this._track.image
        };
    };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get artist() {
        return {
            url: this._track.artist?.url,
            title: this._track.artist?.title,
            image: {
                url: db.images.disk
            }
        };
    };

    /**
     * @description Получаем пользователя который включил трек
     * @returns Track.user
     * @public
     */
    public get user() {
        return this._user;
    };

    /**
     * @description Добавляем запросчика трека
     * @param author - Автор запроса
     * @public
     */
    public set user(author) {
        const { username, id, avatar } = author;

        // Если нет автора трека, то автором станет сам пользователь
        if (!this._track.artist) this._track.artist = {
            url: `https://discordapp.com/users/${id}`,
            title: username
        };

        // Пользователь, который включил трек
        this._user = {
            username: username, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };

    /**
     * @description Получаем ссылку на исходный файл
     * @returns string
     * @public
     */
    public get link() {
        return this._track.audio;
    };

    /**
     * @description Добавление ссылки на трек
     * @param url - Ссылка или путь
     * @public
     */
    public set link(url: string) {
        this._track.audio = url;
    };

    /**
     * @description Данные о платформе с которой был получен трек
     * @returns RestServerSide.APIBase
     * @public
     */
    public get api() {
        return this._api;
    };

    /**
     * @description Получаем данные времени трека
     * @returns TrackDuration
     * @public
     */
    public get time() {
        return this._duration;
    };

    /**
     * @description Проверяем время и подгоняем к необходимым типам
     * @param time - Данные о времени трека
     * @public
     */
    public set time(time) {
        // Если время в числовом формате
        if (typeof time?.total === "number") {
            this._duration = { split: (time?.total as number).duration(), total: time.total };
        }
        // Если что-то другое
        else {
            // Если время указано в формате 00:00
            if (`${time?.total}`.match(/:/)) {
                this._duration = { split: time.total, total: (time.total as string).duration() };
                return;
            }

            const total = parseInt(time?.total);

            // Время трека
            if (isNaN(total) || !total) this._duration = { split: "Live", total: 0 };
            else this._duration = { split: total.duration(), total };
        }
    };


    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return Promise<string | Error>
     * @public
     */
    public get resource() {
        return Track.providers.audio.resolve(this);
    };

    /**
     * @description Получаем текст песни
     * @return Promise<string | Error>
     * @public
     */
    public get lyrics() {
        return new Promise(async (resolve) => {
            // Выдаем повторно текст песни
            if (this._lyrics || this._duration.total === 0) return resolve(this._lyrics);

            // Если ответ не был получен от сервера
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout server request")), 10e3)
            );

            const api = await Promise.race([
                new httpsClient({
                    url: `https://lrclib.net/api/get?artist_name=${encodeURIComponent(this.artist.title)}&track_name=${encodeURIComponent(this.name)}`,
                    userAgent: "UnTitles 0.5.0, Music bot, github.com/SNIPPIK/UnTitles",
                    timeout: TRACK_CHECK_WAIT
                }).toJson,
                timeoutPromise
            ]) as json | Error;

            // Если получаем вместо данных ошибку
            if (api instanceof Error) return resolve(api);

            // Если нет текста песни
            else if (api.statusCode === 404) return resolve(undefined);

            // Сохраняем текст песни
            this._lyrics = api?.syncedLyrics || api?.plainLyrics;

            // Выдаем впервые текст песни
            return resolve(api?.syncedLyrics || api?.plainLyrics);
        });
    };

    /**
     * @description Трек может быть буферизирован?
     * @public
     */
    public get isBuffered() {
        const current = this._duration.total;
        return current < TRACK_BUFFERED_TIME && current !== 0;
    };

    /**
     * @description Данные о тек треке в урезанном формате
     * @public
     */
    public get footer() {
        return `-# \`👤 ${this.user.username}\` • \`🕐 ${this.time.split}\` • \`${this.api.name.toLowerCase()}\``
    };

    /**
     * @description Создаем трек
     * @param _track - Данные трека с учетом <Song.track>
     * @param _api   - Данные о платформе
     * @public
     */
    public constructor(protected _track: APIRequestData.Track, protected _api: RestServerSide.API) {
        super();
        this.time = _track?.time as any;
        this.proxy = _api?.proxy ?? false;

        // Удаляем мусорные названия из текста
        if (_track.artist) _track.artist.title = `${_track.artist?.title}`.replace(/ - Topic|[\/()\[\]"]|[:;]/gi, "");
        _track.title = `${_track.title}`.replace(/Lyrics Video|[\/()\[\]"]|[:;]/gi, "");
    };
}

/**
 * @author SNIPPIK
 * @description Параметры времени трека
 * @interface TrackDuration
 * @private
 */
interface TrackDuration {
    /**
     * @description Время визуальное 00:00
     * @readonly
     * @private
     */
    split?: string;

    /**
     * @description Время в секундах
     * @readonly
     * @private
     */
    total: number;
}