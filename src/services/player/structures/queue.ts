import { StringSelectMenuBuilder, ActionRowBuilder } from "discord.js";
import { ControllerTracks } from "#service/player/controllers/tracks";
import { ControllerVoice } from "#service/player/controllers/voice";
import { AudioPlayer, RepeatType } from "#service/player";
import { CommandInteraction, Logger } from "#structures";
import filters from "#service/player/filters.json";
import { VoiceConnection } from "#service/voice";
import { QueueMessage } from "./message";
import { Track } from "./track";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Базовый класс очереди, содержит в себе все необходимые данные для создания очереди
 * @class BaseQueue
 * @abstract
 */
abstract class BaseQueue {
    /**
     * @description Время включения очереди или же проигрывания музыки
     * @protected
     * @readonly
     */
    protected readonly _timestamp = new Date();

    /**
     * @description Сообщение пользователя
     * @protected
     */
    protected _message: QueueMessage<CommandInteraction>;

    /**
     * @description Плеер для проигрывания музыки
     * @protected
     */
    protected _player: AudioPlayer;

    /**
     * @description Хранилище треков, с умной системой управления
     * @protected
     */
    protected _tracks: ControllerTracks<Track> = new ControllerTracks();

    /**
     * @description Голосовое подключение
     * @protected
     */
    protected _voice: ControllerVoice<VoiceConnection> = new ControllerVoice();

    /*=== TEXT CHANNEL ===*/

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message) {
        this._cleanupOldMessage();
        this._message = message;
    };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() {
        // Если сообщение с сервера уже не доступно
        if (!this._message) return null;
        return this._message;
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

    /*=== TEXT CHANNEL ===*/
    /*=== AudioPlayer ===*/

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() {
        // Если плеер уже не доступен
        if (!this._player) return null;
        return this._player;
    };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public set player(player) {
        this._player = player;
    };

    /*=== AudioPlayer ===*/
    /*=== Voice Connection ===*/

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice() {
        return this._voice;
    };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice - Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice) {
        this._voice = voice;
    };

    /*=== Voice Connection ===*/
    /*=== Tracks ===*/

    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get tracks() {
        return this._tracks;
    };

    /*=== Tracks ===*/

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @public
     */
    protected constructor(message: CommandInteraction) {
        const queue_message = new QueueMessage(message);
        const ID = queue_message.guildID;

        // Создаем плеер
        this.player = new AudioPlayer(ID, this._tracks, this._voice);

        // Добавляем данные в класс
        this.message = queue_message;

        // Подключаемся к голосовому каналу
        this.voice.join(queue_message.client, queue_message.voice);

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
        Logger.log("DEBUG", `[Queue/${this.message.guildID}] has cleanup`);

        // Останавливаем плеер
        if (this.player) this.player.cleanup();

        // Для удаления динамического сообщения
        this._cleanupOldMessage();
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @protected
     * @readonly
     */
    protected destroy = () => {
        Logger.log("LOG", `[Queue/${this.message.guildID}] has destroyed`);

        // Удаляем плеер
        if (this.player) this.player.destroy();
        this._tracks.clear();
    };

    /**
     * @description Удаление динамического сообщения из системы
     * @param message - сообщение
     */
    private _cleanupOldMessage = () => {
        // Если введено новое сообщение
        if (this._message && this._message.guild) {
            // Удаляем старое сообщение, если оно есть
            const message = db.queues.cycles.messages.find((msg) => {
                return msg.guildId === this._message.guildID;
            });

            if (message) db.queues.cycles.messages.delete(message);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @extends BaseQueue
 * @class Queue
 * @public
 */
export class Queue extends BaseQueue {
    /**
     * @description Проверка и выдача кнопок
     * @public
     */
    public get components() {
        return QueueButtons.component(this.player);
    };

    /**
     * @description Embed данные о текущем треке
     * @public
     */
    public get componentEmbed() {
        try {
            const {api, artist, image, name, user} = this.tracks.track;
            return {
                color: api.color, thumbnail: image,
                author: {name: artist.title, url: artist.url, iconURL: artist.image.url},
                footer: {
                    text: `${user.username} ${this.tracks.total > 1 ? `| 🎵 ${this.player.tracks.position + 1} - ${this.player.tracks.total} 🎶` : ""}`,
                    iconURL: user.avatar
                },
                fields: [
                    // Текущий трек
                    {
                        name: "",
                        value: `\`\`\`${name}\`\`\`` + this.player.progress
                    },

                    // Следующий трек или треки
                    this.tracks.size > 0 ? (() => {
                        const tracks = (this.tracks.array(+3) as Track[]).map((track, index) => {
                            return `${index + 2} - ${track.name_replace}`;
                        });

                        return {
                            name: "",
                            value: tracks.join("\n")
                        };
                    })() : null
                ]
            };
        } catch (error) {
            Logger.log("ERROR", `[Queue/${this.message.guildID}]: ${error}`);
            return null;
        }
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @public
     */
    public constructor(message: CommandInteraction) {
        super(message);
        const ID = message.guild.id;

        // Добавляем очередь в список очередей
        db.queues.set(ID, this);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для создания компонентов-кнопок
 * @class QueueButtons
 * @private
 */
class QueueButtons {
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