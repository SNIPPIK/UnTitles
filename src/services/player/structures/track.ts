import {RestAPIBase} from "@handler/rest/apis";
import {httpsClient} from "@handler/rest";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Класс трека, хранит все данные трека, время и возможность получить аудио ссылку или путь до файла
 * @class Track
 * @public
 */
export class Track {
    /**
     * @description Внутренняя информация трека и его составных
     * @readonly
     * @private
     */
    private readonly _information = {
        /**
         * @description Сами данные трека полученный в результате API
         * @readonly
         * @private
         */
        _track: null as Track.data,

        /**
         * @description Здесь хранятся данные времени трека
         * @readonly
         * @private
         */
        _duration: null as TrackDuration,

        /**
         * @description Параметр для сохранения lyrics
         * @private
         */
        _lyrics: null as string,

        /**
         * @description Пользователя включивший трек
         * @private
         */
         _user: null as Track.user,

        /**
         * @description Здесь хранятся данные с какой платформы был взят трек
         * @readonly
         * @private
         */
        _api: null as RestAPIBase
    };

    /**
     * @description Идентификатор трека
     * @public
     */
    public get ID() {
        return this._information._track.id;
    };

    /**
     * @description Ссылки трека на его самого
     * @public
     */
    public get url() {
      return this._information._track.url
    };

    /**
     * @description Наименование трека
     * @public
     */
    public get name() {
        return this._information._track.title;
    };

    /**
     * @description Получаем отредактированное название трека в формате time [author](author_url) - [title](track_url)
     * @public
     */
    public get name_replace() {
        // Удаляем лишнее скобки
        const title = `[${this.name.replace(/[()\[\]"]/g, "").substring(0, 45)}](${this.url})`;

        if (this.api.name === "YOUTUBE") return `\`\`${this.time.split}\`\` ${title}`;
        return `\`\`${this.time.split}\`\` [${this.artist.title}](${this.artist.url}) - ${title}`;
    };

    /**
     * @description Получаем превью трека
     * @public
     */
    public get image() {
        // Если нет картинки
        if (!this._information._track?.image?.url) return { url: db.images.no_image };
        return this._information._track.image;
    };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get artist() {
        return {
            url: this._information._track.artist?.url,
            title: this._information._track.artist?.title,
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
        return this._information._duration;
    };

    /**
     * @description Проверяем время и подгоняем к необходимым типам
     * @param time - Данные о времени трека
     * @protected
     */
    protected set time(time) {
        // Если время в числовом формате
        if (typeof time.total === "number") {
            this._information._duration = { split: (time.total as number).duration(), total: time.total };
        }
        // Если что-то другое
        else {
            // Если время указано в формате 00:00
            if (`${time.total}`.match(/:/)) {
                this._information._duration = { split: time.total, total: (time.total as string).duration() };
                return;
            }

            const total = parseInt(time.total);

            // Время трека
            if (isNaN(total) || !total) this._information._duration = { split: "Live", total: 0 };
            else this._information._duration = { split: total.duration(), total };
        }
    };


    /**
     * @description Получаем пользователя который включил трек
     * @public
     */
    public get user() {
        return this._information._user;
    };

    /**
     * @description Добавляем запросчика трека
     * @param author - Автор запроса
     */
    public set user(author) {
        const { displayName, id, avatar } = author;

        // Если нет автора трека, то автором станет сам пользователь
        if (!this.artist) this._information._track.artist = {
            url: `https://discordapp.com/users/${id}`,
            title: displayName
        };

        // Пользователь, который включил трек
        this._information._user = {
            displayName: displayName, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };


    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() {
        return this._information._track.audio;
    };

    /**
     * @description Добавление ссылки на трек
     * @param url - Ссылка или путь
     */
    public set link(url: string) {
        this._information._track.audio = url;
    };

    /**
     * @description Данные о платформе с которой был получен трек
     * @public
     */
    public get api() {
        return this._information._api;
    };


    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return string | Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        return new Promise(async (resolve) => {
            for (let i = 0; i < 3; i++) {
                // Если есть данные об исходном файле
                if (this.link) {
                    // Проверяем ссылку на актуальность
                    if (this.link.startsWith("http")) {
                        try {
                            const status = await new httpsClient(this.link, {method: "HEAD"}).status;

                            // Если статус = good
                            if (status) {
                                // Добавляем трек в кеширование
                                if (this.api.name !== "DISCORD" && db.cache.audio) db.cache.audio.set(this);
                                break;
                            }

                            // Если статус плохой, то удаляем ссылку
                            this.link = null;
                        } catch (err) { // Если произошла ошибка при проверке статуса
                            this.link = null;
                            if (i < 3) continue;
                            return resolve(Error(`This link track is not available... Fail check link!`));
                        }
                    }

                    // Если указан путь до файла, он будет рабочим наверно xD
                    else break;
                }

                // Если включено кеширование
                if (db.cache.audio) {
                    const status = db.cache.audio.status(this);

                    // Если есть кеш аудио, то выдаем его
                    if (status.status === "ended") {
                        this.link = status.path;
                        break;
                    }
                }

                // Если нет ссылки на исходный файл
                try {
                    const link = await db.api.fetch(this);

                    // Если вместо ссылки получили ошибку
                    if (link instanceof Error) return resolve(Error(`${link}`));

                    // Если платформа не хочет давать данные трека
                    else if (!link) return resolve(Error(`The platform does not provide a link`));

                    this.link = link;
                } catch (err) {
                    if (i < 3) continue;
                    return resolve(Error(`This link track is not available... Fail update link!`));
                }
            }

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
        return new Promise((resolve) => {
            // Выдаем повторно текст песни
            if (this._information._lyrics) return resolve(this._information._lyrics);

            new httpsClient(`https://lrclib.net/api/get?artist_name=${this.artist.title.split(" ").join("+")}&track_name=${this.name.split(" ").join("+")}`, {
                useragent: "UnTitles 0.2.2, Music bot, github.com/SNIPPIK/UnTitles"
            }).toJson.then((item) => {
                // Если получаем вместо данных ошибку
                if (item instanceof Error) return resolve(item);

                // Если нет текста песни
                else if (item.statusCode === 404) return resolve(undefined);

                // Сохраняем текст песни
                this._information._lyrics = item?.syncedLyrics || item?.plainLyrics;

                // Выдаем впервые текст песни
                return resolve(item?.syncedLyrics || item?.plainLyrics);
            });
        });
    };

    /**
     * @description Создаем трек
     * @param track - Данные трека с учетом <Song.track>
     * @param api   - Данне о платформе
     */
    public constructor(track: Track.data, api: RestAPIBase) {
        this.time = track.time as any;

        // Удаляем мусорные названия из текста
        if (track.artist) track.artist.title = `${track.artist?.title}`.replace(/ - Topic/gi, "");
        track.title = `${track.title}`.replace(/\(Lyrics Video\)/gi, "");

        // Удаляем ненужные данные
        delete track.time;

        // Добавляем данные
        this._information._track = track;
        this._information._api = api;
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