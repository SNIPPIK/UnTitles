import { ActionRow, Button, Embed } from "seyfert";
import { StringSelectMenu, StringSelectOption } from "seyfert";
import { CommandInteraction } from "#structures/discord";
import { MessageFlags } from "seyfert/lib/types";
import filters from "#core/player/filters.json";
import type { AudioPlayer } from "#core/player";
import { RepeatType } from "#core/queue";
import { locale } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Прослойка для правильной работы очереди
 * @class QueueMessage
 * @public
 */
export class QueueMessage<T extends CommandInteraction> {
    /**
     * @description ID сервера, привязанный к сообщению
     * @public
     */
    public guild_id: string;

    /**
     * @description ID канала, привязанный к сообщению
     * @public
     */
    public channel_id: string;

    /**
     * @description ID канала, привязанный к голосовому каналу
     * @public
     */
    public voice_id: string;

    /**
     * @description Ответил ли бот на сообщение
     * @private
     */
    private _deferred: boolean;

    /**
     * @description Язык сообщения
     * @returns Locale
     * @public
     */
    public get locale() {
        return this._original?.interaction.locale;
    };

    /**
     * @description Получение класса о сервере
     * @returns Guild
     * @public
     */
    public get guild() {
        return this._original.guild;
    };

    /**
     * @description Получение текущего текстового канала
     * @returns TextChannel
     * @public
     */
    public get channel() {
        return this._original.channel;
    };

    /**
     * @description Получение текущего голосового соединения пользователя
     * @returns VoiceState
     * @public
     */
    public get voice() {
        return this._original.member.voice;
    };

    /**
     * @description Получение класса клиента
     * @returns require("discord.js").Client
     * @public
     */
    public get client() {
        return this._original.client;
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Ответил ли бот пользователю?
     * @returns boolean
     * @public
     */
    public get replied() {
        return this._original["replied"];
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Можно ли ответить на другое сообщение?
     * @returns boolean
     * @public
     */
    public get deferred() {
        return this._deferred;
    };
    /**
     * @description Создаем класс для общения с discord api
     * @param _original - Класс сообщения
     * @constructor
     * @public
     */
    public constructor(private _original: T) {
        this.voice_id = _original.member.voice("cache").channelId;
        this.channel_id = _original.channelId;
        this.guild_id = _original.guildId;
    };

    /**
     * @description Удаление динамического сообщения из системы
     * @returns void
     * @public
     */
    public delete = () => {
        // Удаляем старое сообщение, если оно есть
        const message = db.queues.cycles.messages.find((msg) => {
            return msg.guildId === this.guild_id;
        });

        if (message) db.queues.cycles.messages.delete(message);
    };

    /**
     * @description Авто отправка сообщения
     * @param options - Параметры сообщения
     * @returns Promise<CycleInteraction>
     * @public
     */
    public send = (options: {embeds: Embed[], components?: ActionRow<Button>[], flags?: MessageFlags}) => {
        try {
            // Если бот уже ответил на сообщение
            if (this.replied && !this.deferred) {
                this._deferred = true;
                return this._original.followup(options);
            }

            // Если можно дать ответ на сообщение
            else if (!this.deferred && !this.replied) {
                this._deferred = true;
                return this._original.editOrReply(options, true);
            }

            // Отправляем обычное сообщение
            return this.send_single(options);
        } catch {
            this._deferred = false;

            try {
                // Отправляем обычное сообщение
                return this.send_single(options);
            } catch {
                return null;
            }
        }
    };

    /**
     * @description Авто отправка сообщения
     * @param options - Параметры сообщения
     * @returns Promise<CycleInteraction>
     * @public
     */
    public send_single = (options: {embeds: Embed[], components?: ActionRow<Button>[], flags?: MessageFlags}) => {
        try {
            // Отправляем обычное сообщение
            return this._original.client.messages.write(this.channel_id, options);
        } catch {
            this._deferred = false;

            try {
                // Отправляем обычное сообщение
                return this._original.client.messages.write(this.channel_id, options);
            } catch {
                return null;
            }
        }
    };
}


/**
 * @author SNIPPIK
 * @description Класс для создания компонентов-кнопок
 * @class QueueButtons
 * @private
 */
export class QueueButtons {
    /**
     * @author SNIPPIK
     * @description Динамические кнопки плеера
     * @private
     */
    private static button = {
        resume: this.checkIDComponent("button.resume"),
        pause: this.checkIDComponent("button.pause"),
        loop: this.checkIDComponent("button.loop"),
        loop_one: this.checkIDComponent("button.loop_one"),
        autoplay: this.checkIDComponent("button.autoplay"),

        lyrics: QueueButtons.createButton({env: "lyrics"}),
        stop: QueueButtons.createButton({env: "stop", style: 4}),
    };

    /**
     * @description Изменяемые кнопки, для отображения в сообщение о текущем треке
     * @private
     */
    private _buttons = [
        {
            type: 1,
            components: [
                // Кнопка перетасовки
                QueueButtons.createButton({env: "shuffle", disabled: true}),

                // Кнопка назад
                QueueButtons.createButton({env: "back", disabled: false}),

                // Кнопка паузы/продолжить
                QueueButtons.createButton({emoji: QueueButtons.button.pause, id: "resume_pause"}),

                // Кнопка пропуска/вперед
                QueueButtons.createButton({env: "skip"}),

                // Кнопка повтора
                QueueButtons.createButton({emoji: QueueButtons.button.loop, id: "repeat"})
            ]
        },
        {
            type: 1,
            components: [
                // Кнопка очереди
                QueueButtons.createButton({env: "queue", disabled: true}),

                // Кнопка текста песни
                QueueButtons.button.lyrics,

                // Кнопка стоп
                QueueButtons.button.stop,

                // Кнопка текущих фильтров
                QueueButtons.createButton({env: "filters", disabled: true}),
            ]
        }
    ];

    /**
     * @description Строковый селектор, для выбора фильтра
     * @private
     */
    private _selector: ActionRow;

    /**
     * @description Создаем класс для обновления кнопок
     * @param ctx
     */
    public constructor(ctx: QueueMessage<CommandInteraction>) {
        // Разово создаем селектор для повторного использования
        this._selector = new ActionRow().addComponents([
            new StringSelectMenu().setCustomId("filter_select")
                .setPlaceholder(locale._(ctx.locale, "selector.filters"))
                .setOptions(filters.filter((filter) => !filter.args).map((filter) => {
                    return new StringSelectOption()
                        .setLabel(filter.name.charAt(0).toUpperCase() + filter.name.slice(1).replace("_", " "))
                        .setValue(filter.name)
                        .setDescription((filter.locale[ctx.locale] ?? filter.locale["en-US"]).split("]")[1])
                }))
        ])
    };

    /**
     * @author SNIPPIK
     * @description Проверка и выдача кнопок
     * @public
     */
    public component = (player: AudioPlayer) => {
        const [firstRow, secondRow] = [this._buttons[0].components, this._buttons[1].components];

        const isMultipleTracks = player.tracks.total > 1;
        const isShuffled = player.tracks.shuffle;
        const isPaused = player.status === "player/pause";
        const currentRepeatType = player.tracks.repeat;
        const hasFilters = player.filters.size > 0;

        // Хелпер для обновления кнопки
        const setButton = (btn: any, { disabled, style, emoji }: { disabled?: boolean; style?: number; emoji?: any }) => {
            if (disabled !== undefined) btn.disabled = disabled;
            if (style !== undefined) btn.style = style;
            if (emoji !== undefined) btn.emoji = emoji;
        };

        // 🔀 Shuffle
        setButton(firstRow[0], {
            disabled: !isMultipleTracks,
            style: isShuffled ? 3 : 2,
        });

        // ⏮ Prev
        setButton(firstRow[1], {
            style: isMultipleTracks ? 1 : 2,
        });

        // ⏭ Next
        setButton(firstRow[3], {
            disabled: !isMultipleTracks,
            style: isMultipleTracks ? 1 : 2,
        });

        // 🔁 Repeat
        setButton(firstRow[4], {
            emoji: currentRepeatType === RepeatType.Song ? QueueButtons.button.loop_one :
                currentRepeatType === RepeatType.AutoPlay ? QueueButtons.button.autoplay : QueueButtons.button.loop,
            //emoji: currentRepeatType === RepeatType.Song ? QueueButtons.button.loop_one : QueueButtons.button.loop,
            style: currentRepeatType === RepeatType.None ? 2 : 3,
        });

        // ⏸ / ▶ - Pause / Resume
        setButton(firstRow[2], {
            emoji: isPaused ? QueueButtons.button.resume : QueueButtons.button.pause,
            style: isPaused ? 3 : 1,
        });

        // 🎚 Filters
        setButton(secondRow[3], { disabled: !hasFilters });

        // 📑 Queue
        setButton(secondRow[0], { disabled: !isMultipleTracks });

        return [this._selector, this._buttons[0], this._buttons[1]];
    };

    /**
     * @description Удаляем компоненты когда они уже не нужны
     * @returns void
     * @public
     */
    public destroy = () => {
        this._buttons = null;
        this._selector = null;
    };

    /**
     * @author SNIPPIK
     * @description Делаем проверку id
     * @param name - Название параметра в env
     * @returns object
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
     * @returns object
     * @private
     */
    private static createButton(options: any) {
        let button = {
            type: 2,
            style: options.style ?? 2,
            disabled: options.disabled,
            custom_id: null,
        };

        return "env" in options ?
            // Если указан env
            {...button,
                emoji: this.checkIDComponent(`button.${options.env}`),
                custom_id: options.env
            } :
            {...button,
                emoji: options.emoji,
                custom_id: options.id
            }
    };
}