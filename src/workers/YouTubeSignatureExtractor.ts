import { isMainThread, parentPort } from "node:worker_threads";
import { httpsClient } from "#structures";
import querystring from "node:querystring";
import { Script } from "node:vm";


/**
 * @author SNIPPIK
 * @description Если запускается фрагмент кода в другом процессе
 */
if (!isMainThread) {
    // Разовое событие
    parentPort.once("message", async (message) => {
        const formats = await YouTubeSignatureExtractor.decipherFormats(message.formats, message.html);
        return parentPort.postMessage(formats[0]);
    });
}

/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param pattern - Как искать имена
 * @param text - Строка где будем искать
 */
const mRegex = (pattern: string | RegExp, text: string): string | null => {
    const match = text.match(pattern);
    if (!match || match.length < 2) return null;
    return match[1].replace(/\$/i, "\\$");
};


/**
 * @author SNIPPIK
 * @description Поиск вспомогательных данных
 * @param body - Страница
 */
const extractTceFunc = (body: string) => {
    try {
        const matcher = body.match(NEW_TCE_GLOBAL_VARS_REGEXP);
        if (!matcher?.groups?.varname || !matcher.groups.code) return null;

        return {
            name: matcher.groups.varname,
            code: matcher.groups.code
        };
    } catch (error) {
        console.error("extractTceFunc error:", error);
        return null;
    }
};


/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на исходный файл для youtube
 * @class Youtube_decoder
 * @private
 */
class YouTubeSignatureExtractor {
    /**
     * @author SNIPPIK
     * @description Функции для расшифровки
     */
    private static extractors: { name: string, callback: (body: string, name: string, code: number) => any }[] = [
        /**
         * @description Получаем функцию с данными
         */
        {
            name: "extractDecipherFunction",
            callback: (body, _, code) => {
                try {
                    const callerFunc = `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;

                    // --- Попытка взять TCE-вариант (новая схема YouTube) ---
                    const sigFunc = body.match(TCE_SIGN_FUNCTION_REGEXP);
                    const sigActions = body.match(TCE_SIGN_FUNCTION_ACTION_REGEXP);

                    if (sigFunc && sigActions && code) return `var ${DECIPHER_FUNC_NAME}=${sigFunc[0]}${sigActions[0]}${code};\n${callerFunc}`;

                    // --- Классический helper ---
                    const helperMatch = body.match(HELPER_REGEXP);
                    if (!helperMatch) return null;

                    const [helperObject, , actionBody] = helperMatch;

                    // Поиск ключей операций
                    const keys = [
                        mRegex(REVERSE_PATTERN, actionBody),
                        mRegex(SLICE_PATTERN, actionBody),
                        mRegex(SPLICE_PATTERN, actionBody),
                        mRegex(SWAP_PATTERN, actionBody),
                    ].filter(Boolean);

                    if (keys.length === 0) return null;

                    // --- Функция-дешифратор ---
                    let decipherFunc = body.match(DECIPHER_REGEXP)?.[0];
                    let tceVars = "";

                    if (!decipherFunc) {
                        const tceFunc = body.match(FUNCTION_TCE_REGEXP);
                        if (!tceFunc) return null;
                        decipherFunc = tceFunc[0];

                        // Если TCE — берем глобальные переменные
                        const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
                        if (tceVarsMatch) tceVars = `${tceVarsMatch[1]};\n`;
                    }

                    return `${tceVars}${helperObject}\nvar ${DECIPHER_FUNC_NAME}=${decipherFunc};\n${callerFunc}`;
                } catch (e) {
                    console.error("Error in extractDecipherFunc:", e);
                    return null;
                }
            }
        },

        /**
         * @description Получаем данные n кода - для ускоренной загрузки с серверов
         */
        {
            name: "extractNTransformFunction",
            callback: (body, name, code) => {
                try {
                    const caller = `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;

                    // Попытка найти прямую TCE-функцию
                    const tceMatch = body.match(TCE_N_FUNCTION_REGEXP);
                    if (tceMatch && name && code) {
                        let func = tceMatch[0];
                        const escapedName = name.replace("$", "\\$");
                        const shortCircuit = new RegExp(
                            `;\\s*if\\s*\\(\\s*typeof\\s+[\\w$]+\\s*===?\\s*(?:\"undefined\"|'undefined'|${escapedName}\\[\\d+\\])\\s*\\)\\s*return\\s+\\w+;`
                        );
                        func = func.replace(shortCircuit, ";");
                        return `var ${N_TRANSFORM_FUNC_NAME}=${func}${code};\n${caller}`;
                    }

                    // Альтернатива: стандартный или TCE-формат
                    const nMatch = body.match(N_TRANSFORM_REGEXP) ?? body.match(N_TRANSFORM_TCE_REGEXP);
                    if (!nMatch) return null;

                    let func = nMatch[0];
                    let tceVars = "";
                    if (!body.match(N_TRANSFORM_REGEXP)) {
                        const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
                        tceVars = tceVarsMatch ? tceVarsMatch[1] + ";\n" : "";
                    }

                    const param = func.match(/function\s*\(\s*(\w+)\s*\)/)?.[1];
                    if (!param) return null;

                    func = func.replace(new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${param}\\s*;?`, "g"), "");

                    return `${tceVars}var ${N_TRANSFORM_FUNC_NAME}=${func};\n${caller}`;
                } catch (e) {
                    console.error("Error in extractNTransformFunc:", e);
                    return null;
                }
            }
        }
    ];

    /**
     * @description Применяем преобразования decipher и n параметров ко всем URL-адресам формата.
     * @param formats - Все форматы аудио или видео
     * @param html5player - Ссылка на плеер
     */
    public static decipherFormats = async (formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat[]> => {
        // Получаем страницу плеера
        const body = await new httpsClient({url: html5player}).toString;

        // Если при получении страницы плеера произошла ошибка
        if (body instanceof Error) return formats;

        const { name, code } = extractTceFunc(body);
        const [ decipher, nTransform ] = [this.extractDecipher(body, name, code), this.extractNTransform(body, name, code)];

        for (let item of formats) this.getting_url(item, {decipher, nTransform});
        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     * @private
     */
    private static getting_url = (format: YouTubeFormat, {decipher, nTransform}: YouTubeChanter): void => {
        if (!format) return;

        const rawUrl = format.url || format.signatureCipher || format.cipher;
        if (!rawUrl) return;

        const decodeURL = (url: string) => {
            try {
                return new URL(decodeURIComponent(url));
            } catch {
                return null;
            }
        };
        const applyDecipher = (url: string) => {
            if (!decipher) return url;

            const args = querystring.parse(url);
            if (!args.s) return args.url as string;

            try {
                const context = { [DECIPHER_ARGUMENT]: decodeURIComponent(args.s as string) };
                const components = decodeURL(args.url as string);
                if (!components) return args.url as string;

                const deciphered = decipher.runInNewContext({ ...context, console });
                components.searchParams.set((args.sp as string) || DECIPHER_ARGUMENT, deciphered);
                return components.toString();
            } catch {
                return args.url as string;
            }
        };
        const applyNTransform = (url: string) => {
            if (!nTransform) return url;

            const components = decodeURL(url);
            if (!components) return url;

            const nParam = components.searchParams.get("n");
            if (!nParam) return url;

            try {
                const transformed = nTransform.runInNewContext({ [N_ARGUMENT]: nParam, console });
                if (transformed) components.searchParams.set("n", transformed);
                return components.toString();
            } catch {
                return url;
            }
        };

        try {
            const initialUrl = rawUrl === format.url ? rawUrl : applyDecipher(rawUrl);
            format.url = applyNTransform(initialUrl);

            delete format.signatureCipher;
            delete format.cipher;
        } catch (err) {
            throw err;
        }
    };

    /**
     * @description Извлекает функции расшифровки N типа
     * @param body - Страница плеера
     * @param name - Имя функции
     * @param code - Данные функции
     * @private
     */
    private static extractNTransform = (body: string, name: string, code: string) => {
        const nTransformFunc = this.extraction([this.extractors[1].callback], body, name, code);
        if (!nTransformFunc) return null;
        return nTransformFunc;
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param body - Страница плеера
     * @param name - Имя функции
     * @param code - Данные функции
     * @private
     */
    private static extractDecipher = (body: string, name: string, code: string) => {
        const decipherFunc = this.extraction([this.extractors[0].callback], body, name, code);
        if (!decipherFunc) return null;
        return decipherFunc;
    };

    /**
     * @description Получаем функции для расшифровки
     * @param extractFunctions - Функция расшифровки
     * @param body - Станица youtube
     * @param name - Имя функции
     * @param code - Данные функции
     * @param postProcess - Если есть возможность обработать сторонний код
     * @private
     */
    private static extraction = (extractFunctions: Function[], body: string, name: string, code: string, postProcess = null) => {
        for (const extractFunction of extractFunctions) {
            try {
                // Если есть функция
                const func = extractFunction(body, name, code);

                // Если нет функции
                if (!func) continue;

                // Выполняем виртуальный код
                return new Script(postProcess ? postProcess(func) : func);
            } catch {}
        }

        return null;
    };
}


/**
 * @author SNIPPIK
 * @description Общий стандарт аудио или видео json объекта
 * @interface YouTubeFormat
 */
interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
    acodec?: string;
    fps?: number;
}

/**
 * @author SNIPPIK
 * @description Варианты расшифровки url
 * @interface YouTubeChanter
 */
interface YouTubeChanter {
    decipher?: Script;
    nTransform?: Script;
}

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";
const DECIPHER_FUNC_NAME = "DecipherFunc";
const N_TRANSFORM_FUNC_NAME = "NTransformFunc";

const VARIABLE_PART = "[a-zA-Z_\\$][a-zA-Z_0-9\\$]*";
const VARIABLE_PART_DEFINE = "\\\"?" + VARIABLE_PART + "\\\"?";
const BEFORE_ACCESS = "(?:\\[\\\"|\\.)";
const AFTER_ACCESS = "(?:\\\"\\]|)";
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ":function\\(\\w\\)\\{(?:return )?\\w\\.reverse\\(\\)\\}";
const SLICE_PART = ":function\\(\\w,\\w\\)\\{return \\w\\.slice\\(\\w\\)\\}";
const SPLICE_PART = ":function\\(\\w,\\w\\)\\{\\w\\.splice\\(0,\\w\\)\\}";
const SWAP_PART = ":function\\(\\w,\\w\\)\\{" +
    "var \\w=\\w\\[0\\];\\w\\[0\\]=\\w\\[\\w%\\w\\.length\\];\\w\\[\\w(?:%\\w.length|)\\]=\\w(?:;return \\w)?\\}";

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_REGEXP = new RegExp(
    "function(?: " + VARIABLE_PART + ")?\\(([a-zA-Z])\\)\\{" +
    "\\1=\\1\\.split\\(\"\"\\);\\s*" +
    "((?:(?:\\1=)?" + VARIABLE_PART + VARIABLE_PART_ACCESS + "\\(\\1,\\d+\\);)+)" +
    "return \\1\\.join\\(\"\"\\)" +
    "\\}", "s");

const HELPER_REGEXP = new RegExp(
    "var (" + VARIABLE_PART + ")=\\{((?:(?:" +
    VARIABLE_PART_DEFINE + REVERSE_PART + "|" +
    VARIABLE_PART_DEFINE + SLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SPLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SWAP_PART +
    "),?\\n?)+)\\};", "s");

const FUNCTION_TCE_REGEXP = new RegExp(
    "function(?:\\s+[a-zA-Z_\\$][a-zA-Z0-9_\\$]*)?\\(\\w\\)\\{" +
    "\\w=\\w\\.split\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\);" +
    "\\s*((?:(?:\\w=)?[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\[\\\"|\\.)[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\\"\\]|)\\(\\w,\\d+\\);)+)" +
    "return \\w\\.join\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\)}", "s");

const N_TRANSFORM_REGEXP = new RegExp(
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
    "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
    "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};', "s");

const N_TRANSFORM_TCE_REGEXP = new RegExp(
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*var\\s*(\\w+)=\\1\\.split\\(\\1\\.slice\\(0,0\\)\\),\\s*(\\w+)=\\[.*?];" +
    ".*?catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z_0-9$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
    "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};", "s");

const TCE_GLOBAL_VARS_REGEXP = new RegExp(
    "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
    "(?:" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
    "\\s*\\.\\s*split\\((" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
    "\\))" +
    "|" +
    "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
    "))(?=\\s*[,;])", "s");

const NEW_TCE_GLOBAL_VARS_REGEXP = new RegExp(
    "('use\\s*strict';)?" +
    "(?<code>var\\s*" +
    "(?<varname>[a-zA-Z0-9_$]+)\\s*=\\s*" +
    "(?<value>" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\.split\\(" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\)" +
    "|" +
    "\\[" +
    "(?:(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\s*,?\\s*)*" +
    "\\]" +
    "|" +
    "\"[^\"]*\"\\.split\\(\"[^\"]*\"\\)" +
    ")" +
    ")", "m");

const TCE_SIGN_FUNCTION_REGEXP = new RegExp("function\\(\\s*([a-zA-Z0-9$])\\s*\\)\\s*\\{" +
    "\\s*\\1\\s*=\\s*\\1\\[(\\w+)\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\);" +
    "([a-zA-Z0-9$]+)\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    "\\s*\\3\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    ".*?return\\s*\\1\\[\\2\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\)\\};", "s");

const VARIABLE_PART_OBJECT_DECLARATION = "[\"']?[a-zA-Z_\\$][a-zA-Z_0-9\\$]*[\"']?"
const TCE_SIGN_FUNCTION_ACTION_REGEXP = new RegExp(
"var\\s+([$A-Za-z0-9_]+)\\s*=\\s*\\{" +
"\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*," +
"\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*," +
"\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*};", "s");

const TCE_N_FUNCTION_REGEXP = new RegExp("function\\s*\\((\\w+)\\)\\s*\\{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?catch\\s*\\(\\s*(\\w+)\\s*\\)\\s*\\{return\\s*\\w+\\[\\d+\\]\\s*\\+\\s*\\1\\}\\s*return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\s*\\;", "gs");