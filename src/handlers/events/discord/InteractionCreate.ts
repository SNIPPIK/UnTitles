import {
    AnySelectMenuInteraction,
    AutocompleteInteraction,
    ButtonInteraction,
    CacheType, ChannelType,
    ChatInputCommandInteraction,
    Colors,
    Events
} from "discord.js"
import { QueueMessage } from "#service/player/structures/message";
import { CommandInteraction, Assign, Logger } from "#structures";
import { Command } from "#handler/commands";
import { locale } from "#service/locale";
import { Event } from "#handler/events";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @event Events.InteractionCreate
 * @public
 */
class Interaction extends Assign<Event<Events.InteractionCreate>> {
    /**
     * @author SNIPPIK
     * @description Функции правил проверки, возвращает true или false
     * @true - Разрешено
     * @false - Запрещено
     */
    private intends: { name: Command["rules"][number], callback: (message: CommandInteraction) => Promise<boolean> }[] = [
        {
            name: "voice",
            callback: async (message) => {
                const VoiceChannel = message.member.voice.channel;

                // Если нет голосового подключения
                if (!VoiceChannel) {
                    await message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "voice.need", [message.member]),
                                color: Colors.Yellow
                            }
                        ],
                    })
                    return false;
                }

                return true;
            }
        },
        {
            name: "queue",
            callback: async (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если нет очереди
                if (!queue) {
                    await message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "queue.need", [message.member]),
                                color: Colors.Yellow
                            }
                        ],
                    });
                    return false;
                }

                return true;
            }
        },
        {
            name: "player-not-playing",
            callback: async (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если музыку нельзя пропустить из-за плеера
                if (!queue && !queue.player.playing) {
                    await message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.playing.off"),
                                color: Colors.DarkRed
                            }
                        ],
                    });
                    return false;
                }

                return true;
            }
        },
        {
            name: "player-wait-stream",
            callback: async (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если музыку нельзя пропустить из-за плеера
                if (queue && queue.player.waitStream) {
                    await message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.stream.wait"),
                                color: Colors.DarkRed
                            }
                        ],
                    });
                    return false;
                }

                return true;
            }
        },
        {
            name: "another_voice",
            callback: async (message) => {
                const VoiceChannelMe = message.guild?.members?.me?.voice?.channel;
                const VoiceChannel = message.member?.voice?.channel;

                // Если бот в голосовом канале и пользователь
                if (VoiceChannelMe && VoiceChannel) {
                    // Если пользователь и бот в разных голосовых каналах
                    if (VoiceChannelMe.id !== VoiceChannel.id) {
                        const queue = db.queues.get(message.guild.id);

                        // Если нет музыкальной очереди
                        if (!queue) {
                            const connection = db.voice.get(message.guild.id);

                            // Отключаемся от голосового канала
                            if (connection) connection.disconnect();
                        }

                        // Если есть музыкальная очередь
                        else {
                            const users = VoiceChannelMe.members.filter((user) => !user.user.bot);

                            // Если нет пользователей в голосовом канале очереди
                            if (users.size === 0) {
                                queue.message = new QueueMessage(message);
                                queue.voice = message.member.voice;

                                // Сообщаем о подключении к другому каналу
                                message.channel.send({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "voice.new", [VoiceChannel]),
                                            color: Colors.Yellow
                                        }
                                    ]
                                }).then((msg) => setTimeout(() => msg.delete().catch(() => null), 5e3));
                                return true;
                            }

                            else {
                                await message.reply({
                                    flags: "Ephemeral",
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "voice.alt", [VoiceChannelMe]),
                                            color: Colors.Yellow
                                        }
                                    ]
                                });
                                return false;
                            }
                        }
                    }
                }

                return true;
            }
        }
    ];

    /**
     * @author SNIPPIK
     * @description База данных для системы ожидания
     * @private
     */
    private cooldown: { time: number; db: Map<string, number> } | null;

    /**
     * @description Создание события
     * @public
     */
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            once: false,
            execute: async (ctx) => {
                // Если включен режим белого списка
                if (db.whitelist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.whitelist.ids.length > 0 && !db.whitelist.ids.includes(ctx.user.id)) {
                        if (!("reply" in ctx)) return;

                        return ctx.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    description: locale._(ctx.locale, "whitelist.message", [ctx.member]),
                                    color: Colors.Yellow
                                }
                            ]
                        });
                    }
                }

                // Если включен режим черного списка
                else if (db.blacklist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.blacklist.ids.length > 0 && !db.blacklist.ids.includes(ctx.user.id)) {
                        if (!("reply" in ctx)) return;

                        return ctx.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    description: locale._(ctx.locale, "blacklist.message", [ctx.member]),
                                    color: Colors.Yellow
                                }
                            ]
                        });
                    }
                }

                // Если используется функция ответа от бота
                if (ctx.isAutocomplete()) {
                    Logger.log("DEBUG", `User ${ctx.user.username} run autocomplete ${ctx?.commandName}`);
                    return this.SelectAutocomplete(ctx);
                }

                // Если пользователь использует команду
                else if (ctx.isChatInputCommand()) {
                    Logger.log("DEBUG", `User ${ctx.user.username} run command ${ctx?.commandName}`);

                    // Если пользователь не является разработчиком, то на него будут накладываться штрафы в виде cooldown
                    if (!db.owner.ids.includes(ctx.user.id)) {
                        const user = this.cooldown.db.get(ctx.user.id);

                        // Если нет пользователя в системе ожидания
                        if (!user) {
                            // Добавляем пользователя в систему ожидания
                            this.cooldown.db.set(ctx.user.id, Date.now() + (this.cooldown.time * 1e3));
                        }

                        // Если пользователь уже в списке
                        else {
                            // Если время еще не прошло говорим пользователю об этом
                            if (user >= Date.now()) {
                                if (ctx.isAutocomplete() || !("reply" in ctx)) return;

                                return ctx.reply({
                                    flags: "Ephemeral",
                                    embeds: [
                                        {
                                            description: locale._(ctx.locale, "cooldown.message", [ctx.member, (user / 1000).toFixed(0), 5]),
                                            color: Colors.Yellow
                                        }
                                    ]
                                });
                            }

                            // Удаляем пользователя из базы
                            this.cooldown.db.delete(ctx.user.id);
                        }
                    }

                    return this.SelectCommand(ctx);
                }

                // Действия выбора
                else if (ctx.isAnySelectMenu && !ctx.isButton()) {
                    Logger.log("DEBUG", `User ${ctx.user.username} run selector menu ${ctx?.["customId"]}`);
                    return this.SelectMenuCallback(ctx as any);
                }

                // Управление кнопками
                else if (ctx.isButton()) {
                    Logger.log("DEBUG", `User ${ctx.user.username} run button ${ctx?.customId}`);
                    return this.SelectButton(ctx);
                }

                return null;
            }
        });

        this.cooldown = env.get("cooldown", true) ? { time: parseInt(env.get("cooldown.time", "2")), db: new Map() }: null;
    };

    /**
     * @description Функция выполняющая действия SelectCommand
     * @param ctx
     * @constructor
     */
    private readonly SelectCommand = async (ctx: ChatInputCommandInteraction<CacheType>) => {
        const command = db.commands.get(ctx.commandName);
        const permissions = command.permissions;

        // Если нет команды
        // Если пользователь пытается использовать команду разработчика
        if (!command || (command?.owner && !db.owner.ids.includes(ctx.member.user.id))) {
            db.commands.remove(ctx.client, ctx.commandGuildId, ctx.commandId);

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "command.fail"),
                        color: Colors.DarkRed
                    }
                ]
            });
        }

        // Если права не соответствуют правде
        else if (command.rules && command.rules?.length > 0) {
            const rules = this.intends.filter((rule) => command.rules.includes(rule.name));

            for (const rule of rules) {
                if (!(await rule.callback(ctx))) return null;
            }
        }

        if (permissions && isBased(ctx) === "guild") {
            // Проверка прав пользователя
            const userPermissions = ctx.member?.permissions;
            if (permissions.user && !permissions.user.every(perm => userPermissions?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "permission.user", [ctx.member]));
            }

            // Проверка прав бота
            const botPermissions = ctx.guild?.members.me?.permissionsIn(ctx.channel);
            if (permissions.client && !permissions.client.every(perm => botPermissions?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "permission.client", [ctx.member]));
            }
        }

        // Выполняем команду
        return command.execute({
            message: ctx,
            args: ctx.options?.["_hoistedOptions"]?.map((f) => {
                const value = f[f.name];

                if (value) return value;
                return f.value;
            }),
            type: ctx.options?.["_subcommand"]
        });
    };

    /**
     * @description Функция выполняющая действия SelectAutocomplete
     * @param ctx
     * @constructor
     */
    private readonly SelectAutocomplete = (ctx: AutocompleteInteraction<CacheType>) => {
        const command = db.commands.get(ctx.commandName);

        // Если есть команда
        if (command && command.autocomplete) {
            return command.autocomplete({
                message: ctx,
                args: ctx.options?.["_hoistedOptions"]?.map((f) => {
                    const value = f[f.name];

                    if (value) return value;
                    return f.value;
                }),
                type: ctx.options?.["_subcommand"]
            })
        }
    };

    /**
     * @description Функция выполняющая действия SelectButton
     * @param ctx
     * @constructor
     */
    private readonly SelectButton = (ctx: ButtonInteraction<CacheType>) => {
        const button = db.components.get(ctx.customId);
        const queue = db.queues.get(ctx.guildId);
        const userChannel = ctx.member.voice.channel;
        const botChannel = ctx.guild.members.me.voice.channel;

        // Если была не найдена кнопка
        // Если пользователь не подключен к голосовым каналам и нет очереди
        // Если есть очередь и пользователь не подключен к тому же голосовому каналу
        const isValid = button && userChannel && botChannel && queue && userChannel.id === queue.voice.channel.id;
        if (!isValid) return;

        // Если кнопка была найдена
        return button.callback(ctx);
    };

    /**
     * @description Функция выполняющая действия SelectMenu
     * @param ctx
     * @constructor
     */
    private readonly SelectMenuCallback = async (ctx: AnySelectMenuInteraction<CacheType>) => {
        const id = ctx["customId"] as string;

        if (id === "filter_select") {
            const queue = db.queues.get(ctx.guildId);

            // Если нет очереди
            if (!queue) return;

            const filter = ctx["values"][0] as string;
            const findFilter = queue.player.filters.enabled.find((fl) => fl.name === filter);

            const command = db.commands.get("filter");

            if (!command) return;

            // Если права не соответствуют правде
            if (command.rules && command.rules?.length > 0) {
                const rules = this.intends.filter((rule) => command.rules.includes(rule.name));

                for (const rule of rules) {
                    if (!(await rule.callback(ctx as any))) return null;
                }
            }

            return command.execute({
                message: ctx as any,
                args: ctx["values"],
                type: findFilter ? "disable" : "push"
            });
        }
    };
}

/**
 * @author SNIPPIK
 * @description Получаем тип канала, для работы все сервера
 */
function isBased(ctx: CommandInteraction) {
    // Проверяем на наличие типа канала
    if (ctx.channel?.type !== undefined) {
        // Если используется на сервере
        if (ctx.channel?.type === ChannelType.GuildText || ctx.channel?.type === ChannelType.GuildAnnouncement || ctx.channel?.type === ChannelType.GuildStageVoice || ctx.channel?.type === ChannelType.GuildVoice) return "guild";

        // Если используется в личном чате
        else if (ctx.channel?.type === ChannelType.PrivateThread) return "private";
    }

    // Если используется на стороннем сервере
    return "public";
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [Interaction];