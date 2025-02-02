import type {LocalizationMap, Locale, Permissions} from "discord-api-types/v10";
import {ApplicationCommandOption, Client} from "discord.js";
import filters from "@service/player/filters.json";
import {AudioFilter} from "@service/player";
import {Logger, Interact} from "@utils";
import {env, handler} from "@handler";

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
        const temples: SlashComponent["choices"] = [];

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
    }

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): Command | null => {
        for (const cmd of this.files) {
            // Если указанное имя совпало с именем команды
            if (cmd.name === names) return cmd;

            // Проверяем имена если это список
            else if (names instanceof Array) {
                // Проверяем все указанные имена команды
                for (const name of names) {
                    // Если нашлась подходящая
                    if (cmd.name === name || cmd.name === name) return cmd;
                }
            }
        }

        return null;
    };

    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() { return this.files.filter((command) => command.owner === true); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.files.filter((command) => command.owner !== true); };

    /**
     * @description Загружаем класс вместе с дочерним
     */
    public constructor() {
        super("src/handlers/commands");
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

    /**
     * @description Функция для перезагрузки
     * @public
     */
    public preregister = (client: Client) => {
        this.unload();

        // Регистрируем команды
        this.register(client);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для команд
 * @interface Command
 */
export interface Command {
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
     * @description Можно ли использовать команду в личном текстовом канале
     * @private
     */
    dm_permission?: boolean;

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
    readonly integration_types?: number[];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    readonly contexts?: number[];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: ApplicationCommandOption[];

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    readonly owner?: boolean;

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
        message: Interact;

        /**
         * @description Тип команды, необходимо для работы много ступенчатых команд
         * @warning Необходимо правильно понимать логику загрузки команд для работы с этим параметром
         */
        type: Command["options"][number]["name"];

        /**
         * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
         */
        args?: SlashComponent["choices"][number]["value"][];
    }) => void;
}

/**
 * @author SNIPPIK
 * @description Декоратор slash команды
 * @constructor
 */
export function SlashCommand(options: SlashCommandOptions) {
    const name_key = Object.keys(options.names)[0] as Locale
    const name = options.names[name_key];
    const name_localizations = options.names;

    const description_key = Object.keys(options.descriptions)[0] as Locale;
    const description = options.descriptions[description_key];
    const description_localizations = options.descriptions;

    const SubOptions: SlashComponent[] = [];

    // Создаем компонент команды для discord
    for (let obj of options.options) {
        // Если надо подменить данные для работы с discord
        SubOptions.push(
            {
                ...obj,
                name: obj.names[Object.keys(obj.names)[0] as Locale],
                nameLocalizations: obj.names,
                description: obj.descriptions[Object.keys(obj.descriptions)[0] as Locale],
                descriptionLocalizations: obj.descriptions,
                options: obj.options ? obj.options.map((option) => {
                    return {
                        ...option,
                        name: option.names[Object.keys(option.names)[0] as Locale],
                        nameLocalizations: option.names,
                        description: option.descriptions[Object.keys(option.descriptions)[0] as Locale],
                        descriptionLocalizations: option.descriptions,
                    };
                }) : undefined
            } as any
        );
    }

    // Загружаем данные в класс
    return function (target: Function) {
        target.prototype.name = name;
        target.prototype["name_localizations"] = name_localizations;
        target.prototype.description = description;
        target.prototype["description_localizations"] = description_localizations;
        target.prototype["default_member_permissions"] = null;
        target.prototype.dm_permission = options?.dm_permission ?? null;
        target.prototype["integration_types"] = [0];
        target.prototype["contexts"] = [0];
        target.prototype.options = SubOptions;
        target.prototype["nsfw"] = false;
    };
}

/**
 * @author SNIPPIK
 * @description Параметры декоратора
 * @interface SlashCommandOptions
 */
interface SlashCommandOptions {
    names: LocalizationMap;
    descriptions: LocalizationMap;
    options: SlashComponent[];

    dm_permission?: boolean;
}

/**
 * @author SNIPPIK
 * @description Оригинальный элемент выбора
 * @interface DiscordSlashChoice
 */
interface DiscordSlashChoice {
    /**
     * @description Имя действия
     */
    readonly name: string;

    /**
     * @description Тип возврата данных, нужен для кода разработчика
     */
    readonly value: string;

    /**
     * @description Перевод имен действий на разные языки
     */
    readonly nameLocalizations?: LocalizationMap;
}

/**
 * @author SNIPPIK
 * @description Упрощающий элемент создания компонентов для команд
 * @interface SlashComponent
 */
export interface SlashComponent {
    /**
     * @description Имена команды на разных языках
     */
    readonly names: ApplicationCommandOption['nameLocalizations'];

    /**
     * @description Описание команды на разных языках
     */
    readonly descriptions: ApplicationCommandOption["descriptionLocalizations"];

    /**
     * @description Тип вводимых данных
     */
    readonly type: ApplicationCommandOption["type"];

    /**
     * @description Ввод данных обязателен
     */
    readonly required?: boolean;

    /**
     * @description Доп команды к команде или к подкоманде. Внимание нельзя нарушать структуру discord а то команды не будут приняты
     */
    readonly options?: SlashComponent[];

    /**
     * @description Список действий на выбор пользователей
     */
    choices?: (DiscordSlashChoice)[];
}