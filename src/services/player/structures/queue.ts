import {AudioPlayer, RepeatType} from "@service/player";
import {Logger, Interact, MessageUtils} from "@utils";
import {MessageComponents} from "@type/discord";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамические кнопки плеера
 * @readonly
 * @public
 */
const button = {
    resume: MessageUtils.checkIDComponent("button.resume"),
    pause: MessageUtils.checkIDComponent("button.pause"),
    loop: MessageUtils.checkIDComponent("button.loop"),
    loop_one: MessageUtils.checkIDComponent("button.loop_one")
};

/**
 * @author SNIPPIK
 * @description Кнопки для сообщения
 */
const components: MessageComponents[] = [
    /**
     * @description Первый сет кнопок
     * @private
     */
    {
        type: 1,
        components: [
            // Кнопка перетасовки
            MessageUtils.createButton_env("shuffle", 2, true),

            // Кнопка назад
            MessageUtils.createButton_env("back", 2, true),

            // Кнопка паузы/продолжить
            MessageUtils.createButton(button.pause, "resume_pause", 2, false),

            // Кнопка пропуска/вперед
            MessageUtils.createButton_env("skip", 2, false),

            // Кнопка повтора
            MessageUtils.createButton(button.loop, "repeat", 2, false)
        ]
    },

    /**
     * @description Второй сет кнопок
     * @private
     */
    {
        type: 1,
        components: [
            // Кнопка очереди
            MessageUtils.createButton_env("queue", 2, true),

            // Кнопка текста песни
            MessageUtils.createButton_env("lyrics", 2, false),

            // Кнопка стоп
            MessageUtils.createButton_env("stop", 4, false),

            // Кнопка текущих фильтров
            MessageUtils.createButton_env("filters", 2, true),

            // Кнопка повтора текущего трека
            MessageUtils.createButton_env("replay", 2, false)
        ]
    }
];

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @class Queue
 * @public
 */
export class Queue {
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
        player:     null as AudioPlayer
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
     * @description Проверка и выдача кнопок
     * @public
     */
    public get components() {
        const first = components[0].components;
        const two = components[1].components;

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
        if (this.tracks.repeat === RepeatType.Song) Object.assign(first[4], { emoji: button.loop_one, style: 3 });
        else if (this.tracks.repeat === RepeatType.Songs) Object.assign(first[4],{ emoji: button.loop, style: 3 });
        else Object.assign(first[4],{ emoji: button.loop, style: 2 });

        // Делаем проверку на кнопку ПАУЗА/ПРОДОЛЖИТЬ
        if (this.player.status === "player/pause") Object.assign(first[2], {emoji: button.resume});
        else Object.assign(first[2], {emoji: button.pause});

        // Кнопка перетасовки очереди
        if (this.tracks.shuffle) Object.assign(first[0], {style: 3});
        else Object.assign(first[0], {style: 2});

        // Кнопка фильтров
        if (this.player.filters.enabled.length === 0) Object.assign(two[3], { disabled: true });
        else Object.assign(two[3], { disabled: false });

        return components;
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
        this._data.player = new AudioPlayer(ID);

        // Добавляем данные в класс
        this.message = message;
        this.voice = message.voice;

        // Добавляем очередь в список очередей
        db.queues.set(ID, this);

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