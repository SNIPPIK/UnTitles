import { type ApplicationCommandOption, ApplicationCommandType } from "discord.js";
import type { Locale, LocalizationMap, Permissions } from "discord-api-types/v10";
import type { RegisteredMiddlewares } from "#handler/middlewares";
import type { BaseCommand, SubCommand } from "#handler/commands";
import type { CompeteInteraction } from "#structures/discord";

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок команды
 * @decorator
 */
export function Declare(options: DeclareOptionsChatInput | DeclareOptionsUser) {
    const CommandType = options.type ?? ApplicationCommandType.ChatInput;

    const [nameKey] = Object.keys(options.names) as Locale[];
    const [descKey] = CommandType === 1 ? Object.keys(options["descriptions"]) as Locale[] : [null];

    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.names[nameKey];
            name_localizations = options.names;

            description = CommandType === 1 ? options["descriptions"][descKey] : null;
            description_localizations = CommandType === 1 ? options["descriptions"] : null;

            integration_types = options.integration_types?.map(x => x === "GUILD_INSTALL" ? 0 : 1) ?? [0];
            contexts = options.contexts?.map(x => x === "GUILD" ? 0 : x === "BOT_DM" ? 1 : 2) ?? [0];
            owner = options.owner ?? false;
            type = CommandType;
        }
}

/**
 * @author SNIPPIK
 * @description Декоратор под команд
 * @decorator
 */
export function Options(options: (new () => SubCommand)[] | OptionsRecord) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            options: SubCommand[] | AutocompleteCommandOption | ChoiceOption[] = Array.isArray(options)
                ? options.map(x => new x())
                : Object.values(options).map(normalizeOption);
        };
}

/**
 * @author SNIPPIK
 * @description Декоратор ограничений
 * @decorator
 */
export function Middlewares(cbs: RegisteredMiddlewares[]) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            middlewares = cbs;
        };
}

/**
 * @author SNIPPIK
 * @description Декоратор ограничений
 * @decorator
 */
export function Permissions(permissions: BaseCommand["permissions"]) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            permissions = permissions;
        };
}


/**
 * @author SNIPPIK
 * @description Параметры декоратора команды по умолчанию
 * @usage Только как компонент для остальных
 * @type DeclareOptionsBase
 */
type DeclareOptionsBase = {
    /**
     * @description Имена команды на разных языках
     * @example Первое именование будет выставлено для других языков как по-умолчанию
     * @public
     */
    readonly names: LocalizationMap;

    /**
     * @description Права на использование команды
     * @private
     */
    default_member_permissions?: Permissions | null | undefined;

    /**
     * @description Контексты установки, в которых доступна команда, только для команд с глобальной областью действия. По умолчанию используются настроенные контексты вашего приложения.
     * @public
     */
    readonly integration_types?: ("GUILD_INSTALL" | "USER_INSTALL")[];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    readonly contexts?: ("GUILD" | "BOT_DM" | "PRIVATE_CHANNEL")[];

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    readonly owner?: boolean;
}

/**
 * @author SNIPPIK
 * @description Параметры декоратора команды
 * @usage Только как основной компонент для создания команд
 * @type DeclareOptionsChatInput
 */
type DeclareOptionsChatInput = DeclareOptionsBase & {
    /**
     * @description Тип команды, поддерживаются все доступные типы
     * @default ChatInput = 1
     * @public
     */
    type?: ApplicationCommandType.ChatInput;

    /**
     * @description Описание команды на розных языках
     * @example Первое именование будет выставлено для других языков как по-умолчанию
     * @public
     */
    descriptions: LocalizationMap;
};

/**
 * @author SNIPPIK
 * @description Параметры декоратора команды
 * @usage Только как основной компонент для создания команд пользователя
 * @type DeclareOptionsUser
 */
type DeclareOptionsUser = DeclareOptionsBase & {
    /**
     * @description Тип команды, поддерживаются все доступные типы
     * @default ChatInput = 1
     * @public
     */
    type: ApplicationCommandType.User | ApplicationCommandType.Message;
};


/**
 * @author SNIPPIK
 * @description Оригинальный элемент выбора
 * @interface Choice
 * @public
 */
export interface Choice {
    /**
     * @description Имя действия
     */
    name: string;

    /**
     * @description Тип возврата данных, нужен для кода разработчика
     */
    value: string;

    /**
     * @description Перевод имен действий на разные языки
     */
    nameLocalizations?: LocalizationMap;
}


/**
 * @author SNIPPIK
 * @description Параметры параметров autocomplete
 */
type BaseCommandOption = {
    /**
     * @description Имена команды на разных языках
     * @example Первое именование будет выставлено для других языков как по-умолчанию
     * @public
     */
    names: ApplicationCommandOption['nameLocalizations'];

    /**
     * @description Описание команды на разных языках
     * @example Первое именование будет выставлено для других языков как по-умолчанию
     * @public
     */
    descriptions: ApplicationCommandOption["descriptionLocalizations"];

    /**
     * @description Тип вводимых данных
     * @public
     */
    type: ApplicationCommandOption["type"];

    /**
     * @description Ввод данных обязателен
     * @public
     */
    required?: boolean;

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: BaseCommandOption[];
}

/**
 * @author SNIPPIK
 * @description Параметры параметров autocomplete
 */
export type AutocompleteCommandOption = {
    /**
     * @description Выполнение действия autocomplete
     * @default null
     * @readonly
     * @public
     */
    readonly autocomplete?: (options: {
        /**
         * @description Сообщение пользователя для работы с discord
         */
        ctx: CompeteInteraction;

        /**
         * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
         */
        args?: any[];
    }) => any;

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: AutocompleteCommandOption[];
} & BaseCommandOption;

/**
 * @author SNIPPIK
 * @description Параметры параметров autocomplete
 */
export type ChoiceOption = {
    /**
     * @description Список действий на выбор пользователей
     * @public
     */
    choices?: Choice[];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: ChoiceOption[];
} & BaseCommandOption;

/**
 * @author SNIPPIK
 * @description Записываем параметры команды в json формат
 */
type OptionsRecord = Record<string, AutocompleteCommandOption | ChoiceOption & BaseCommandOption>;

/**
 * @author SNIPPIK
 * @description Нормализуем параметры подкоманд для discord api
 * @param opt - Параметры подкоманд
 * @private
 */
function normalizeOption(opt: BaseCommandOption) {
    const [nameKey] = Object.keys(opt.names) as Locale[];
    const [descKey] = Object.keys(opt.descriptions) as Locale[];

    return {
        ...opt,
        name: opt.names[nameKey],
        nameLocalizations: opt.names,
        description: opt.descriptions[descKey],
        descriptionLocalizations: opt.descriptions,
        options: opt.options?.map(normalizeOption)
    };
}