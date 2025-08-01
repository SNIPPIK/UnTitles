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
        const formats = await Youtube_decoder_native.decipherFormats(message.formats, message.html);
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
class Youtube_decoder_native {
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
                    const callerFunc = DECIPHER_FUNC_NAME + "(" + DECIPHER_ARGUMENT + ");";
                    let resultFunc: string;

                    const sigFunctionMatcher = body.match(TCE_SIGN_FUNCTION_REGEXP);
                    const sigFunctionActionsMatcher = body.match(TCE_SIGN_FUNCTION_ACTION_REGEXP);

                    if (sigFunctionMatcher && sigFunctionActionsMatcher && code) {
                        resultFunc = "var " + DECIPHER_FUNC_NAME + "=" + sigFunctionMatcher[0] + sigFunctionActionsMatcher[0] + code + ";\n";
                        return resultFunc + callerFunc;
                    }

                    const helperMatch = body.match(HELPER_REGEXP);
                    if (!helperMatch) return null;

                    const helperObject = helperMatch[0];
                    const actionBody = helperMatch[2];

                    const reverseKey = mRegex(REVERSE_PATTERN, actionBody);
                    const sliceKey = mRegex(SLICE_PATTERN, actionBody);
                    const spliceKey = mRegex(SPLICE_PATTERN, actionBody);
                    const swapKey = mRegex(SWAP_PATTERN, actionBody);

                    const quotedFunctions = [reverseKey, sliceKey, spliceKey, swapKey]
                        .filter(Boolean)
                        .map(key => key.replace(/[.*+?^${}()|[\]\\]/i, '\\$&'));

                    if (quotedFunctions.length === 0) return null;

                    let funcMatch = body.match(DECIPHER_REGEXP);
                    let isTce = false;
                    let decipherFunc: string;

                    if (funcMatch) decipherFunc = funcMatch[0];
                    else {
                        const tceFuncMatch = body.match(FUNCTION_TCE_REGEXP);
                        if (!tceFuncMatch) return null;

                        decipherFunc = tceFuncMatch[0];
                        isTce = true;
                    }

                    let tceVars = "";
                    if (isTce) {
                        const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    resultFunc = tceVars + helperObject + "\nvar " + DECIPHER_FUNC_NAME + "=" + decipherFunc + ";\n";
                    return resultFunc + callerFunc;
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
                    const callerFunc = N_TRANSFORM_FUNC_NAME + "(" + N_ARGUMENT + ");";
                    let resultFunc = "";
                    let nFunction = "";

                    const nFunctionMatcher = body.match(TCE_N_FUNCTION_REGEXP);

                    if (nFunctionMatcher && name && code) {
                        nFunction = nFunctionMatcher[0];

                        const tceEscapeName = name.replace("$", "\\$");
                        const shortCircuitPattern = new RegExp(
                            `;\\s*if\\s*\\(\\s*typeof\\s+[a-zA-Z0-9_$]+\\s*===?\\s*(?:\"undefined\"|'undefined'|${tceEscapeName}\\[\\d+\\])\\s*\\)\\s*return\\s+\\w+;`
                        );

                        const tceShortCircuitMatcher = nFunction.match(shortCircuitPattern);

                        if (tceShortCircuitMatcher) {
                            nFunction = nFunction.replaceAll(tceShortCircuitMatcher[0], ";");
                        }

                        resultFunc = "var " + N_TRANSFORM_FUNC_NAME + "=" + nFunction + code + ";\n";
                        return resultFunc + callerFunc;
                    }

                    let nMatch = body.match(N_TRANSFORM_REGEXP);
                    let isTce = false;

                    if (nMatch) nFunction = nMatch[0];
                    else {

                        const nTceMatch = body.match(N_TRANSFORM_TCE_REGEXP);
                        if (!nTceMatch) return null;

                        nFunction = nTceMatch[0];
                        isTce = true;
                    }

                    const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);
                    if (!paramMatch) return null;

                    const paramName = paramMatch[1];

                    const cleanedFunction = nFunction.replace(
                        new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramName}\\s*;?`, "g"),
                        ""
                    );

                    let tceVars = "";
                    if (isTce) {
                        const tceVarsMatch = body.match(TCE_GLOBAL_VARS_REGEXP);
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    resultFunc = tceVars + "var " + N_TRANSFORM_FUNC_NAME + "=" + cleanedFunction + ";\n";
                    return resultFunc + callerFunc;
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
        const [decipher, nTransform] = await this.extractPage(html5player);
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

        const decipherF = (url: string) => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url as string;

            try {
                const context = { [DECIPHER_ARGUMENT]: decodeURIComponent(args.s as any) };
                const components = new URL(decodeURIComponent(args.url as any));
                const decipheredSig = decipher.runInNewContext(Object.assign(context, console));

                components.searchParams.set((args.sp || "sig" as any), decipheredSig);
                return components.toString();
            } catch (err) {
                return args.url as string;
            }
        };

        const nTransformF = (url: string) => {
            try {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get("n");

                if (!n || !nTransform) return url;
                const context = { [N_ARGUMENT]: n };
                const transformedN = nTransform.runInNewContext(Object.assign(context, console));

                if (transformedN) components.searchParams.set("n", transformedN);

                return components.toString();
            } catch (err) {
                return url;
            }
        };

        const cipher = !format.url;
        const url = format.url || format.signatureCipher || format.cipher;

        if (!url) return;

        try {
            format.url = nTransformF(cipher ? decipherF(url) : url);
            delete format.signatureCipher;
            delete format.cipher;
        } catch (err) {
            throw err;
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param html5 - Ссылка на плеер
     * @private
     */
    private static extractPage = async (html5: string) => {
        const body = await new httpsClient({url: html5}).toString;

        if (body instanceof Error) return null;

        const { name, code } = extractTceFunc(body);
        return [this.extractDecipher(body, name, code), this.extractNTransform(body, name, code)];
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
            } catch {
            }
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

const DECIPHER_FUNC_NAME = "CORDODecipherFunc";
const N_TRANSFORM_FUNC_NAME = "CORDONTransformFunc";

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

const TCE_SIGN_FUNCTION_ACTION_REGEXP = new RegExp("var\\s+([$A-Za-z0-9_]+)\\s*=\\s*\\{\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*};", "s");

const TCE_N_FUNCTION_REGEXP = new RegExp("function\\s*\\((\\w+)\\)\\s*\\{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?catch\\s*\\(\\s*(\\w+)\\s*\\)\\s*\\{return\\s*\\w+\\[\\d+\\]\\s*\\+\\s*\\1\\}\\s*return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\s*\\;", "s");

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";
