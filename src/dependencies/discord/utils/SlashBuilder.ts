import type {LocalizationMap, Permissions} from "discord-api-types/v10";
import {ApplicationCommandOption} from "discord.js";

/**
 * @author SNIPPIK
 * @description Создаем slash command, просто и быстро.
 * @class SlashBuilder
 * @public
 */
export class SlashBuilder {
    /**
     * @description Название команды
     * @private
     */
    private name: string = undefined;

    /**
     * @description Переводы названия команды на другие языки
     * @private
     */
    private name_localizations: LocalizationMap = undefined;

    /**
     * @description Описание команды
     * @private
     */
    private description: string = undefined;

    /**
     * @description Описание команды на другие языки
     * @private
     */
    private description_localizations: LocalizationMap = undefined;

    /**
     * @description Можно ли использовать команду в личном текстовом канале
     * @private
     */
    private dm_permission: boolean = undefined;

    /**
     * @description Права на использование команды
     * @private
     */
    private default_member_permissions: Permissions | null | undefined = undefined;

    /**
     * @description 18+ доступ
     * @private
     */
    private nsfw: boolean = false;

    /**
     * @description Контексты установки, в которых доступна команда, только для команд с глобальной областью действия. По умолчанию используются настроенные контексты вашего приложения.
     * @public
     */
    private integration_types: number[] = [0];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    private contexts: number[] = [0];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    private options: ApplicationCommandOption[] = [];

    /**
     * @description Выдаем json данные для отправки на discord api
     * @public
     */
    public get json() {
        return {
            name: this.name,
            name_localizations: this.name_localizations,

            description: this.description,
            description_localizations: this.description_localizations,

            default_member_permissions: this.default_member_permissions,
            dm_permission: this.dm_permission,

            integration_types: this.integration_types,
            contexts: this.contexts,

            options: this.options,
            nsfw: this.nsfw
        };
    };

    /**
     * @description Контексты установки, в которых доступна команда, только для команд с глобальной областью действия. По умолчанию используются настроенные контексты вашего приложения.
     * @param types - Типы от 0 до 1, [0,1]
     * @public
     */
    public setIntegration_types = (types: number[]) => {
        this.integration_types = types;
        return this;
    };

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @param types - Типы от 0 до 2, [0,1,2]
     * @public
     */
    public setContexts = (types: number[]) => {
        this.contexts = types;
        return this;
    };

    /**
     * @description Устанавливаем название команды, первый в списке язык будет выбран основным
     * @param locale - Object, с именами для перевода
     */
    public setName = (locale: LocalizationMap) => {
        this.name = locale[Object.keys(locale)[0]];
        this.name_localizations = locale;
        return this;
    };

    /**
     * @description Устанавливаем описание команды, первый в списке язык будет выбран основным
     * @param locale - Object, с именами для перевода
     */
    public setDescription(locale: LocalizationMap) {
        this.description = locale[Object.keys(locale)[0]];
        this.description_localizations = locale;
        return this;
    };

    /**
     * @description Устанавливаем разрешение на использование в лс
     * @param enable - Можно ли ее использовать в лс
     */
    public setDMPermission(enable: boolean = false) {
        this.dm_permission = enable;
        return this;
    };

    /**
     * @description Устанавливаем параметры для команды
     * @param subcommands - Sub commands
     */
    public addSubCommands(subcommands: SlashComponent[]) {
        // Создаем компонент команды для discord
        for (let obj of subcommands) {

            // Если надо подменить данные для работы с discord
            const component = {
                ...obj,
                name: obj.names[Object.keys(obj.names)[0]],
                nameLocalizations: obj.names,
                description: obj.descriptions[Object.keys(obj.descriptions)[0]],
                descriptionLocalizations: obj.descriptions,
                options: obj.options ? obj.options.map((option) => {
                    return {
                        ...option,
                        name: option.names[Object.keys(option.names)[0]],
                        nameLocalizations: option.names,
                        description: option.descriptions[Object.keys(option.descriptions)[0]],
                        descriptionLocalizations: option.descriptions,
                    };
                }) : []
            };

            this.options.push(component as any);
        }

        return this;
    };
}

/**
 * @author SNIPPIK
 * @description Упрощающий элемент создания компонентов для команд
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
    readonly choices?: {
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
    }[]
}