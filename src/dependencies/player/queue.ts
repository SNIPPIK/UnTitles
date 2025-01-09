import {Interact, InteractComponent} from "@lib/discord/tools/Interact";
import {ExtraPlayer} from "@lib/player";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @class Queue
 * @public
 */
export class Queue {
    /**
     * @description Кнопки для сообщения
     * @readonly
     * @private
     */
    private readonly _components: InteractComponent[] = [

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
     * @readonly
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
        if (!this._data.player) return null;
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
        if (this.shuffle) Object.assign(first[0], {style: 3});
        else Object.assign(first[0], {style: 2});

        // Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(first[2], {emoji: {id: db.emojis.button.resume}});
        else Object.assign(first[2], {emoji: {id: db.emojis.button.pause}});

        // Кнопка повтора
        if (this.repeat === "song") Object.assign(first[4], { emoji: {id: db.emojis.button.loop_one}, style: 3 });
        else if (this.repeat === "songs") Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 3 });
        else Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 2 });

        // Если это первый трек в списке, то не позволяем пользователям возвращать трек
        if (this.tracks.position > 0) Object.assign(first[1], { disabled: false, style: 3 });
        else Object.assign(first[1], { disabled: true });
        


        // Ограничиваем кнопку очередь
        if (this.tracks.size > 1) {
            Object.assign(two[0], { disabled: false });
        } else {
            Object.assign(two[0], { disabled: true });
        }

        // Если есть еще треки, то можно будет посмотреть очередь
        // Если всего один трек, то не позволяем его пропустить
        if (this.tracks.size > 1) {
            Object.assign(first[0], { disabled: false });
            Object.assign(first[3], { disabled: false, style: 3 });
        } else {
            Object.assign(first[0], { disabled: true });
            Object.assign(first[3], { disabled: true, style: 2 });
        }

        // Если нет включенных фильтров
        if (this.player.filters.enable.length === 0) Object.assign(two[3], { disabled: true });
        else Object.assign(two[3], { disabled: false });

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
            this.player.play();
        });
    };

    /**
     * @description Очищаем очередь
     * @readonly
     * @public
     */
    public readonly cleanup = () => {
        db.audio.cycles.players.remove(this.player);
        if (this.player) this.player.cleanup();

        for (let key of Object.keys(this._data)) this._data[key] = null;
    };
}