import { type ApplicationCommandOption, ApplicationCommandType, type PermissionsString } from "discord.js";
import type { Locale, LocalizationMap, Permissions } from "discord-api-types/v10";
import type { CommandInteraction, CompeteInteraction } from "#structures/discord";
import type { RegisteredMiddlewares } from "#handler/middlewares";
import type { SubCommand } from "#handler/commands";

/**
 * @author SNIPPIK
 * @description Декоратор, объявляющий основные метаданные команды: имя, локализации, тип,
 *              контексты установки, права и флаг владельца.
 * @param options - Конфигурация команды (ChatInput или User/Message).
 *
 * @remarks
 * Декоратор применяется к классу команды и добавляет ему поля:
 * - `name` / `name_localizations` — имя и его локализации.
 * - `description` / `description_localizations` — описание (только для ChatInput).
 * - `type` — тип команды (ChatInput, User, Message).
 * - `integration_types` — способы установки (GUILD_INSTALL → 0, USER_INSTALL → 1).
 * - `contexts` — контексты использования (GUILD → 0, BOT_DM → 1, PRIVATE_CHANNEL → 2).
 * - `owner` — доступна только разработчику.
 *
 * @example
 * ```ts
 * @Declare({
 *   names: { "en-US": "ping", ru: "пинг" },
 *   descriptions: { "en-US": "Pong!", ru: "Понг!" },
 *   integration_types: ["GUILD_INSTALL", "USER_INSTALL"]
 * })
 * export default class PingCommand extends Command { ... }
 * ```
 *
 * @public
 */
export function Declare(options: DeclareOptionsChatInput | DeclareOptionsUser) {
    const CommandType = options.type ?? ApplicationCommandType.ChatInput;

    const [nameKey] = Object.keys(options.names) as Locale[];
    const [descKey] = CommandType === 1 ? Object.keys(options["descriptions"]) as Locale[] : [null];

    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.names[nameKey];
            name_localizations = options.names;

            // Защита от дурака
            description = CommandType === 1 ? options["descriptions"][descKey] : null;
            description_localizations = CommandType === 1 ? options["descriptions"] : null;
            // Защита от дурака

            integration_types = options.integration_types ?? [0];
            contexts = options.contexts ?? [0];
            owner = options.owner ?? false;
            type = CommandType;
        }
}

/**
 * @author SNIPPIK
 * @description Декоратор, определяющий параметры (опции) команды.
 * @param options - Массив классов подкоманд `SubCommand` или объект с опциями.
 *
 * @remarks
 * Если передан массив, каждый элемент должен быть классом `SubCommand`,
 * экземпляры которого будут созданы и сохранены в поле `options`.
 * Если передан объект, значения будут нормализованы функцией `normalizeOption`.
 *
 * @example
 * ```ts
 * @Options({
 *   user: { type: 6, names: { ru: "пользователь" }, descriptions: { ru: "Кого пинговать" }, required: true }
 * })
 * export default class PingCommand extends Command { ... }
 * ```
 *
 * @public
 */
export function Options(options: (new () => SubCommand)[] | OptionsRecord<any>) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            options: SubCommand[] | AutocompleteCommandOption<T> | ChoiceOption[] = Array.isArray(options)
                ? options.map(x => new x())
                : Object.values(options).map(normalizeOption);
        };
}

/**
 * @author SNIPPIK
 * @description Декоратор, добавляющий middleware (промежуточные обработчики) к команде.
 * @param cbs - Массив зарегистрированных middleware (имена или функции).
 *
 * @remarks
 * Middleware могут проверять права, состояние голосового канала и т.п.
 * Выполняются перед основным рантаймом команды.
 * Главное правильно валидировать проверки!!!
 *
 * @public
 */
export function Middlewares(cbs: RegisteredMiddlewares[]) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            middlewares = cbs;
        };
}

/**
 * @author SNIPPIK
 * @description Декоратор, задающий права (permissions), необходимые для выполнения команды.
 * @param permissions - Объект CommandPermissions
 *
 * @remarks
 * Поле `permissions` будет скопировано в класс команды.
 *
 * @public
 */
export function Permissions(permissions: CommandPermissions) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            permissions = permissions;
        };
}





/**
 * @author SNIPPIK
 * @description Базовый интерфейс для общих свойств декоратора `Declare`.
 * @private
 */
type DeclareOptionsBase = {
    /**
     * Локализованные имена команды (ключ — код языка).
     * @example { "en-US": "ping", ru: "пинг" }
     */
    readonly names: LocalizationMap;

    /**
     * Права, необходимые для использования команды (битфилд).
     */
    default_member_permissions?: Permissions | null | undefined;

    /**
     * Типы установки команды: в гильдию или в аккаунт пользователя.
     */
    readonly integration_types?: CommandIntegration[];

    /**
     * Контексты, в которых команда доступна: гильдия, ЛС бота, приватный канал.
     */
    readonly contexts?: CommandContext[];

    /**
     * Флаг, указывающий, что команда доступна только разработчику.
     * @default false
     */
    readonly owner?: boolean;
}

/**
 * @author SNIPPIK
 * @description Параметры команды
 * @type CommandCallback
 * @public
 */
export type CommandCallback<T = string> = {
    /**
     * @description Сообщение пользователя для работы с discord
     */
    ctx: CommandInteraction;

    /**
     * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
     */
    args?: T[];
}

/**
 * @author SNIPPIK
 * @description Права для использования команды, ограничения нужны если права для бота не выданы
 *
 * @remarks
 * - client = Нужные права для работы бота
 * - user = Нудные права для работы с пользователем
 *
 * @public
 */
export interface CommandPermissions {
    /** Права для пользователя */
    readonly user?: PermissionsString[],

    /** Права для клиента (бота) */
    readonly client: PermissionsString[]
}

/**
 * @author SNIPPIK
 * @description Типы интеграции команд, как можно использовать команду
 *
 * @remarks
 * - Guild = Позволяет использовать команду только на сервере, где есть бот
 * - User = Позволяет использовать команду даже без бота на сервере
 *
 * @public
 */
export enum CommandIntegration {
    /** Только для сервера */
    Guild = 0,

    /** Только для пользователя */
    User = 1
}

/**
 * @author SNIPPIK
 * @description Типы интеграции команд, где будет доступна команда
 *
 * @remarks
 * - Guild = Команда доступна на сервере
 * - Bot = Команда доступна другим ботам
 * - Private = Команду можно использовать как в DM, так и в приватный чатах (группах)
 *
 * @public
 */
export enum CommandContext {
    /** Только для сервера */
    Guild = 0,

    /** Только для ботов */
    Bot = 1,

    /** Только для DM, приватных чатов */
    Private = 2
}





/**
 * @author SNIPPIK
 * @description Расширенные параметры для команд с текстовым вводом (ChatInput).
 * @private
 */
type DeclareOptionsChatInput = DeclareOptionsBase & {
    /** Тип команды (по умолчанию ChatInput) */
    type?: ApplicationCommandType.ChatInput;

    /** Локализованные описания команды */
    descriptions: LocalizationMap;
};

/**
 * @author SNIPPIK
 * @description Расширенные параметры для команд, работающих с пользователем или сообщением.
 * @private
 */
type DeclareOptionsUser = DeclareOptionsBase & {
    /** Тип команды (User или Message) */
    type: ApplicationCommandType.User | ApplicationCommandType.Message;
};

/**
 * @author SNIPPIK
 * @description Интерфейс для выбора (choice) в опциях типа String, Integer, Number.
 * @public
 */
export interface Choice {
    /** Отображаемое имя выбора. */
    name: string;

    /** Значение, отправляемое при выборе. */
    value: string;

    /** Локализованные имена выбора. */
    nameLocalizations?: LocalizationMap;
}

/**
 * @author SNIPPIK
 * @description Базовые свойства любой опции команды.
 * @private
 */
type BaseCommandOption = {
    /** Локализованные имена опции. */
    names: ApplicationCommandOption['nameLocalizations'];

    /** Локализованные описания опции. */
    descriptions: ApplicationCommandOption["descriptionLocalizations"];

    /** Тип опции (см. ApplicationCommandOptionType). */
    type: ApplicationCommandOption["type"];

    /** Обязательность заполнения. */
    required?: boolean;

    /** Вложенные опции (для подкоманд и групп). */
    readonly options?: BaseCommandOption[];
}

/**
 * @author SNIPPIK
 * @description Все типы подкоманд, надо для корректного ответа со стороны API
 *
 * @remarks
 *
 * @public
 */
export enum CommandOptionsType {
    Subcommand = 1,
    SubcommandGroup = 2,
    String = 3,
    Integer = 4,
    Boolean = 5,
    User = 6,
    Channel = 7,
    Role = 8,
    Mentionable = 9,
    Number = 10,
    Attachment = 11,
}

/**
 * @author SNIPPIK
 * @description Опция с поддержкой автодополнения (autocomplete).
 * @public
 */
export type AutocompleteCommandOption<T> = {
    /**
     * Функция автодополнения, вызываемая при вводе пользователя.
     * @param options.ctx - контекст взаимодействия.
     * @param options.args - аргументы команды (если есть).
     */
    readonly autocomplete?: (options: {
        ctx: CompeteInteraction;
        args?: T[];
    }) => void;

    /** Вложенные опции. */
    readonly options?: AutocompleteCommandOption<T>[];
} & BaseCommandOption;

/**
 * @author SNIPPIK
 * @description Опция с фиксированными вариантами выбора.
 * @public
 */
export type ChoiceOption = BaseCommandOption & {
    /** Список вариантов выбора. */
    choices?: Choice[];

    /** Вложенные опции. */
    readonly options?: ChoiceOption[];
};

/**
 * @author SNIPPIK
 * @description Объект, содержащий опции по ключам.
 * @private
 */
type OptionsRecord<T> = Record<string, AutocompleteCommandOption<T> | ChoiceOption & BaseCommandOption>;

/**
 * @author SNIPPIK
 * @description Приводит объект опции к формату, понятному Discord API.
 *              Извлекает имя и описание по первому ключу локализации.
 * @param opt - Исходная опция.
 * @returns Нормализованный объект опции.
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