import {Interact, InteractComponent} from "@lib/discord/tools/Interact";
import {ExtraPlayer} from "@lib/player";
import {Logger} from "@lib/logger";
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
        if (!this.player) return null;
        return this.player.tracks;
    };


    /**
     * @description Получение кнопок
     * @public
     */
    public get components() {
        const first = this._components[0].components;
        const two = this._components[1].components;

        if (this.tracks.total > 1) {
            // Кнопка очереди
            Object.assign(two[0], { disabled: false });

            // Кнопка перетасовки очереди
            Object.assign(first[0], { disabled: false });

            // Кнопка назад
            Object.assign(first[1], { disabled: false, style: 3 });

            // Кнопка вперед
            Object.assign(first[3], { disabled: false, style: 3 });
        }
        else {
            // Кнопка очереди
            Object.assign(two[0], { disabled: true });

            // Кнопка перетасовки очереди
            Object.assign(first[0], { disabled: true });

            // Кнопка назад
            Object.assign(first[1], { disabled: true, style: 2 });

            // Кнопка вперед
            Object.assign(first[3], { disabled: true, style: 2 });
        }

        // Кнопка повтора
        if (this.tracks.repeat === "song") Object.assign(first[4], { emoji: {id: db.emojis.button.loop_one}, style: 3 });
        else if (this.tracks.repeat === "songs") Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 3 });
        else Object.assign(first[4],{ emoji: {id: db.emojis.button.loop}, style: 2 });

        // Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(first[2], {emoji: {id: db.emojis.button.resume}});
        else Object.assign(first[2], {emoji: {id: db.emojis.button.pause}});

        // Кнопка перетасовки очереди
        if (this.tracks.shuffle) Object.assign(first[0], {style: 3});
        else Object.assign(first[0], {style: 2});

        // Кнопка фильтров
        if (this.player.filters.enabled.length === 0) Object.assign(two[3], { disabled: true });
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
        setImmediate(this.player.play);
    };

    /**
     * @description Эта функция частично удаляет очередь
     * @readonly
     * @public
     */
    public readonly cleanup = () => {
        Logger.log("DEBUG", `[Queue: ${this.guild.id}] has cleanup`);

        // Останавливаем плеер
        if (this.player) this.player.cleanup();

        // Ищем сообщение в базе
        const db_message = db.audio.cycles.messages.array.find((msg) => msg.guild.id === this.guild.id);

        // Удаляем сообщение через время
        if (db_message) db_message.delete = 200;
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные
     * @protected
     * @readonly
     */
    protected readonly destroy = () => {
        Logger.log("DEBUG", `[Queue: ${this.guild.id}] has destroyed`);

        // Удаляем плеер
        if (this.player) this.player["destroy"]();

        // Удаляем все параметры
        for (let key of Object.keys(this._data)) this._data[key] = null;
    };
}