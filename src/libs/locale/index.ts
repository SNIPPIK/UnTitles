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
 */
export class locale {
    /**
     * @description Перевод на другие языки, перевод берется из базы
     * @param language - Тип locale для перевода
     * @param context - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     */
    public static _ = (language: languages, context: locale_text, args?: any[]) => {
        let translate = locales[context][language] as string;

        //Если нет такой строки
        if (!translate) return `Error: Not found locale ${context}`;

        //Если есть аргументы
        if (args && args.length > 0) {
            for (let i = 0; i < args.length; i++) {
                translate = translate.replace("{ARGUMENT}", args[i]);
            }
        }

        return translate;
    };
}