import type {LocalizationMap} from "discord-api-types/v10";
import locales from "@lib/db/json/languages.json";
import {env} from "@env";

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
    private static readonly language = env.get("language");
    /**
     * @description Перевод на другие языки, перевод берется из базы
     * @param language - Тип locale для перевода
     * @param context - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     */
    public static _ = (language: languages, context: locale_text, args?: any[]) => {
        //@ts-ignore
        let translate = locales[context] as string;

        //Если нет такой строки
        if (!translate) return `Error: Not found locale ${context}`;

        translate = translate[language] as string;

        //Если нет такого перевода
        if (!translate) translate = locales[context][this.language];

        //Если есть аргументы
        if (args && args.length > 0) {
            for (let i = 0; i < args.length; i++) {
                translate = translate.replace("{ARGUMENT}", args[i]);
            }
        }

        return translate;
    };
}