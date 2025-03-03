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
            MessageUtils.createButton({env: "shuffle", disabled: true}),

            // Кнопка назад
            MessageUtils.createButton({env: "back", disabled: true}),

            // Кнопка паузы/продолжить
            MessageUtils.createButton({emoji: button.pause, id: "resume_pause"}),

            // Кнопка пропуска/вперед
            MessageUtils.createButton({env: "skip"}),

            // Кнопка повтора
            MessageUtils.createButton({emoji: button.loop, id: "repeat"})
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
            MessageUtils.createButton({env: "queue", disabled: true}),

            // Кнопка текста песни
            MessageUtils.createButton({env: "lyrics"}),

            // Кнопка стоп
            MessageUtils.createButton({env: "stop", style: 4}),

            // Кнопка текущих фильтров
            MessageUtils.createButton({env: "filters", disabled: true}),

            // Кнопка повтора текущего трека
            MessageUtils.createButton({env: "replay"})
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
        player:     null as AudioPlayer,

        /**
         * @description Время включения очереди или же проигрывания музыки
         * @private
         */
        timestamp: new Date()
    };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() {
        // Если плеер уже не доступен
        if (!this._data.player) return null;
        return this._data.player;
    };

    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get tracks() {
        // Если плеер уже не доступен
        if (!this.player) return null;
        return this.player.tracks;
    };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() {
        // Если сообщение с сервера уже не доступно
        if (!this._data.message) return null;
        return this._data.message;
    };

    /**
     * @description Выдаем сервер к которому привязана очередь
     * @return Guild
     * @public
     */
    public get guild() {
        if (!this.message) return null;
        return this.message.guild;
    };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message: Interact) {
        // Если введено новое сообщение
        if (message !== this.message) {
            // Удаляем старое сообщение, если оно есть
            if (this.message !== undefined) {
                if (db.queues.cycles.messages.array.includes(this.message)) db.queues.cycles.messages.remove(this.message);
            }
        }

        this._data.message = message;
    };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice() {
        // Если сообщение с сервера уже не доступно
        if (!this.message) return null;
        return this.message.voice;
    };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice - Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice: Interact["voice"]) {
        // Если плеер уже не доступен
        if (!this.player) return;

        // Задаем новое голосовое подключение
        this.player.voice.connection = db.voice.join({
            self_deaf: true,
            self_mute: false,

            guild_id: this.guild.id,
            channel_id: voice.channel.id
        }, this.guild.voiceAdapterCreator);
    };

    /**
     * @description Время включения музыки текущей очереди
     * @public
     */
    public get timestamp() {
        return this._data.timestamp;
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
            Object.assign(first[1], { disabled: false, style: 1 });

            // Кнопка вперед
            Object.assign(first[3], { disabled: false, style: 1 });
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
        if (this.player.status === "player/pause") Object.assign(first[2], { emoji: button.resume });
        else Object.assign(first[2], { emoji: button.pause });

        // Кнопка перетасовки очереди
        if (this.tracks.shuffle) Object.assign(first[0], { style: 3 });
        else Object.assign(first[0], { style: 2 });

        // Кнопка фильтров
        if (this.player.filters.enabled.length === 0) Object.assign(two[3], { disabled: true });
        else Object.assign(two[3], { disabled: false });

        return components;
    };

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

        // В конце функции выполнить запуск проигрывания (полезно если треков в плеере еще нет)
        setImmediate(this.player.play);

        Logger.log("DEBUG", `[Queue/${ID}] has create`);
    };

    /**
     * @description Эта функция частично удаляет очередь
     * @readonly
     * @public
     */
    public readonly cleanup = () => {
        Logger.log("DEBUG", `[Queue/${this.guild.id}] has cleanup`);

        // Останавливаем плеер
        if (this.player) this.player.cleanup();
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные
     * @protected
     * @readonly
     */
    protected readonly destroy = () => {
        Logger.log("DEBUG", `[Queue/${this.guild.id}] has destroyed`);

        // Удаляем сообщение
        this.message = null;

        // Удаляем плеер
        if (this.player) this.player.destroy();

        // Удаляем все параметры
        for (let key of Object.keys(this._data)) this._data[key] = null;
    };
}