import { TrackResolvers, TRACK_BUFFERED_TIME } from "#core/queue/controllers/provider.js";
import { APIRequestData, RestServerSide } from "#handler/rest/index.js";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Базовый класс трека, для использования трека. Трек не привязан к чему либо!
 * @class Track
 * @extends TrackResolvers
 * @public
 */
export class Track extends TrackResolvers {
    /** Здесь хранятся данные времени трека */
    protected _duration: TrackDuration;

    /** Параметр для сохранения lyrics */
    protected _lyrics: string | null;

    /** Данные о пользователе включивший трек */
    protected _user: TrackUser;

    /** Надо ли обходить ограничения через proxy */
    public proxy: boolean = false;

    /**
     * @description Идентификатор трека
     * @public
     */
    public get ID() {
        return this._track.id;
    };

    /**
     * @description Ссылки трека на его самого
     * @public
     */
    public get url() {
        return this._track.url;
    };

    /**
     * @description Наименование трека
     * @public
     */
    public get name() {
        return this._track.title;
    };

    /**
     * @description Получаем отредактированное название трека в формате time [author](author_url) - [title](track_url)
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
     * @public
     */
    public get image() {
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
     * @public
     */
    public get api() {
        return this._api;
    };

    /**
     * @description Получаем данные времени трека
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
     * @description Трек может быть буферизирован?
     * @public
     */
    public get isBuffered() {
        const current = this._duration.total;
        return current < TRACK_BUFFERED_TIME && current !== 0;
    };

    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @public
     */
    public get resource() {
        return Track.providers.audio.resolve(this);
    };

    /**
     * @description Получаем текст песни
     * @public
     */
    public get lyrics() {
        return Track.providers.lyrics.resolve(this);
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
 * @description Данные о пользователе который включил трек
 * @interface TrackUser
 * @private
 */
interface TrackUser {
    /** ID пользователя */
    readonly id: string;

    /** Имя/ник пользователя */
    readonly username: string;

    /** Ссылка на аватар пользователя */
    readonly avatar?: string | null;
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