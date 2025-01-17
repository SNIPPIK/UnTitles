import type {LocalizationMap} from "discord-api-types/v10";
import {ApplicationCommandOption} from "discord.js";

/**
 * @author SNIPPIK
 * @description Декоратор slash команд
 * @param options - Параметр для конфигурации
 * @constructor
 */
export function SlashBuilder(options: SlashCommandOptions) {
    const name = options.names[Object.keys(options.names)[0]];
    const name_localizations = options.names;

    const description = options.descriptions[Object.keys(options.descriptions)[0]];
    const description_localizations = options.descriptions;

    const SubOptions = [];

    // Создаем компонент команды для discord
    for (let obj of options.options) {

        // Если надо подменить данные для работы с discord
        SubOptions.push(
            {
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
            } as any
        );
    }

    // Загружаем данные в класс
    return function (target: Function) {
        target.prototype.name = name;
        target.prototype.name_localizations = name_localizations;
        target.prototype.description = description;
        target.prototype.description_localizations = description_localizations;

        target.prototype.default_member_permissions = null;
        target.prototype.dm_permission = options?.dm_permission ?? null;

        target.prototype.integration_types = [0];
        target.prototype.contexts = [0];

        target.prototype.options = SubOptions;

        target.prototype.nsfw = false;
    };
}

/**
 * @author SNIPPIK
 * @description Параметры декоратора
 */
interface SlashCommandOptions {
    names: LocalizationMap;
    descriptions: LocalizationMap;
    options: SlashComponent[];

    dm_permission?: boolean;
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