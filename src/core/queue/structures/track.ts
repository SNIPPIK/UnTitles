import {httpsClient, httpsStatusCode} from "#structures";
import type { RestServerSide } from "#handler/rest";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс трека, хранит все данные трека, время и аудио ссылку или путь до файла
 * @class BaseTrack
 * @protected
 */
abstract class BaseTrack {
    /**
     * @description Здесь хранятся данные времени трека
     * @protected
     */
    protected _duration: TrackDuration;

    /**
     * @description Параметр для сохранения lyrics
     * @protected
     */
    protected _lyrics: string;

    /**
     * @description Пользователя включивший трек
     * @protected
     */
    protected _user: Track.user;

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

            const total = parseInt(time.total);

            // Время трека
            if (isNaN(total) || !total) this._duration = { split: "Live", total: 0 };
            else this._duration = { split: total.duration(), total };
        }
    };

    /**
     * @description Создаем трек
     * @param _track - Данные трека с учетом <Song.track>
     * @param _api   - Данне о платформе
     * @public
     */
    public constructor(protected _track: Track.data, protected _api: RestServerSide.APIBase) {
        this.time = _track.time as any;

        // Удаляем мусорные названия из текста
        if (_track.artist) _track.artist.title = `${_track.artist?.title}`.replace(/ - Topic|[\/()\[\]"]|[:;]/gi, "");
        _track.title = `${_track.title}`.replace(/Lyrics Video|[\/()\[\]"]|[:;]/gi, "");
    };
}


/**
 * @author SNIPPIK
 * @description Класс трека, реализует другой класс <BaseTrack>
 * @class Track
 * @public
 */
export class Track extends BaseTrack {
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

        if (this._api.name === "YOUTUBE") return `\`\`${this._duration.split}\`\` ${title}`;
        return `\`\`${this._duration.split}\`\` [${this.artist.title}](${this.artist.url}) - ${title}`;
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
        if (!this.artist) this._track.artist = {
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
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        return new Promise(async (resolve) => {
            const resource = await this._prepareResource();

            // Если произошла ошибка при получении ресурса
            if (resource instanceof Error || !resource) {
                this.link = null;

                // Если уже нельзя повторить
                return resolve(resource);
            }

            else this.link = resource;

            // Отдаем ссылку или путь до файла
            return resolve(this.link);
        });
    };

    /**
     * @description Получаем текст песни
     * @return Promise<string | Error>
     * @public
     */
    public get lyrics(): Promise<string | Error> {
        return new Promise(async (resolve) => {
            // Выдаем повторно текст песни
            if (this._lyrics || this._duration.total === 0) return resolve(this._lyrics);

            // Если ответ не был получен от сервера
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout server request")), 10e3)
            );

            let api = await Promise.race([await new httpsClient(
                {
                    url: `https://lrclib.net/api/get?artist_name=${encodeURIComponent(this.artist.title)}&track_name=${encodeURIComponent(this.name)}`,
                    userAgent: "UnTitles 0.3.0, Music bot, github.com/SNIPPIK/UnTitles"
                }
            ).toJson, timeoutPromise]) as json | Error;

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
     * @description Функция подготавливающая путь до аудио, так же проверяющая его актуальность
     * @returns Promise<string | Error>
     * @private
     */
    private _prepareResource = async (): Promise<string | Error> => {
        // Если включено кеширование
        if (db.cache.audio) {
            const status = db.cache.audio.status(this);

            // Если есть кеш аудио, то выдаем его
            if (status.status === "ended") {
                this.link = status.path;
                return status.path;
            }
        }

        // Если есть данные об исходном файле
        if (this.link) {
            // Проверяем ссылку на актуальность
            if (this.link.startsWith("http")) {
                try {
                    const status = await new httpsClient({url: this.link}).toHead;
                    const error = httpsStatusCode.parse(status);

                    // Если получена ошибка
                    if (error) return error;

                    // Добавляем трек в кеширование
                    if (db.cache.audio) db.cache.audio.add(this);
                    return this.link;
                } catch (err) { // Если произошла ошибка при проверке статуса
                    return Error(`Unknown error, ${err}`);
                }
            }

            // Скорее всего это файл
            return this.link;
        }

        // Если нет ссылки на исходный файл
        try {
            const song = await db.api.fetchAudioLink(this);

            // Если вместо ссылки получили ошибку
            if (song instanceof Error) return song;

            // Если платформа не хочет давать данные трека
            else if (!song) return Error(`The platform does not provide a link`);

            this.link = song;
            return this._prepareResource();
        } catch (err) {
            return Error(`This link track is not available... Fail update link!`);
        }
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
    split: string;

    /**
     * @description Время в секундах
     * @readonly
     * @private
     */
    total: number;
}


/**
 * @author SNIPPIK
 * @description Все интерфейсы для работы с системой треков
 * @namespace Track
 * @public
 */
export namespace Track {
    /**
     * @description Данные трека для работы класса
     * @interface data
     */
    export interface data {
        /**
         * @description Уникальный id трека
         * @readonly
         */
        readonly id: string

        /**
         * @description Название трека
         * @readonly
         */
        title: string;

        /**
         * @description Ссылка на трек, именно на трек
         * @readonly
         */
        readonly url: string;

        /**
         * @description Данные об авторе трека
         */
        artist: artist;

        /**
         * @description База с картинками трека и автора
         */
        image: string;

        /**
         * @description Данные о времени трека
         */
        time: {
            /**
             * @description Общее время трека
             */
            total: string;

            /**
             * @description Время конвертированное в 00:00
             */
            split?: string;
        }

        /**
         * @description Данные об исходном файле, он же сам трек
         */
        audio?: string;
    }

    /**
     * @description Пример получаемого плейлиста
     * @interface list
     */
    export interface list {
        /**
         * @description Ссылка на плейлист
         * @readonly
         */
        readonly url: string;

        /**
         * @description Название плейлиста
         * @readonly
         */
        readonly title: string;

        /**
         * @description Что в себе содержит плейлист
         */
        items: Track[];

        /**
         * @description Картинка автора плейлиста
         */
        image: string;

        /**
         * @description Данные об авторе плейлиста
         */
        artist?: artist;
    }

    /**
     * @description Данные об авторе трека или плейлиста
     * @interface artist
     */
    export interface artist {
        /**
         * @description Ник/имя автора трека
         * @readonly
         */
        title: string;

        /**
         * @description Ссылка на автора трека
         * @readonly
         */
        readonly url: string;

        /**
         * @description Картинка артиста трека
         */
        image?: string;
    }

    /**
     * @description Данные о пользователе для отображения об пользователе включившем трек
     * @interface user
     */
    export interface user {
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
    }
}