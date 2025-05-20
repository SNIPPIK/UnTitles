import {ApplicationCommandOption, Client, Routes, PermissionsString} from "discord.js";
import type {LocalizationMap, Locale, Permissions} from "discord-api-types/v10";
import {CommandInteraction, CompeteInteraction} from "@structures";
import filters from "@service/player/filters.json";
import {AudioFilter} from "@service/player";
import {handler} from "@handler";
import {Logger} from "@utils";
import {env} from "@app/env";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с командами
 * @class Commands
 */
export class Commands extends handler<Command> {
    /**
     * @description Создаем список фильтров для дискорд
     * @public
     */
    public get filters_choices() {
        const temples: SlashCommand.Component["choices"] = [];

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
        return this.files.filter(cmd => cmd.owner === true);
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
     */
    public constructor() {
        super("src/handlers/commands");
    };

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): Command | null => {
        // Если указанное имя совпало с именем команды
        if (typeof names === "string") {
            return this.files.find(cmd => cmd.name === names) ?? null;
        }

        // Проверяем имена если это список
        return this.files.find(cmd => names.includes(cmd.name)) ?? null;
    };

    /**
     * @description Удаление команды, полезно когда команда все еще есть в списке, но на деле ее нет
     * @param client - Клиент
     * @param guildID - ID сервера
     * @param CommandID - ID Команды
     */
    public remove = (client: Client, guildID: string, CommandID: string) => {
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
    public register = (client: Client) => {
        const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);
        this.load();

        // Если команды не были загружены
        if (!this.files.length) throw new Error("Not loaded commands");

        // Загрузка глобальных команд
        client.application.commands.set(this.public as any)
            .then(() => Logger.log("DEBUG", `[App/Commands | ${this.public.length}] has load public commands`))
            .catch(console.error);

        // Загрузка приватных команд
        if (guild) guild.commands.set(this.owner as any)
            .then(() => Logger.log("DEBUG", `[App/Commands | ${this.owner.length}] has load guild commands`))
            .catch(console.error);
    };
}

/**
 * @author SNIPPIK
 * @description Базовый интерфейс для команд, что должна включать в себя команда
 * @interface BaseCommand
 */
export interface BaseCommand<Argument = string> {
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
    readonly rules?: ("voice" | "queue" | "another_voice" | "player-not-playing")[]

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    readonly execute: (options: {
        /**
         * @description Сообщение пользователя для работы с discord
         */
        message: CommandInteraction;

        /**
         * @description Тип команды, необходимо для работы много ступенчатых команд
         * @warning Необходимо правильно понимать логику загрузки команд для работы с этим параметром
         */
        type: Command["options"][number]["name"];

        /**
         * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
         */
        args?: Argument[];
    }) => any;

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
        message: CompeteInteraction;

        /**
         * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
         */
        args?: Argument[];

        /**
         * @description Тип опции, будет указан если используется много ступенчатая команда
         */
        type?: string
    }) => any;
}

/**
 * @author SNIPPIK
 * @description Интерфейс команды прошедший парсинг и все декораторы
 * @warnig НЕ СОЗДАВАТЬ ПО НЕМУ КОМАНДЫ ЭТОТ ИНТЕРФЕЙС ЯВЛЯФЕТСЯ ТИПИЗАЦИОННЫМ И НЕ ВСЕ ПАРАМЕТРЫ МОГУТ БЫТЬ ПРАВИЛЬНО СОЗДАНЫ
 * @interface Command
 */
export interface Command extends BaseCommand {
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
    readonly options?: ApplicationCommandOption[];
}

/**
 * @author SNIPPIK
 * @description Декоратор slash команды
 * @constructor
 * @decorator
 */
export function SlashCommand(options: SlashCommand.Options) {
    const name_key = Object.keys(options.names)[0] as Locale
    const name = options.names[name_key];
    const name_localizations = options.names;

    const description_key = Object.keys(options.descriptions)[0] as Locale;
    const description = options.descriptions[description_key];
    const description_localizations = options.descriptions;

    // Загружаем данные в класс
    return function (target: Function) {
        target.prototype.name = name;
        target.prototype["name_localizations"] = name_localizations;
        target.prototype.description = description;
        target.prototype["description_localizations"] = description_localizations;
        target.prototype["integration_types"] = options.integration_types ? options.integration_types.map((type) => type === "GUILD_INSTALL" ? 0 : 1) : [0];
        target.prototype["contexts"] = options.contexts ? options.contexts.map((type) => type === "GUILD" ? 0 : type === "BOT_DM" ? 1 : 2) : [0];
    };
}

/**
 * @author SNIPPIK
 * @description Декоратор параметром доп команды
 * @constructor
 * @decorator
 */
export function SlashCommandSubCommand(component: SlashCommand.Component) {
    const transformed: SlashCommand.Component = {
        ...component,
        name: component.names[Object.keys(component.names)[0] as Locale],
        nameLocalizations: component.names,
        description: component.descriptions[Object.keys(component.descriptions)[0] as Locale],
        descriptionLocalizations: component.descriptions,
        options: component.options
            ? component.options.map(opt => ({
                ...opt,
                name: opt.names[Object.keys(opt.names)[0] as Locale],
                nameLocalizations: opt.names,
                description: opt.descriptions[Object.keys(opt.descriptions)[0] as Locale],
                descriptionLocalizations: opt.descriptions,
            }))
            : undefined,
    } as any;

    return function (target: Function) {
        // Если нет options — создаём массив
        if (!Array.isArray(target.prototype.options)) {
            target.prototype.options = [];
        }
        // Добавляем новый объект
        target.prototype.options.push(transformed);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейсы slash-command
 * @namespace SlashCommand
 */
export namespace SlashCommand {
    /**
     * @author SNIPPIK
     * @description Параметры декоратора
     * @interface Options
     */
    export interface Options {
        /**
         * @description Имена команды на разных языках
         * @example Первое именование будет выставлено для других языков как по-умолчанию
         * @public
         */
        readonly names: LocalizationMap;

        /**
         * @description Описание команды на розных языках
         * @example Первое именование будет выставлено для других языков как по-умолчанию
         * @public
         */
        readonly descriptions: LocalizationMap;

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
    }

    /**
     * @author SNIPPIK
     * @description Оригинальный элемент выбора
     * @interface Choice
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
     * @description Упрощающий элемент создания компонентов для команд
     * @interface Component
     */
    export interface Component {
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
         * @description Доп команды к команде или к подкоманде. Внимание нельзя нарушать структуру discord а то команды не будут приняты
         * @public
         */
        options?: Component[];

        /**
         * @description Список действий на выбор пользователей
         * @public
         */
        choices?: Choice[];

        /**
         * @description Если ли возможность редактировать данные ввода
         * @public
         */
        autocomplete?: boolean;
    }
}