import type { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import { CommandInteraction, Colors, SelectMenuInteract } from "#structures/discord";
import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { ChannelType, Events, InteractionType } from "discord.js";
import { Logger, locale } from "#structures";
import { SubCommand } from "#handler/commands";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @extends Event
 * @event Events.InteractionCreate
 * @public
 */
@EventOn()
@DeclareEvent({
    name: Events.InteractionCreate,
    type: "client"
})
class Interaction extends Event<Events.InteractionCreate> {
    run: SupportEventCallback<Events.InteractionCreate> = async (ctx) => {
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
        if (ctx.type === InteractionType.ApplicationCommandAutocomplete) {
            Logger.log("DEBUG", `[${ctx.user.username}] run autocomplete ${ctx?.commandName}`);
            return this.SelectAutocomplete(ctx);
        }

        // Если пользователь использует команду
        else if (ctx.type === InteractionType.ApplicationCommand) {
            Logger.log("DEBUG", `[${ctx.user.username}] run command ${ctx?.commandName}`);
            return this.SelectCommand(ctx as any);
        }

        // Действия выбора/кнопок
        else if (ctx.type == InteractionType.MessageComponent) {
            Logger.log("DEBUG", `[${ctx.user.username}] run component ${ctx?.["customId"]}`);
            return this.SelectComponent(ctx);
        }

        return null;
    };

    /**
     * @description Функция выполняющая действия SelectCommand
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectCommand = async (ctx: ChatInputCommandInteraction) => {
        const command = db.commands.get(ctx.commandName);

        // Если нет команды
        // Если пользователь пытается использовать команду разработчика
        if (!command || (command.owner && !db.owner.ids.includes(ctx.member.user.id))) {
            db.commands.remove(ctx.client, ctx.commandGuildId, ctx.commandId);

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [{
                    description: locale._(ctx.locale, "interaction.command.fail"),
                    color: Colors.DarkRed
                }]
            });
        }

        // Проверка middleware
        if (command.middlewares?.length > 0) {
            for (const rule of db.middlewares.array) {
                if (command.middlewares.includes(rule.name) && !rule.callback(ctx)) return null;
            }
        }

        // Проверка прав
        if (command.permissions && isBased(ctx) === "guild") {
            const { user: userPerms, client: botPerms } = command.permissions;

            // Проверка прав пользователя
            if (userPerms?.length &&
                !userPerms.every(perm => ctx.member?.permissions?.has(perm))
            ) {
                return ctx.reply(locale._(ctx.locale, "interaction.permission.user", [ctx.member]));
            }

            // Проверка прав бота
            if (botPerms?.length &&
                !botPerms.every(perm => ctx.guild?.members.me?.permissionsIn(ctx.channel)?.has(perm) && ctx.member.voice.channel ? ctx.guild?.members.me?.permissionsIn(ctx.member.voice.channel)?.has(perm) : true)
            ) {
                return ctx.member.send(locale._(ctx.locale, "interaction.permission.client", [`<@${ctx.client.user.id}>`]));
            }
        }

        // Ищем подкоманду
        const subcommand: SubCommand = command.options?.find((sub) => sub.name === ctx.options["_subcommand"] && "run" in sub) as any;

        // Ищем аргументы
        const args: any[] = ctx.options?.["_hoistedOptions"]?.map(f => f.name === "type" ? f.value : f[f.name] ?? f.value) ?? [];

        // Запускаем команду
        return (subcommand ?? command).run({ ctx, args });
    };

    /**
     * @description Функция выполняющая действия SelectAutocomplete
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectAutocomplete = async (ctx: AutocompleteInteraction) => {
        const command = db.commands.get(ctx.commandName);

        // Если не найдена команда
        if (!command) return null;

        // Ищем аргументы
        const args: any[] = ctx.options?.["_hoistedOptions"]?.map(f => f.name === "type" ? f.value : f[f.name] ?? f.value) ?? [];
        if (args.length === 0 || args.some(a => a === "")) return null;

        const subName = ctx.options["_subcommand"];
        for (const opt of command.options) {
            if (subName ? opt.name === subName : opt.autocomplete) return (opt.autocomplete ?? opt.options?.find(o => o.autocomplete)?.
                autocomplete)?.({ctx, args}) ?? null;
        }

        return null;
    };

    /**
     * @description Функция выполняющая действия компонентов такие как button/selector
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectComponent = async (ctx: ButtonInteraction | SelectMenuInteract) => {
        const component = db.components.get(ctx.customId);
        // Если не найден такой компонент
        if (!component) return null;

        const { middlewares, callback } = component;

        // Делаем проверку ограничений
        if (middlewares?.length > 0) {
            for (const rule of db.middlewares.array) {
                if (middlewares.includes(rule.name) && !rule.callback(ctx)) return null;
            }
        }

        // Если компонент был найден
        return callback(ctx);
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