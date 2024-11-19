import {Interact} from "@lib/discord/utils/Interact";
import {httpsClient} from "@lib/request";
import {ExtraPlayer} from "@lib/player";
import {API} from "@handler";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Список очередей для работы плеера
 * @class Queue
 * @public
 */
export class Queue {
    /**
     * @description Кнопки для сообщения
     * @private
     */
    private readonly _components = [

        /**
         * @description Первый сет кнопок
         * @private
         */
        {
            type: 1,
            components: [
                { type: 2, emoji: {id: db.emojis.button.shuffle},   custom_id: 'shuffle',       style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.pref},      custom_id: 'last',          style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.pause},     custom_id: 'resume_pause',  style: 2 },
                { type: 2, emoji: {id: db.emojis.button.next},      custom_id: 'skip',          style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.loop},      custom_id: 'repeat',        style: 2 }
            ]
        },

        /**
         * @description Второй сет кнопок
         * @private
         */
        {
            type: 1,
            components: [
                { type: 2, emoji: {id: db.emojis.button.queue},         custom_id: 'queue',         style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.lyrics},        custom_id: 'lyrics',        style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.stop},          custom_id: 'stop_music',    style: 4 },
                { type: 2, emoji: {id: db.emojis.button.filters},       custom_id: 'filters_menu',  style: 2, disable: true },
                { type: 2, emoji: {id: db.emojis.button.replay},        custom_id: 'replay',        style: 2 },
            ]
        }
    ];

    /**
     * @description Данные временно хранящиеся в очереди
     * @private
     */
    private readonly _data = {
        /**
         * @description Тип повтора
         * @private
         */
        repeat:     "off" as "off" | "song" | "songs",

        /**
         * @description Смешивание треков
         * @private
         */
        shuffle:    false as boolean,

        /**
         * @description Сообщение пользователя
         * @private
         */
        message:    null as Interact,

        /**
         * @description Плеер для проигрывания музыки
         * @private
         */
        player:     null as ExtraPlayer
    };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() { return this._data.player; };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice() { return this._data.message.voice; };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice - Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: Interact["voice"]) {
        // Если уже есть голосовое подключение
        if (this.player?.voice?.connection) {
            // Удаляем старое голосовое подключение, для предотвращения утечек памяти
            this.player.voice.connection.destroy();
        }

        // Задаем новое голосовое подключение
        this.player.voice.connection = db.voice.join({
            selfDeaf: true,
            selfMute: false,

            guildId: this.guild.id,
            channelId: voice.channel.id
        }, this.guild.voiceAdapterCreator);
    };



    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get tracks() {
        if (!this._data.player) return;
        return this._data.player.tracks;
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean { return this._data.shuffle; };

    /**
     * @description Сохраняем данные перетасовки
     * @param bol - Параметр boolean
     * @public
     */
    public set shuffle(bol) { this._data.shuffle = bol; };

    /**
     * @description Сохраняем тип повтора
     * @param loop - Тип повтора
     * @public
     */
    public set repeat(loop: "off" | "song" | "songs") { this._data.repeat = loop; };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() { return this._data.repeat; };



    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        const first = this._components[0].components;
        const two = this._components[1].components;

        // Кнопка перетасовки очереди
        if (this.shuffle) Object.assign(first[0], {style: 1});
        else Object.assign(first[0], {style: 2});

        // Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(first[2], {emoji: {id: db.emojis.button.resume}});
        else Object.assign(first[2], {emoji: {id: db.emojis.button.pause}});

        // Кнопка повтора
        if (this.repeat === "song") Object.assign(first[4], { emoji: {id: db.emojis.button.loop_one}, style: 1 });
        else if (this.repeat === "songs") Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 1 });
        else Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 2 });

        // Если это первый трек в списке, то не позволяем пользователям возвращать трек
        if (this.tracks.position > 0) Object.assign(first[1], { disabled: false, style: 3 });
        else Object.assign(first[1], { disabled: true });


        // Ограничиваем кнопку очередь
        if (this.tracks.size > 5) {
            Object.assign(two[0], { disabled: false });
        } else {
            Object.assign(two[0], { disabled: true });
        }

        // Если есть еще треки, то можно будет посмотреть очередь
        // Если всего один трек, то не позволяем его пропустить
        if (this.tracks.size > 1) {
            Object.assign(first[0], { disabled: false });
            Object.assign(first[3], { disabled: false, style: 3 });
            Object.assign(two[1], { disabled: false });
        } else {
            Object.assign(first[0], { disabled: true });
            Object.assign(first[3], { disabled: true });
            Object.assign(two[1], { disabled: true });
        }

        return this._components;
    };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() { return this._data.message; };

    /**
     * @description Выдаем сервер к которому привязана очередь
     * @return Guild
     * @public
     */
    public get guild() { return this.message.guild; };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message: Interact) { this._data.message = message; };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @public
     */
    public constructor(message: Interact) {
        const ID = message.guild.id;

        // Создаем плеер
        this._data.player = new ExtraPlayer(ID);

        // Добавляем данные в класс
        this.message = message;
        this.voice = message.voice;

        // Добавляем очередь в список очередей
        db.audio.queue.set(ID, this);

        // В конце функции выполнить запуск проигрывания
        setImmediate(() => {
            this.player.play(this.tracks.song);
        });
    };

    /**
     * @description Очищаем очередь
     * @public
     */
    public cleanup = () => {
        db.audio.cycles.players.remove(this.player);
        if (this.player) this.player.cleanup();

        for (let item of Object.keys(this._data)) this._data[item] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Ключевой элемент музыки
 * @class Track
 * @public
 */
export class Track {
    /**
     * @description Здесь хранятся данные с какой платформы был взят трек
     * @private
     */
    private readonly _api: { platform: API.platform; color: number; } = { platform: null, color: null};

    /**
     * @description Здесь хранятся данные времени трека
     * @private
     */
    private readonly _duration: { split: string; total: number; } = null;

    /**
     * @description Сами данные трека
     * @private
     */
    private readonly _track: Track.data & { user?: Track.user; duration?: { split: string; total: number; }} = {
        title: null, url: null, image: null, artist: null, duration: null, time: null, audio: { url: null, type: "url" }
    };
    /**
     * @description Получаем платформу у которого был взят трек
     * @public
     */
    public get platform() { return this._api.platform; };

    /**
     * @description Добавление данных платформы
     * @public
     */
    public set api(api: Track["_api"]) { Object.assign(this._api, api); };

    /**
     * @description Получаем цвет трека
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Получаем название трека
     * @public
     */
    public get title() {
        if (!this._track.title) return "null";
        return this._track.title;
    };

    /**
     * @description Получаем отредактированное название трека
     * @public
     */
    public get titleReplaced() {
        // Удаляем лишнее скобки
        const title = `[${this.title.replace(/[()\[\]"]/g, "").substring(0, 45)}](${this.url})`;

        if (this.platform === "YOUTUBE") return `\`\`[${this.time.split}]\`\` ${title}`;
        return `\`\`[${this.time.split}]\`\` [${this.artist.title}](${this.artist.url}) - ${title}`;
    };

    /**
     * @description Получаем ссылку на трек
     * @public
     */
    public get url() { return this._track.url; };

    /**
     * @description Получаем данные автора трека
     * @public
     */
    public get artist() { return this._track.artist; };

    /**
     * @description Получаем время трека
     * @public
     */
    public get time() { return this._duration; };

    /**
     * @description Получаем картинки автора и трека
     * @public
     */
    public get image() { return this._track.image; };

    /**
     * @description Получаем пользователя который включил трек
     * @public
     */
    public get user() { return this._track.user; };

    /**
     * @description Добавляем запросчика трека
     * @param author - Автор запроса
     */
    public set user(author) {
        const { username, id, avatar } = author;

        //Если нет автора трека, то автором станет сам пользователь
        if (!this.artist) this._track.artist = {
            title: username, url: `https://discordapp.com/users/${id}`
        };

        //Пользователь, который включил трек
        this._track.user = {
            username, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };

    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() { return this._track.audio.url; };

    /**
     * @description Добавление ссылки на трек
     * @param url - Ссылка или путь
     */
    public set link(url: string) { this._track.audio.url = url; };

    /**
     * @description Проверяем ссылку на доступность и выдаем ее если ссылка имеет код !==200, то обновляем
     * @return string | Promise<string | Error>
     * @public
     */
    public get resource(): Promise<string | Error> {
        return new Promise(async (resolve) => {
            //Проверяем ссылку на работоспособность, если 3 раза будет неудача ссылка будет удалена
            for (let ref = 0; ref < 3; ref++) {

                //Проверяем ссылку на актуальность
                if (this.link && this.link.startsWith("http")) {
                    try {
                        const status = await new httpsClient(this.link, {method: "HEAD"}).status;

                        if (status) break
                        else this.link = null;
                    } catch (err) {
                        this.link = null;
                    }
                }

                //Если нет ссылки, то ищем замену
                if (!this.link) {
                    const link = !db.api.platforms.audio.includes(this.platform) ? await db.api.fetchAllow(this) : await db.api.fetch(this);

                    //Если вместо ссылки получили ошибку
                    if (link instanceof Error || !link) {
                        if (ref < 3) continue;
                        else return resolve("Fail find other track, requested a max 3!");
                    }

                    this.link = link;
                }
            }

            //Если не удается найти ссылку через n попыток
            if (!this.link) return resolve(Error(`[SONG]: Fail update link resource`));
            return resolve(`link:|${this.link}`);
        });
    };

    /**
     * @description Создаем трек
     * @param track - Данные трека с учетом <Song.track>
     */
    public constructor(track: Track.data) {
        //Высчитываем время
        if (track.time.total.match(/:/)) {
            this._duration = { split: track.time.total, total: track.time.total.duration() };
        } else {
            const total = parseInt(track.time.total) || 321;

            //Время трека
            if (isNaN(total) || !total) this._duration = { split: "Live", total: 0 };
            else this._duration = { split: total.duration(), total };
        }

        //Изображения трека
        track["image"] = track?.image ?? { url: db.emojis.noImage };

        //Удаляем ненужные данные
        delete track.time;

        //Добавляем данные
        Object.assign(this._track, track);
    };
}

/**
 * @author SNIPPIK
 * @description Все интерфейсы для работы системы треков
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
         * @description Название трека
         */
        title: string;

        /**
         * @description Ссылка на трек, именно на трек
         */
        url: string;

        /**
         * @description Данные об авторе трека
         */
        artist: artist;

        /**
         * @description База с картинками трека и автора
         */
        image: { url: string };

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
        audio?: {
            type: "file" | "url";
            url: string;
        }
    }

    /**
     * @description Пример получаемого плейлиста
     * @interface playlist
     */
    export interface playlist {
        url: string;
        title: string;
        items: Track[];
        image: { url: string; };
        artist?: artist;
    }

    /**
     * @description Данные об авторе трека или плейлиста
     * @interface artist
     */
    export interface artist {
        /**
         * @description Ник/имя автора трека
         */
        title: string;

        /**
         * @description Ссылка на автора трека
         */
        url: string;

        image?: {url: string}
    }

    /**
     * @description Данные о пользователе для отображения об пользователе включившем трек
     * @interface user
     */
    export interface user {
        /**
         * @description ID пользователя
         */
        id: string;

        /**
         * @description Имя/ник пользователя
         */
        username: string;

        /**
         * @description Ссылка на аватар пользователя
         */
        avatar: string | null;
    }
}