import type {LocalizationMap, Permissions} from "discord-api-types/v10";
import {ApplicationCommandOption} from "discord.js";

/**
 * @author SNIPPIK
 * @description Создаем slash command, просто и быстро.
 * @class SlashBuilder
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
    private nsfw: boolean = false

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

            options: this.options,
            nsfw: this.nsfw
        };
    };

    /**
     * @description Устанавливаем название команды, первый в списке язык будет выбран основным
     * @param locale - Object, с именами для перевода
     */
    public setName = (locale: LocalizationMap) => {
        this.name = locale[Object.keys(locale).at(-1)];
        this.name_localizations = locale;
        return this;
    };

    /**
     * @description Устанавливаем описание команды, первый в списке язык будет выбран основным
     * @param locale - Object, с именами для перевода
     */
    public setDescription(locale: LocalizationMap) {
        this.description = locale[Object.keys(locale).at(-1)];
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
    names: ApplicationCommandOption['nameLocalizations'];

    /**
     * @description Описание команды на разных языках
     */
    descriptions: ApplicationCommandOption["descriptionLocalizations"];

    /**
     * @description Тип вводимых данных
     */
    type: ApplicationCommandOption["type"];

    /**
     * @description Ввод данных обязателен
     */
    required?: boolean;

    /**
     * @description Доп команды к команде или к подкоманде. Внимание нельзя нарушать структуру discord а то команды не будут приняты
     */
    options?: SlashComponent[];

    /**
     * @description Список действий на выбор пользователей
     */
    choices?: {
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
    }[]
}