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
    private name_localizations: LocalizationMap = undefined

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
    }

    /**
     * @description Устанавливаем название команды
     * @param name - Имя команды
     */
    public setName(name: string) {
        this.name = name;
        return this;
    };

    /**
     * @description Устанавливаем перевод имени команды
     * @param locale - Object, с именами для перевода
     */
    public setNameLocale(locale: LocalizationMap) {
        this.name_localizations = locale;
        return this;
    };

    /**
     * @description Устанавливаем описание команды
     * @param description - Описание команды
     */
    public setDescription(description: string) {
        this.description = description;
        return this;
    };

    /**
     * @description Устанавливаем перевод описания команды
     * @param locale - Object, с именами для перевода
     */
    public setDescriptionLocale(locale: LocalizationMap) {
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
    public addSubCommands(subcommands: ApplicationCommandOption[]) {
        this.options.push(...subcommands);
        return this;
    };
}