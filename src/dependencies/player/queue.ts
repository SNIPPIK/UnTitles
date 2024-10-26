import {Interact} from "@lib/discord/utils/Interact";
import {httpsClient} from "@lib/request";
import {ExtraPlayer} from "@lib/player";
import {Voice} from "@lib/voice";
import {API} from "@handler";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Список очередей для работы плеера
 * @class Queue
 * @public
 */
export class Queue {
    private readonly _data = {
        repeat:     "off" as "off" | "song" | "songs",
        shuffle:    false as boolean,

        message:    null as Interact,
        player:     null as ExtraPlayer
    };
    private readonly _components = [
        {
            type: 1,
            components: [
                { type: 2, emoji: {id: db.emojis.button.shuffle},   custom_id: 'shuffle',       style: 2 },  //Shuffle
                { type: 2, emoji: {id: db.emojis.button.pref},      custom_id: 'last',          style: 2 },  //Last song
                { type: 2, emoji: {id: db.emojis.button.pause},     custom_id: 'resume_pause',  style: 2 },  //Resume/Pause
                { type: 2, emoji: {id: db.emojis.button.next},      custom_id: 'skip',          style: 2 },  //Skip song
                { type: 2, emoji: {id: db.emojis.button.loop},      custom_id: 'repeat',        style: 2 }   //Loop
            ]
        },

        {
            type: 1,
            components: [
                { type: 2, emoji: {id: db.emojis.button.replay},        custom_id: 'replay',        style: 2 },  //Shuffle
                { type: 2, emoji: {id: db.emojis.button.queue},         custom_id: 'queue',         style: 2 },  //Last song
                { type: 2, emoji: {id: db.emojis.button.stop},          custom_id: 'stop_music',    style: 4 },  //Resume/Pause
                { type: 2, emoji: {id: db.emojis.button.filters},       custom_id: 'filters_menu',  style: 2 },  //Skip song
                { type: 2, emoji: {id: db.emojis.button.lyrics},        custom_id: 'lyrics',        style: 2 }   //Loop
            ]
        }
    ]

    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get songs() {
        if (!this._data.player) return;
        return this._data.player.tracks;
    };

    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        const FirstComponent = this._components[0].components;

        /**
         * @description Модификация 1 сета кнопок
         */
        if (this.shuffle) Object.assign(FirstComponent[0], {style: 1});
        else Object.assign(FirstComponent[0], {style: 2});

        //Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(FirstComponent[2], {emoji: {id: db.emojis.button.resume}});
        else Object.assign(FirstComponent[2], {emoji: {id: db.emojis.button.pause}});

        if (this.repeat === "song") Object.assign(FirstComponent[4], { emoji: {id: db.emojis.button.loop_one}, style: 1 });
        else if (this.repeat === "songs") Object.assign(FirstComponent[4],{ emoji: {id: db.emojis.button.loop}, style: 1 });
        else Object.assign(FirstComponent[4],{ emoji: {id: db.emojis.button.loop}, style: 2 });
        /**/

        return this._components;
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
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() { return this._data.message; };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice() { return this._data.message.voice; };

    /**
     * @description Выдаем сервер к которому привязана очередь
     * @return Guild
     * @public
     */
    public get guild() { return this.message.guild; };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() { return this._data.player; };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message: Interact) { this._data.message = message; };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice - Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: Interact["voice"]) {
        this.player.voice.connection = Voice.join({
            selfDeaf: true,
            selfMute: false,

            guildId: this.guild.id,
            channelId: voice.channel.id
        }, this.guild.voiceAdapterCreator);
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @public
     */
    public constructor(message: Interact) {
        const ID = message.guild.id;

        // Создаем плеер
        this._data.player = new ExtraPlayer(ID);

        // В конце функции выполнить запуск проигрывания
        setImmediate(() => {
            this.player.play(this.songs.song);
        });

        // Добавляем данные в класс
        this.message = message;
        this.voice = message.voice;

        // Добавляем очередь в список очередей
        db.audio.queue.set(ID, this);
    };

    /**
     * @description Очищаем очередь
     * @public
     */
    public cleanup = () => {
        db.audio.cycles.players.remove(this.player);
        this.player.cleanup();

        for (let item of Object.keys(this._data)) this._data[item] = null;
    };
}


/**
 * @author SNIPPIK
 * @description Все интерфейсы для работы системы треков
 * @namespace Song
 * @public
 */
export namespace Song {
    /**
     * @description Какие данные доступны в <song>.requester
     * @interface
     */
    export interface requester {
        //ID Пользователя
        id: string;

        //Ник пользователя
        username: string;

        //Ссылка на аватар пользователя
        avatar: string | null;
    }

    /**
     * @description Пример получаемого трека
     * @interface
     */
    export interface track {
        //Название трека
        title: string;

        //Ссылка на трек
        url: string;

        //Картинка трека
        image: image;

        //Автор трека
        author: author,

        //Время
        duration: {
            //Длительность в секундах
            seconds: string;
        };

        //Исходный файл
        link?: string | null;
    }

    /**
     * @description Пример получаемого автора трека
     * @interface
     */
    export interface author {
        //Имя автора
        title: string;

        //Ссылка на автора
        url: string | undefined;
        image?: image;
    }

    /**
     * @description Пример получаемого плейлиста
     * @interface
     */
    export interface playlist {
        url: string;
        title: string;
        items: Song[];
        image: { url: string; };
        author?: author;
    }

    /**
     * @description Параметры картинки
     * @interface
     */
    export interface image {
        //Ссылка на картинку
        url: string;

        //Длина
        height?: number;

        //Высота
        width?: number
    }
}

/**
 * @author SNIPPIK
 * @description Ключевой элемент музыки
 * @class Song
 * @public
 */
export class Song {
    private readonly _api: { platform: API.platform; color: number; } = null;
    private readonly _duration: { full: string; seconds: number; } = null;
    private readonly _track: Song.track & { requester?: Song.requester; duration?: { full: string; seconds: number; }} = {
        title: null, url: null, image: null, author: null, duration: null
    };
    /**
     * @description Получаем платформу у которого был взят трек
     * @public
     */
    public get platform() { return this._api.platform; };

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
        const title = `[${this.title.replace(/[\(\)\[\]"]/g, "").substring(0, 45)}](${this.url})`;

        if (this.platform === "YOUTUBE") return `\`\`[${this.duration.full}]\`\` ${title}`;
        return `\`\`[${this.duration.full}]\`\` [${this.author.title}](${this.author.url}) - ${title}`;
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
    public get author() { return this._track.author; };

    /**
     * @description Получаем время трека
     * @public
     */
    public get duration() { return this._duration; };

    /**
     * @description Получаем картинки автора и трека
     * @public
     */
    public get image() { return this._track.image; };

    /**
     * @description Получаем пользователя который включил трек
     * @public
     */
    public get requester() { return this._track.requester; };

    /**
     * @description Добавляем запросчика трека
     * @param author - Автор запроса
     */
    public set requester(author) {
        const { username, id, avatar } = author;

        //Если нет автора трека, то автором станет сам пользователь
        if (!this.author) this._track.author = {
            title: username, url: `https://discordapp.com/users/${id}`
        };

        //Пользователь, который включил трек
        this._track.requester = {
            username, id,
            avatar: `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp`
        };
    };

    /**
     * @description Получаем ссылку на исходный файл
     * @public
     */
    public get link() { return this._track.link; };

    /**
     * @description Добавление ссылки на трек
     * @param url - Ссылка или путь
     */
    public set link(url: string) { this._track.link = url; };

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
                        //Logger.log("ERROR", err);
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
    public constructor(track: Song.track) {
        //Высчитываем время
        if (track.duration.seconds.match(/:/)) {
            this._duration = { full: track.duration.seconds, seconds: track.duration.seconds.duration() };
        } else {
            const seconds = parseInt(track.duration.seconds) || 321;

            //Время трека
            if (isNaN(seconds) || !seconds) this._duration = { full: "Live", seconds: 0 };
            else this._duration = { full: seconds.duration(), seconds };
        }

        const api = new API.response(track.url);

        //Изображения трека
        track["image"] = track?.image ?? { url: db.emojis.noImage };

        //Удаляем ненужные данные
        delete track.duration;

        //Добавляем данные
        Object.assign(this._track, track);
        this._api = {platform: api.platform, color: api.color };
    };
}