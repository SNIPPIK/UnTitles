import { ApplicationCommandOption, ApplicationCommandOptionType, ApplicationCommandType, PermissionsString, Routes } from "discord.js";
import type {AutocompleteCommandOption, Choice, ChoiceOption} from "./index.decorator";
import type { LocalizationMap, Permissions } from "discord-api-types/v10";
import { CommandInteraction, DiscordClient } from "#structures/discord";
import { RegisteredMiddlewares } from "#handler/middlewares";
import filters from "#core/player/filters.json";
import { AudioFilter } from "#core/player";
import { Logger } from "#structures";
import { handler } from "#handler";
import { env } from "#app/env";


// Export decorator
export * from "./index.decorator";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с командами
 * @class Commands
 * @extends handler
 * @public
 */
export class Commands extends handler<Command> {
    /**
     * @description Создаем список фильтров для дискорд
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
        super("src/handlers/commands");
    };

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): Command | SubCommand => {
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
    public remove = (client: DiscordClient, guildID: string, CommandID: string) => {
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
    public register = (client: DiscordClient) => {
        const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);
        this.load();

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
export abstract class BaseCommand {
    type?: ApplicationCommandType = ApplicationCommandType.ChatInput; // ApplicationCommandType.ChatInput | ApplicationCommandOptionType.Subcommand

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
    readonly integration_types?: (0 | 1)[];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    readonly contexts?: (0 | 1 | 2)[];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: ((AutocompleteCommandOption & ChoiceOption) & ApplicationCommandOption)[];

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
    readonly permissions: {
        /**
         * @description Права для пользователя
         */
        readonly user?: PermissionsString[],

        /**
         * @description Права для клиента (бота)
         */
        readonly client: PermissionsString[]
    };

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
    abstract run(options: CommandContext<any>): any

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
            name: BaseCommand['name'];
            type: BaseCommand['type'];
            nsfw: BaseCommand['nsfw'];
            description: BaseCommand['description'];
            name_localizations: BaseCommand['name_localizations'];
            description_localizations: BaseCommand['description_localizations'];
            default_member_permissions: string;
            contexts: BaseCommand['contexts'];
            integration_types: BaseCommand['integration_types'];
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
export abstract class Command extends BaseCommand {
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
export abstract class SubCommand extends BaseCommand {
    type = ApplicationCommandOptionType.Subcommand as any;

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

/**
 * @author SNIPPIK
 * @description Параметры команды
 * @type CommandContext
 * @public
 */
export type CommandContext<T = string> = {
    /**
     * @description Сообщение пользователя для работы с discord
     */
    ctx: CommandInteraction;

    /**
     * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
     */
    args?: T[];
}