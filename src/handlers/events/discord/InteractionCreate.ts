import type { AnySelectMenuInteraction, AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import { ChannelType, Events } from "discord.js"
import { CommandInteraction, Colors } from "#structures/discord";
import { Assign, Logger, locale } from "#structures";
import { SubCommand } from "#handler/commands";
import { Selector } from "#handler/components";
import { Event } from "#handler/events";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @extends Assign
 * @event Events.InteractionCreate
 * @public
 */
class Interaction extends Assign<Event<Events.InteractionCreate>> {
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
                                    description: locale._(ctx.locale, "interaction.whitelist", [ctx.member]),
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
                                    description: locale._(ctx.locale, "interaction.blacklist", [ctx.member]),
                                    color: Colors.Yellow
                                }
                            ]
                        });
                    }
                }

                // Если используется функция ответа от бота
                if (ctx.isAutocomplete()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run autocomplete ${ctx?.commandName}`);
                    return this.SelectAutocomplete(ctx);
                }

                // Если пользователь использует команду
                else if (ctx.isChatInputCommand()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run command ${ctx?.commandName}`);
                    return this.SelectCommand(ctx);
                }

                // Действия выбора
                else if (ctx.isAnySelectMenu) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run selector menu ${ctx?.["customId"]}`);
                    return this.SelectMenuCallback(ctx as any);
                }

                // Управление кнопками
                else if (ctx.isButton()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run button ${ctx?.customId}`);
                    return this.SelectButton(ctx);
                }

                return null;
            }
        });
    };

    /**
     * @description Функция выполняющая действия SelectCommand
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectCommand = async (ctx: ChatInputCommandInteraction) => {
        const command = db.commands.get(ctx.commandName);
        const subcommand: SubCommand = command.options.find((cmd) => cmd.name === ctx.options["_subcommand"]) as any;

        // Если нет команды
        // Если пользователь пытается использовать команду разработчика
        if (!command || (command?.owner && !db.owner.ids.includes(ctx.member.user.id))) {
            db.commands.remove(ctx.client, ctx.commandGuildId, ctx.commandId);

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "interaction.command.fail"),
                        color: Colors.DarkRed
                    }
                ]
            });
        }

        // Если права не соответствуют правде
        if (command.middlewares && command.middlewares?.length > 0) {
            const rules = db.middlewares.filter((rule) => command.middlewares.includes(rule.name));

            for (const rule of rules) {
                if (!(await rule.callback(ctx))) return null;
            }
        }


        const permissions = command.permissions;
        if (permissions && isBased(ctx) === "guild") {
            // Проверка прав пользователя
            const userPermissions = ctx.member?.permissions;
            if (permissions.user && !permissions.user.every(perm => userPermissions?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "interaction.permission.user", [ctx.member]));
            }

            // Проверка прав бота
            const botPermissions = ctx.guild?.members.me?.permissionsIn(ctx.channel);
            if (permissions.client && !permissions.client.every(perm => botPermissions?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "interaction.permission.client", [ctx.member]));
            }
        }

        // Выполняем команду
        return (subcommand ?? command).execute({
            message: ctx,
            args: ctx.options?.["_hoistedOptions"]?.map((f) => {
                return f[f.name] ?? f.value;
            })
        });
    };

    /**
     * @description Функция выполняющая действия SelectAutocomplete
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectAutocomplete = (ctx: AutocompleteInteraction) => {
        const command = db.commands.get(ctx.commandName);
        const subcommand = command.options.find((cmd) => {
            if (ctx.options["_subcommand"]) return cmd.name === ctx.options["_subcommand"];
            return cmd.autocomplete;
        });
        const groupCommand = subcommand?.options?.find((option) => option.autocomplete);

        // Если нет autocomplete под команды
        if (!subcommand && !groupCommand) return null;

        const args: any[] = ctx.options?.["_hoistedOptions"]?.map((f) => {
            return f[f.name] ?? f.value;
        });

        // Если аргумент пустой
        if (!args || args[0] === "" || args[1] === "") return null;

        return (groupCommand ?? subcommand).autocomplete({
            message: ctx,
            args: args
        });
    };

    /**
     * @description Функция выполняющая действия SelectButton
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectButton = (ctx: ButtonInteraction) => {
        const button = db.components.get(ctx.customId);
        const queue = db.queues.get(ctx.guildId);
        const userChannel = ctx.member.voice.channel;
        const botChannel = ctx.guild.members.me.voice.channel;

        // Если была не найдена кнопка
        // Если пользователь не подключен к голосовым каналам и нет очереди
        // Если есть очередь и пользователь не подключен к тому же голосовому каналу
        const isValid = button && userChannel && botChannel && queue && userChannel.id === queue.message.voiceID;
        if (!isValid) return;

        // Если кнопка была найдена
        return button.callback(ctx as any);
    };

    /**
     * @description Функция выполняющая действия SelectMenu
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectMenuCallback = async (ctx: AnySelectMenuInteraction) => {
        const selector = db.components.get(ctx.customId) as Selector;

        // Если кнопка была найдена
        return selector.callback(ctx as any);
    };
}

/**
 * @author SNIPPIK
 * @description Получаем тип канала, для работы все сервера
 * @function isBased
 */
function isBased(ctx: CommandInteraction) {
    const type = ctx.channel?.type;

    // Проверяем на наличие типа канала
    if (type !== undefined) {
        // Если используется на сервере
        if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || type === ChannelType.GuildStageVoice || type === ChannelType.GuildVoice) return "guild";

        // Если используется в личном чате
        else if (type === ChannelType.PrivateThread) return "private";
    }

    // Если используется на стороннем сервере
    return "public";
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [Interaction];