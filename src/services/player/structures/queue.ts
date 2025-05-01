import {StringSelectMenuBuilder, ActionRowBuilder, Colors} from "discord.js";
import {CommandInteraction, CycleInteraction} from "@structures";
import {AudioPlayer, RepeatType} from "@service/player";
import filters from "@service/player/filters.json";
import {Logger, Collection, Cycle} from "@utils";
import {QueueMessage} from "./message";
import {locale} from "@service/locale";
import {db, env} from "@app";
import {Track} from "./track";

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
        message:    null as QueueMessage,

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
    public set message(message: QueueMessage) {
        // Если введено новое сообщение
        if (message !== this.message && this.message !== undefined) {
            // Удаляем старое сообщение, если оно есть
            const message = db.queues.cycles.messages.array.find((msg) => {
                return msg.guildId === this.message.guild.id;
            });

            if (message) db.queues.cycles.messages.remove(message);
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
    public set voice(voice) {
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
        return QueueComponent.component(this.player);
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @public
     */
    public constructor(message: CommandInteraction) {
        const queue_message = new QueueMessage(message);
        const ID = message.guild.id;

        // Создаем плеер
        this._data.player = new AudioPlayer(ID);

        // Добавляем данные в класс
        this.message = queue_message;
        this.voice = message.member.voice;

        // Добавляем очередь в список очередей
        db.queues.set(ID, this);

        // В конце функции выполнить запуск проигрывания (полезно если треков в плеере еще нет)
        setImmediate(this.player.play);

        Logger.log("LOG", `[Queue/${ID}] has create`);
    };

    /**
     * @description Эта функция частично удаляет очередь
     * @readonly
     * @public
     */
    public cleanup = () => {
        Logger.log("LOG", `[Queue/${this.guild.id}] has cleanup`);

        // Останавливаем плеер
        if (this.player) this.player.cleanup();

        // Удаляем старое сообщение, если оно есть
        const message = db.queues.cycles.messages.array.find((msg) => {
            return msg.guild.id === this.guild.id;
        });

        if (message) db.queues.cycles.messages.remove(message);
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @protected
     * @readonly
     */
    protected destroy = () => {
        Logger.log("LOG", `[Queue/${this.guild.id}] has destroyed`);

        // Удаляем плеер
        if (this.player) this.player.destroy();
    };
}


/**
 * @author SNIPPIK
 * @description Класс для создания компонентов-кнопок
 * @class QueueComponent
 */
class QueueComponent {
    /**
     * @author SNIPPIK
     * @description Динамические кнопки плеера
     * @private
     */
    public static button = {
        resume: this.checkIDComponent("button.resume"),
        pause: this.checkIDComponent("button.pause"),
        loop: this.checkIDComponent("button.loop"),
        loop_one: this.checkIDComponent("button.loop_one")
    };

    /**
     * @author SNIPPIK
     * @description Кнопки для сообщения
     * @private
     */
    public static components: any[] = [
        new ActionRowBuilder().addComponents([
            new StringSelectMenuBuilder().setCustomId("filter_select")
                .setPlaceholder("Select audio filter")
                .setOptions(filters.filter((filter) => !filter.args).map((filter) => {
                    return {
                        label: filter.name,
                        value: filter.name,
                        description: filter.locale["en-US"],
                    }
                }))
        ]),
        {
            type: 1,
            components: [
                // Кнопка перетасовки
                this.createButton({env: "shuffle", disabled: true}),

                // Кнопка назад
                this.createButton({env: "back", disabled: true}),

                // Кнопка паузы/продолжить
                this.createButton({emoji: this.button.pause, id: "resume_pause"}),

                // Кнопка пропуска/вперед
                this.createButton({env: "skip"}),

                // Кнопка повтора
                this.createButton({emoji: this.button.loop, id: "repeat"})
            ]
        },
        {
            type: 1,
            components: [
                // Кнопка очереди
                this.createButton({env: "queue", disabled: true}),

                // Кнопка текста песни
                this.createButton({env: "lyrics"}),

                // Кнопка стоп
                this.createButton({env: "stop", style: 4}),

                // Кнопка текущих фильтров
                this.createButton({env: "filters", disabled: true}),

                // Кнопка повтора текущего трека
                this.createButton({env: "replay"})
            ]
        }
    ];

    /**
     * @author SNIPPIK
     * @description Делаем проверку id
     * @param name - Название параметра в env
     * @private
     */
    private static checkIDComponent(name: string) {
        const id = env.get(name);
        const int = parseInt(id);

        if (isNaN(int)) return { name: `${id}` };
        return { id };
    };

    /**
     * @author SNIPPIK
     * @description Создание одной кнопки в одной функции
     * @param options - Параметры для создания кнопки
     * @private
     */
    public static createButton(options) {
        let button = {
            type: 2,
            style: options.style ?? 2,
            disabled: options.disabled,
            custom_id: null,
        };


        // Если указан env
        if ("env" in options) return {...button,
            emoji: this.checkIDComponent(`button.${options.env}`),
            custom_id: options.env
        }

        return {...button,
            emoji: options.emoji,
            custom_id: options.id
        }
    };

    /**
     * @description Редактирование кнопки
     * @param component
     * @param index
     * @param updates
     * @private
     */
    private static updateButton(component: typeof this.components[number]["components"], index: number, updates: any) {
        Object.assign(component[index], updates);
    };

    /**
     * @author SNIPPIK
     * @description Проверка и выдача кнопок
     * @public
     */
    public static component = (player: AudioPlayer) => {
        const [firstRow, secondRow] = [this.components[1].components, this.components[2].components];

        const isMultipleTracks = player.tracks.total > 1;
        const isShuffled = player.tracks.shuffle;
        const isPaused = player.status === "player/pause";
        const currentRepeatType = player.tracks.repeat;
        const hasFilters = player.filters.enabled.length > 0;

        // Обновление кнопок очереди и навигации
        this.updateButton(firstRow, 0, { disabled: !isMultipleTracks, style: isShuffled ? 3 : 2 });
        this.updateButton(firstRow, 1, { disabled: !isMultipleTracks, style: isMultipleTracks ? 1 : 2 });
        this.updateButton(firstRow, 3, { disabled: !isMultipleTracks, style: isMultipleTracks ? 1 : 2 });

        // Обновление кнопки повтора
        const loopEmoji = currentRepeatType === RepeatType.Song ? this.button.loop_one : (currentRepeatType === RepeatType.Songs ? this.button.loop : this.button.loop);
        this.updateButton(firstRow, 4, { emoji: loopEmoji, style: currentRepeatType === RepeatType.Songs ? 3 : 2 });

        // Обновление кнопки паузы/продолжить
        this.updateButton(firstRow, 2, { emoji: isPaused ? this.button.resume : this.button.pause });

        // Обновление кнопки фильтров
        this.updateButton(secondRow, 3, { disabled: !hasFilters });

        // Кнопка очереди
        this.updateButton(secondRow, 0, { disabled: !isMultipleTracks });

        return this.components;
    };
}


/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class Queues
 * @readonly
 * @public
 */
export class Queues extends Collection<Queue> {
    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @public
     */
    public readonly cycles = new AudioCycles();

    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @public
     */
    public readonly options = {
        optimization: parseInt(env.get("duration.optimization")),
        volume: parseInt(env.get("audio.volume")),
        fade: parseInt(env.get("audio.fade"))
    };

    /**
     * @description Перезапуск плеера или же перезапуск проигрывания
     * @param player - Плеер
     * @public
     */
    public set restartPlayer(player: AudioPlayer) {
        // Если плеер удален из базы
        if (!this.cycles.players.match(player)) {
            // Добавляем плеер в базу цикла для отправки пакетов
            this.cycles.players.set(player);
        }

        // Если у плеера стоит пауза
        if (player.status === "player/pause") player.resume();

        // Запускаем функцию воспроизведения треков
        player.play();
    };

    /**
     * @description отправляем сообщение о перезапуске бота
     * @public
     */
    public get waitReboot() {
        let timeout = 0;

        // На все сервера отправляем сообщение о перезапуске
        for (const queue of this.array) {
            // Если плеер запущен
            if (this.cycles.players.match(queue.player)) {
                const time = queue.tracks.track.time.total * 1e3

                // Если время ожидания меньше чем в очереди
                if (timeout < time) timeout = time;
            }

            // Сообщение о перезапуске
            queue.message.send({
                withResponse: false,
                embeds: [
                    {
                        description: locale._(queue.message.locale, `bot.reboot.message`),
                        color: Colors.Yellow
                    }
                ]
            });

            // Тихо удаляем очередь
            this.remove(queue.guild.id, true);
        }

        return timeout;
    };

    /**
     * @description Ультимативная функция, позволяет как добавлять треки так и создавать очередь или переподключить очередь к системе
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     * @private
     */
    public create = (message: CommandInteraction, item: Track.list | Track) => {
        let queue = this.get(message.guild.id);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message);
        else {
            // Значит что плеера нет в циклах
            if (!this.cycles.players.match(queue.player)) {
                setImmediate(() => {
                    // Если добавлен трек
                    if (item instanceof Track) queue.player.tracks.position = queue.player.tracks.total - 1;

                    // Если очередь перезапущена
                    else if (!item) queue.player.tracks.position = 0;

                    // Если добавлен плейлист
                    else queue.player.tracks.position = queue.player.tracks.total - item.items.length;

                    // Перезапускаем плеер
                    this.restartPlayer = queue.player;
                });
            }
        }

        // Отправляем сообщение о том что было добавлено
        if ("items" in item || queue.tracks.total > 0) {
            db.events.emitter.emit("message/push", message, item);
        }

        // Добавляем треки в очередь
        for (const track of (item["items"] ?? [item]) as Track[]) {
            track.user = message.member.user;
            queue.tracks.push(track);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @public
 */
class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
     * @readonly
     * @public
     */
    public readonly players = new class AudioPlayers extends Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayers",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player) => {
                    // Отправляем пакет в голосовой канал
                    player.voice.connection.packet = player.audio.current.packet;
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @readonly
     * @public
     */
    public readonly messages = new class Messages extends Cycle<CycleInteraction> {
        public constructor() {
            super({
                name: "Messages",
                duration: 20e3,
                custom: {
                    remove: (item) => { item.delete(); },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);
                        // Удаляем прошлое сообщение
                        if (old) this.remove(old);
                    }
                },
                filter: (message) => message["editable"],
                execute: (message) => {
                    const queue = db.queues.get(message.guild.id);

                    // Если нет очереди
                    if (!queue) this.remove(message);

                    // Если есть поток в плеере
                    else if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                        // Обновляем сообщение о текущем треке
                        db.events.emitter.emit("message/playing", queue, message);
                        return;
                    }
                }
            });
        };
    };
}