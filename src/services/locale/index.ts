import type { LocalizationMap } from "discord-api-types/v10";
import locales from "./languages.json";

/**
 * @author SNIPPIK
 * @description Все доступные языки для помощи
 * @type languages
 */
export type languages = `${keyof LocalizationMap}`;

/**
 * @author SNIPPIK
 * @description Все доступные имена переменных для помощи
 * @type locale_text
 */
type locale_text = keyof typeof locales;

/**
 * @author SNIPPIK
 * @description Переводчик на разные языки
 * @class locale
 * @public
 */
export class locale {
    /**
     * @description Язык по-умолчанию, использовать только тот, где есть перевод на 100%
     * @static
     * @public
     */
    public static get language(): languages {
        return "en-US";
    };

    /**
     * @description Переименование однотипных языков
     * @param language - Тип locale для перевода
     */
    private static universalLang = (language: languages): languages => {
        if (["en-GB"].includes(language)) return "en-US";
        else if (["es-419"].includes(language)) return "es-ES";
        else if (["zh-TW"].includes(language)) return "zh-CN";

        return language;
    };

    /**
     * @description Перевод на другие языки, перевод берется из базы
     * @param language - Тип locale для перевода
     * @param locale - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     * @static
     * @public
     */
    public static _ = (language: languages, locale: locale_text, args?: any[]) => {
        const lang = this.universalLang(language);
        let translate = locales[locale][lang] as string;

        // Если нет такой строки
        if (!translate) {
            // По умолчанию будет выведен указанный язык
            translate = locales[locale][this.language];
        }

        // Если есть аргументы
        if (args && args.length > 0) {
            for (let i = 0; i < args.length; i++) {
                translate = translate.replace("{ARGUMENT}", args[i]);
            }
        }

        return translate;
    };

    /**
     * @description Перевод ошибки на язык по-умолчанию
     * @param locale - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     * @static
     * @public
     */
    public static err = (locale: locale_text, args?: any[]) => {
        return Error(this._(this.language, locale, args));
    };
}