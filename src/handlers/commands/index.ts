import {
    type ApplicationCommandOption, ApplicationCommandType, type Client,
    GuildMember, Routes
} from "discord.js";
import {
    AnyCommandInteraction,
    buttonInteraction,
    Colors,
    CompeteInteraction,
    DiscordClient,
    SelectMenuInteract
} from "#structures/discord/index.js";
import {
    AutocompleteCommandOption,
    Choice,
    ChoiceOption, CommandCallback,
    CommandContext,
    CommandIntegration, CommandOptionsType,
    CommandPermissions
} from "./index.decorator.js";
import type { LocalizationMap, Permissions } from "discord-api-types/v10";
import type { RegisteredMiddlewares } from "#handler/middlewares/index.js";
import filters from "#core/player/filters.json" with { type: 'json' };
import type { RestClientSide } from "#handler/rest/index.js";
import type { AudioFilter } from "#core/player/index.js";
import { locale, Logger } from "#structures";
import { handler } from "#handler";
import { env } from "#app/env";


// Export decorator
export * from "./index.decorator.js";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с командами
 * @class Commands
 * @extends handler
 * @public
 */
export class Commands extends handler<Command> {
    /**
     * @description Создаем список фильтров для UI discord
     * @public
     */
    public get filters_choices() {
        const temples: Choice[] = [];

        // Если фильтров слишком много
        if (filters.length > 25) return temples;

        // Перебираем фильтр
        for (const filter of filters as AudioFilter[]) {
            // Проверяем кол-во символов на допустимость discord (100 шт.)
            for (const [key, value] of Object.entries(filter.locale)) {
                if (value.startsWith("[")) continue;

                // Добавляем диапазон аргументов
                if (filter.args) filter.locale[key] = `<${filter.args[0]}-${filter.args[1]}> - ${filter.locale[key]}`;

                // Удаляем лишний размер описания
                filter.locale[key] = value.length > 75 ? `[${filter.name}] - ${filter.locale[key].substring(0, 75)}...` : `[${filter.name}] - ${filter.locale[key]}`;
            }

            // Создаем список для показа фильтров в командах
            temples.push({
                name: filter.locale[Object.keys(filter.locale)[0]],
                nameLocalizations: filter.locale,
                value: filter.name
            });
        }

        return temples;
    };

    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() {
        return this.files.filter(cmd => cmd.owner);
    };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() {
        return this.files.filter(cmd => !cmd.owner);
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @constructor
     * @public
     */
    public constructor() {
        super("build/src/handlers/commands");
    };

    /**
     * @description Вернется если произойдет любая ошибка при взаимодействии с ботом
     * @param ctx
     * @param error
     * @public
     */
    public onInteractionFail = (ctx: AnyCommandInteraction | CompeteInteraction | buttonInteraction | SelectMenuInteract, error: Error | string) => {
        Logger.log(
            "ERROR",
            `\nIntegration Reject | ${ctx.id}\n` +
            `┌ Reason:  ${error instanceof Error ? error.message : String(error)}\n` +
            `└ Stack:   ${error instanceof Error ? error.stack : "N/A"}`
        );
    };

    /**
     * @description Вернется если бот не владеет правами
     * @param ctx
     * @public
     */
    public onClientPermissionFail = (ctx: AnyCommandInteraction) => {
        return ctx.reply(locale._(ctx.locale, "interaction.permission.user", [ctx.member]));
    };

    /**
     * @description Вернется если пользователь не владеет правами
     * @param ctx
     * @public
     */
    public onUserPermissionFail = (ctx: AnyCommandInteraction) => {
        const member = ctx.member;

        if (member instanceof GuildMember) {
            return member.send(locale._(ctx.locale, "interaction.permission.client", [member]));
        }

        return null;
    };

    /**
     * @description Вернется если команды нет в системе
     * @param ctx
     * @public
     */
    public onCommandFail = (ctx: AnyCommandInteraction) => {
        this.remove(ctx.client, ctx.commandGuildId, ctx.commandId);

        return ctx.reply({
            flags: "Ephemeral",
            embeds: [{
                description: locale._(ctx.locale, "interaction.command.fail"),
                color: Colors.DarkRed
            }]
        });
    };

    /**
     * @description Отправка данных в зависимости от текста пользователя
     * @param message - Сообщение
     * @param platform - Платформа
     * @param search - Текст или ссылка пользователя
     * @public
     */
    public playAutocomplete = async (message: CompeteInteraction, platform: RestClientSide.Request, search: string) => {
        // Если платформа заблокирована
        if (platform?.block || !platform?.auth) {
            return message.respond([
                {
                    name: locale._(message.locale, "api.platform.block"),
                    value: "|BLOCK_PLATFORM|"
                }
            ])
        }

        // Получаем функцию запроса данных с платформы
        const api = platform.request(search, { audio: false });

        if (!api.type) {
            return message.respond([
                {
                    name: locale._(message.locale, "api.request.fail"),
                    value: "|CriticalError|"
                }
            ])
        }

        try {
            // Получаем данные в системе rest/API
            const rest = await api.request();
            const items: { value: string; name: string }[] = [];

            // Если получена ошибка или нет данных
            if (rest instanceof Error || !rest) {
                return message.respond([
                    {
                        name: locale._(message.locale, "api.error", [`${rest}`]),
                        value: "|CriticalError|"
                    }
                ])
            }

            // Обработка массива данных
            if (Array.isArray(rest)) {
                items.push(...rest.map((track) => {
                    return {
                        name: `🎵 (${track.time?.split}) | ${track.artist.title?.slice(0, 20)} - ${track.name?.slice(0, 60)}`,
                        value: track.url,
                    }
                }));
            }

            // Показываем плейлист
            else if ("items" in rest) items.push({
                name: `🎶 [${rest.items.length}] - ${rest.title?.slice(0, 70)}`,
                value: rest.url
            });

            // Показываем трек
            else {
                items.push({
                    name: `🎵 (${rest.time?.split}) | ${rest.artist.title?.slice(0, 20)} - ${rest.name?.slice(0, 60)}`,
                    value: rest.url
                });
            }

            // Отправка ответа
            return message.respond(items);
        } catch (err) {
            console.error(err);
            return null;
        }
    };

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): Command | SubCommand => {
        if (typeof names === "string") return this.map.get(names);

        return this.files.find((cmd) => {
            // Если указанное имя совпало с именем команды
            if (typeof names === "string") return cmd.name === names;

            // Проверяем имена если это список
            return names.includes(cmd.name);
        });
    };

    /**
     * @description Удаление команды, полезно когда команда все еще есть в списке, но на деле ее нет
     * @param client - Клиент
     * @param guildID - ID сервера
     * @param CommandID - ID Команды
     */
    public remove = (client: DiscordClient | Client, guildID: string, CommandID: string) => {
        // Удаление приватной команды
        if (guildID) client.rest.delete(Routes.applicationGuildCommand(client.user.id, guildID, CommandID))
            .then(() => Logger.log("DEBUG", `[App/Commands | ${CommandID}] has removed in guild ${guildID}`))
            .catch(console.error);

        // Удаление глобальной команды
        else client.rest.delete(Routes.applicationCommand(client.user.id, CommandID))
            .then(() => Logger.log("DEBUG", `[App/Commands | ${CommandID}] has removed`))
            .catch(console.error);
    };

    /**
     * @description Регистрируем команды в эко системе discord
     * @public
     */
    public register = async (client: DiscordClient) => {
        const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);
        await this.load();

        // Если команды не были загружены
        if (!this.files.size) throw new Error("Not loaded commands");

        // Загрузка глобальных команд
        client.application.commands.set(this.parseJsonData(this.public) as any)
            .then(() => Logger.log("DEBUG", `[App/Commands | ${this.public.length}] has load public commands`))
            .catch(console.error);

        // Загрузка приватных команд
        if (guild) guild.commands.set(this.parseJsonData(this.owner) as any)
            .then(() => Logger.log("DEBUG", `[App/Commands | ${this.owner.length}] has load guild commands`))
            .catch(console.error);
    };

    /**
     * @description Передаем только необходимые данные discord'у
     * @param data - Все команды
     * @private
     */
    private parseJsonData = (data: Command[]) => {
        return data.map(cmd => cmd.toJSON());
    };
}

/**
 * @author SNIPPIK
 * @description Стандартный прототип команды
 * @class BaseCommand
 * @abstract
 * @public
 */
export abstract class BaseCommand<T> {
    type?: T;

    /**
     * @description Название команды
     * @private
     */
    name?: string;

    /**
     * @description Переводы названия команды на другие языки
     * @private
     */
    name_localizations?: LocalizationMap;

    /**
     * @description Описание команды
     * @private
     */
    description?: string;

    /**
     * @description Описание команды на другие языки
     * @private
     */
    description_localizations?: LocalizationMap;

    /**
     * @description Права на использование команды
     * @private
     */
    default_member_permissions?: Permissions | null | undefined;

    /**
     * @description 18+ доступ
     * @private
     */
    nsfw?: boolean;

    /**
     * @description Контексты установки, в которых доступна команда, только для команд с глобальной областью действия. По умолчанию используются настроенные контексты вашего приложения.
     * @public
     */
    readonly integration_types?: CommandIntegration[];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    readonly contexts?: CommandContext[];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: ((AutocompleteCommandOption<any> & ChoiceOption) & ApplicationCommandOption)[];

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    readonly owner?: boolean;

    /**
     * @description Управление правами
     * @private
     */
    readonly permissions: CommandPermissions;

    /**
     * @description Права для использования той или иной команды
     * @default null
     * @readonly
     * @public
     */
    readonly middlewares?: RegisteredMiddlewares[]

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    abstract run(options: CommandCallback<any>): any;

    /**
     * @description Отдаем данные в формате JSON и только необходимые
     * @public
     */
    public toJSON() {
        return {
            name: this.name,
            type: this.type,
            nsfw: !!this.nsfw,
            description: this.description,
            name_localizations: this.name_localizations,
            description_localizations: this.description_localizations,
            default_member_permissions: this.default_member_permissions,
            contexts: this.contexts,
            integration_types: this.integration_types,
        } as {
            name: BaseCommand<T>['name'];
            type: BaseCommand<T>['type'];
            nsfw: BaseCommand<T>['nsfw'];
            description: BaseCommand<T>['description'];
            name_localizations: BaseCommand<T>['name_localizations'];
            description_localizations: BaseCommand<T>['description_localizations'];
            default_member_permissions: string;
            contexts: BaseCommand<T>['contexts'];
            integration_types: BaseCommand<T>['integration_types'];
        };
    };
}

/**
 * @author SNIPPIK
 * @description Глобальный прототип команды
 * @extends BaseCommand
 * @class Command
 * @abstract
 * @public
 */
export abstract class Command extends BaseCommand<ApplicationCommandType> {
    type = ApplicationCommandType.ChatInput;
    /**
     * @description Отдаем данные в формате JSON и только необходимые
     * @public
     */
    public toJSON = () => {
        const options: ApplicationCommandOption[] = [];

        for (const i of this.options ?? []) {
            if (!(i instanceof SubCommand)) {
                // Изменяем данные autocomplete на boolean
                options.push({ ...i, autocomplete: "autocomplete" in i } as ApplicationCommandOption);
                continue;
            }

            // Добавляем данные
            options.push(i.toJSON() as any);
        }

        return {
            ...super.toJSON(),
            options,
        };
    }
}

/**
 * @author SNIPPIK
 * @description Глобальный прототип под команды
 * @extends BaseCommand
 * @class Command
 * @abstract
 * @public
 */
export abstract class SubCommand extends BaseCommand<CommandOptionsType> {
    type = CommandOptionsType.Subcommand;

    /**
     * @description Отдаем данные в формате JSON и только необходимые
     * @public
     */
    public toJSON = () => {
        return {
            ...super.toJSON(),

            // Изменяем данные autocomplete на boolean
            options: this.options?.map(x => ({ ...x, autocomplete: "autocomplete" in x }) as ApplicationCommandOption) ?? [],
        };
    };
}