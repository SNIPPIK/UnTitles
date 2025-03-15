import {httpsClient, API} from "@handler/apis";
import {db} from "@app";
import * as console from "node:console";

/**
 * @author SNIPPIK
 * @description Класс трека, хранит все данные трека, время и возможность получить аудио ссылку или путь до файла
 * @class Track
 * @public
 */
export class Track {
    /**
     * @description Сами данные трека полученный в результате API
     * @readonly
     * @private
     */
    private readonly _track: Track.data;

    /**
     * @description Здесь хранятся данные времени трека
     * @readonly
     * @private
     */
    private _duration: TrackDuration;

    /**
     * @description Здесь хранятся данные с какой платформы был взят трек
     * @readonly
     * @private
     */
    private _api: TrackAPI;

    /**
     * @description Параметр для сохранения lyrics
     * @private
     */
    private _lyrics: string;

    /**
     * @description Пользователя включивший трек
     * @private
     */
    private _user: Track.user;

    /**
     * @description Выдаем id трека
     * @public
     */
    public get id() {
        // Если нет id трека
        if (!this._track?.id) return undefined;
        return this._track.id;
    };

    /**
     * @description Получаем название трека
     * @public
     */
    public get title() {
        if (!this._track?.title) return "null";
        return this._track.title;
    };

    /**
     * @description Получаем отредактированное название трека в формате time [author](author_url) - [title](track_url)
     * @public
     */
    public get titleReplaced() {
        // Удаляем лишнее скобки
        const title = `[${this.title.replace(/[()\[\]"]/g, "").substring(0, 45)}](${this.url})`;

        if (this.platform === "YOUTUBE") return `\`\`${this.time.split}\`\` ${title}`;
        return `\`\`${this.time.split}\`\` [${this.artist.title}](${this.artist.url}) - ${title}`;
    };

    /**
     * @description Получаем ссылку на трек
     * @public
     */
    public get url() {
        return this._track.url;
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
     * @description Получаем данные времени трека
     * @public
     */
    public get time() {
        return this._duration;
    };

    /**
     * @description Проверяем время и подгоняем к необходимым типам
     * @param time - Данные о времени трека
     * @protected
     */
    protected set time(time) {
        // Если время в числовом формате
        if (typeof time.total === "number") {
            this._duration = { split: (time.total as number).duration(), total: time.total };
        }
        // Если что-то другое
        else {
            const total = parseInt(time.total);

            // Время трека
            if (isNaN(total) || !total) this._duration = { split: "Live", total: 0 };
            else this._duration = { split: total.duration(), total };
        }
    };

    /**
     * @description Получаем превью трека
     * @public
     */
    public get image() {
        // Если нет картинки
        if (!this._track.image || !this._track.image.url) return { url: db.images.no_image };
        return this._track.image;
    };

    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() {
        return this._track.audio;
    };

    /**
     * @description Добавление ссылки на трек
     * @param url - Ссылка или путь
     */
    public set link(url: string) {
        this._track.audio = url;
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
     */
    public set user(author) {
        const { displayName, id, avatar } = author;

        // Если нет автора трека, то автором станет сам пользователь
        if (!this.artist) this._track.artist = {
            url: `https://discordapp.com/users/${id}`,
            title: displayName
        };

        // Пользователь, который включил трек
        this._user = {
            displayName: displayName, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };


    /**
     * @description Получаем платформу у которого был взят трек
     * @public
     */
    public get platform() {
        return this._api.platform;
    };

    /**
     * @description Добавление данных платформы
     * @public
     */
    public set api(api: Track["_api"]) {
        this._api = api;
    };

    /**
     * @description Получаем цвет трека
     * @public
     */
    public get color() {
        return this._api.color;
    };


    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return string | Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        const download = db.cache.isOn && this.platform !== "DISCORD";

        return new Promise(async (resolve) => {
            // Смотрим если ли кеш аудио
            if (download && db.cache.audio) {
                const status = db.cache.audio.status(this);

                // Если есть кеш аудио, то выдаем его
                if (status.status === "ended") return resolve(status.path);
            }

            // Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
            for (let refresh = 0; refresh < 3; refresh++) {

                // Проверяем ссылку на актуальность
                if (this.link && this.link.startsWith("http")) {
                    try {
                        const status = await new httpsClient(this.link, {method: "HEAD"}).status;

                        if (status) break;
                        else this.link = null;
                    } catch (err) {
                        // Если произошла ошибка при проверке статуса
                        console.log(err);
                        this.link = null;
                    }
                }

                // Если нет ссылки, то ищем замену
                if (!this.link) {
                    const link = await db.api.fetch(this);

                    // Если вместо ссылки получили ошибку
                    if (link instanceof Error || !link) {
                        if (refresh < 3) continue;
                        return resolve(Error("Fail find other track, requested a max 3!"));
                    }

                    this.link = link;
                }
            }

            // Если не удается найти ссылку через n попыток
            if (!this.link) return resolve(Error(`Fail update link resource`));
            else {
                // Сохраняем аудио кеш
                if (download && db.cache.audio) db.cache.audio.set(this);
            }

            // Отдаем ссылку на трек
            return resolve(this.link);
        });
    };

    /**
     * @description Получаем текст песни
     * @return Promise<string | Error>
     * @public
     */
    public get lyrics(): Promise<string | Error> {
        return new Promise((resolve) => {
            // Выдаем повторно текст песни
            if (this._lyrics) return resolve(this._lyrics);

            new httpsClient(`https://lrclib.net/api/get?artist_name=${this.artist.title.split(" ").join("+")}&track_name=${this.title.split(" ").join("+")}`, {
                useragent: "UnTitles 0.2.2, Music bot, github.com/SNIPPIK/UnTitles"
            }).toJson.then((item) => {
                // Если получаем вместо данных ошибку
                if (item instanceof Error) return resolve(item);

                // Если нет текста песни
                else if (item.statusCode === 404) return resolve(undefined);

                // Сохраняем текст песни
                this._lyrics = item?.syncedLyrics || item?.plainLyrics;

                // Выдаем впервые текст песни
                return resolve(item?.syncedLyrics || item?.plainLyrics);
            });
        });
    };

    /**
     * @description Создаем трек
     * @param track - Данные трека с учетом <Song.track>
     */
    public constructor(track: Track.data) {
        this.time = track.time as any;

        // Удаляем мусорные названия из текста
        if (track.artist) track.artist.title = track.artist?.title.replace(/ - Topic/gi, "");
        track.title = track.title.replace(/\(Lyrics Video\)/gi, "");

        // Удаляем ненужные данные
        delete track.time;

        // Добавляем данные
        this._track = track;
    };
}

/**
 * @author SNIPPIK
 * @description Параметры времени трека
 * @interface TrackDuration
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
 * @description Параметры платформы трека
 * @interface TrackAPI
 */
interface TrackAPI {
    /**
     * @description Имя платформы с которой был взят трек
     * @readonly
     * @private
     */
    platform: API["name"];

    /**
     * @description Цвет платформы
     * @readonly
     * @private
     */
    color: number;
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
        image: {
            /**
             * @description Ссылка на картинку трека
             */
            url: string
        };

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
     * @interface playlist
     */
    export interface playlist {
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
        image: {
            /**
             * @description Ссылка на картинку плейлиста
             */
            url: string;
        };

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
        image?: {
            /**
             * @description Ссылка на картинку артиста
             */
            url: string
        };
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
        readonly displayName: string;

        /**
         * @description Ссылка на аватар пользователя
         * @readonly
         */
        readonly avatar: string | null;
    }
}