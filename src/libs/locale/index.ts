import type {LocalizationMap} from "discord-api-types/v10";
import locales from "@lib/db/json/languages.json";

/**
 * @author SNIPPIK
 * @description Все доступные языки для помощи
 * @type languages
 */
type languages = keyof LocalizationMap;

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
     * @description Перевод на другие языки, перевод берется из базы
     * @param language - Тип locale для перевода
     * @param locale - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     */
    public static _ = (language: languages, locale: locale_text, args?: any[]) => {
        let translate = locales[locale][language] as string;

        // Если нет такой строки
        if (!translate) {
            // По умолчанию будет выведен английский язык
            translate = locales[locale]["en-US"];
        }

        // Если есть аргументы
        if (args && args.length > 0) {
            for (let i = 0; i < args.length; i++) {
                translate = translate.replace("{ARGUMENT}", args[i]);
            }
        }

        return translate;
    };
}