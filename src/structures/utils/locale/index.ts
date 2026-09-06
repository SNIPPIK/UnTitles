import type { LocalizationMap } from "discord-api-types/v10";
import locales from "./languages.json" with { type: 'json' };

/**
 * @author SNIPPIK
 * @description Все доступные языки для помощи
 * @type languages
 */
export type languages = `${keyof LocalizationMap}`;

/**
 * @author SNIPPIK
 * @description Все доступные имена переменных для помощи
 * @type localeString
 */
export type localeString = keyof typeof locales;

/**
 * @author SNIPPIK
 * @description Переводчик на разные языки
 * @class locale
 * @public
 */
export class locale {
    /** Регулярка для поиска плейсхолдеров. Оптимизирована для глобального поиска */
    private static readonly ARG_REGEX = /{ARGUMENT}/g;

    /**
     * @description Язык по-умолчанию, использовать только тот, где есть перевод на 100%
     * @returns languages
     * @public
     */
    public static get language(): languages {
        return "en-US";
    };

    /**
     * @description Переименование однотипных языков
     * @param language - Тип locale для перевода
     * @returns languages
     * @private
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
     * @returns string
     * @public
     */
    public static _ = (language: languages, locale: localeString, args: readonly unknown[] = []) => {
        const lang = this.universalLang(language);
        const entry = locales[locale];

        // Безопасное получение текста
        let template = entry?.[lang] ?? entry?.[this.language] ?? locale;
        if (args.length === 0) return template;

        // Прогон по тексту, если есть аргументы для передачи
        let i = 0;
        return template.replace(this.ARG_REGEX, () => {
            const v = args[i++];
            return v !== undefined && v !== null ? v : "{ARGUMENT}";
        });
    };

    /**
     * @description Перевод ошибки на язык по-умолчанию
     * @param locale - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     * @returns Error
     * @public
     */
    public static err = (locale: localeString, args?: any[]) => {
        return Error(this._(this.language, locale, args));
    };
}