import { TrackResolvers, TRACK_BUFFERED_TIME } from "#core/queue/controllers/provider.js";
import { APIRequestData, RestServerSide } from "#handler/rest/index.js";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * Регулярное выражение для очистки названий треков от часто встречающихся
 *  "шумовых" суффиксов и спецсимволов, мешающих поиску дубликатов и
 *  нормализации отображения.
 */
const REG_EXP_TITLE = /- Top|Lyrics Video|[\/()\[\]"]|[:;]/gi;

/**
 * @author SNIPPIK
 * Регулярное выражение для очистки имён исполнителей от типовых
 *  постфиксов и спецсимволов, аналогичное `REG_EXP_TITLE`, но
 *  адаптированное под особенности YouTube Music/каналов.
 */
const REG_EXP_ARTIST = / - Topic|[\/()\[\]"]|[:;]/gi;

/**
 * @author SNIPPIK
 * @description Базовый класс трека, для использования трека. Трек не привязан к чему либо!
 * @class Track
 * @public
 */
export class Track {
    /** Здесь хранятся данные времени трека */
    protected _duration: TrackDuration;

    /** Параметр для сохранения lyrics */
    protected _lyrics: string | null;

    /** Данные о пользователе включивший трек */
    protected _user: TrackUser;

    /** Надо ли обходить ограничения через proxy */
    public proxy: boolean = false;

    /** Ссылка на текст для предотвращения 2 вызова **/
    private _resource_lyrics?: Promise<string | Error>;

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

    private set name(name) {
        this._track.title = name.replace(REG_EXP_TITLE, "");
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
    public get image(): string {
        // Если нет картинки
        if (!this._track?.image) return db.images.no_image;
        return this._track.image;
    };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get artist() {
        return this._track.artist;
    };

    /**
     * @description Задаем данные автора трека
     * @public
     */
    private set artist(artist) {
        this._track.artist = {
            url: artist?.url,
            title: artist.title.replace(REG_EXP_ARTIST, ""),
            image: db.images.disk
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
            avatar: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp` : null
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
            //@ts-ignore
            if (typeof time?.total === "string" && time.total.includes(":")) {
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
     * @description Является ли трек потоковым
     * @public
     */
    public get isLive() {
        const current = this._duration.total;
        return !(current < TRACK_BUFFERED_TIME && current !== 0);
    };

    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @public
     */
    public get resource() {
        return TrackResolvers.providers.audio.resolve(this);
    };

    /**
     * @description Получаем текст песни
     * @public
     */
    public get lyrics() {
        return this._resource_lyrics ??=
            TrackResolvers.providers.lyrics.resolve(this);
    };

    /**
     * @description Создаем трек
     * @param _track - Данные трека с учетом <Song.track>
     * @param _api   - Данные о платформе
     * @public
     */
    public constructor(protected _track: APIRequestData.Track, protected _api: RestServerSide.API) {
        this.time = _track?.time as any;
        this.proxy = _api?.proxy ?? false;

        this.artist = _track.artist;
        this.name = _track.title;
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
    /** Время визуальное 00:00 */
    split?: string;

    /** Время трека в секундах */
    total: number;
}