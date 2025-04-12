import {isMainThread, parentPort} from "node:worker_threads";
import {httpsClient} from "@handler/rest";
import querystring from "node:querystring";
import {Script} from "node:vm";

/**
 * @author SNIPPIK
 * @description Если запускается фрагмент кода в другом процессе
 */
if (!isMainThread) {
    // Разовое событие
    parentPort.once("message", async (message) => {
        if (message.type === "native") {
            const formats = await Youtube_decoder_native.decipherFormats(message.formats, message.html);
            return parentPort.postMessage(formats[0]);
        }

        const formats = await YouTube_encoder_ytd.decipherFormats(message.url);
        return parentPort.postMessage(formats[0]);
    });
}

/**
 * @author SNIPPIK
 * @description Сторонний расшифровщик аудио
 * @name YouTube_encoder_ytd
 */
class YouTube_encoder_ytd {
    /**
     * @description Код для выполнения запуска youtube-dl
     * @private
     */
    private static runCommand = null;

    /**
     * @description Получаем аудио дорожку
     * @param url - Ссылка на видео
     * @public
     */
    public static decipherFormats = (url: string): Promise<YouTubeFormat | Error> => {
        try {
            // Если нет загруженной команды запуска
            if (!this.runCommand) this.runCommand = require("youtube-dl-exec");
        } catch {
            // Если нет youtube-dl-exec
            throw Error("YouTube-Dl is not installed! Pls install youtube-dl-exec");
        }

        // Запускаем команду
        return new Promise((resolve) => {
            return this.runCommand(url, {
                printJson: true,
                skipDownload: true,
                noWarnings: true,
                noCheckCertificates: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot']
            }).then((output) => {
                if (typeof output === "string") return resolve(Error(`[APIs]: ${output}`));

                const format = output.formats.find((format: YouTubeFormat) => format.acodec && format.acodec.match(/opus/));
                return resolve(format);
            })
        });
    }
}

/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param pattern - Как искать имена
 * @param text - Строка где будем искать
 */
const mRegex = (pattern: string | RegExp, text: string) => {
    const match = text.match(pattern);
    return match ? match[1].replace(/[$\\]/g, "\\$&") : null;
};

/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на исходный файл для youtube
 * @class Youtube_decoder
 */
class Youtube_decoder_native {
    /**
     * @author SNIPPIK
     * @description Функции для расшифровки
     */
    private static extractors: { name: string, callback: (body: string) => string }[] = [
        /**
         * @description Получаем функцию с данными
         */
        {
            name: "extractDecipherFunction",
            callback: (body) => {
                try {
                    const helperMatch = body.match(new RegExp(HELPER_REGEXP, "s"));
                    if (!helperMatch) return null;

                    const helperObject = helperMatch[0];
                    const actionBody = helperMatch[2];

                    const reverseKey = mRegex(REVERSE_PATTERN, actionBody);
                    const sliceKey = mRegex(SLICE_PATTERN, actionBody);
                    const spliceKey = mRegex(SPLICE_PATTERN, actionBody);
                    const swapKey = mRegex(SWAP_PATTERN, actionBody);

                    const quotedFunctions = [reverseKey, sliceKey, spliceKey, swapKey].filter(Boolean)
                        .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

                    // Если нет ожидаемых функций
                    if (quotedFunctions.length === 0) return null;

                    const funcMatch = body.match(new RegExp(DECIPHER_REGEXP, "s"));
                    let tceVars = "";
                    let decipherFunc: string

                    // Если найдена функция
                    if (funcMatch) decipherFunc = funcMatch[0];
                    else {
                        const tceFuncMatch = body.match(new RegExp(FUNCTION_TCE_REGEXP, "s"));

                        // Если не найдена вспомогательная функция
                        if (!tceFuncMatch) return null;

                        decipherFunc = tceFuncMatch[0];
                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));

                        // Если удалось найти вспомогательные параметры
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    const resultFunc = tceVars + helperObject + "\nvar " + DECIPHER_FUNC_NAME + "=" + decipherFunc + ";\n";
                    const callerFunc = DECIPHER_FUNC_NAME + "(" + DECIPHER_ARGUMENT + ");";

                    return resultFunc + callerFunc;
                } catch (e) {
                    console.error("Error in extractDecipherFunction:", e);
                    return null;
                }
            }
        },

        /**
         * @description Получаем данные n кода - для ускоренной загрузки с серверов
         */
        {
            name: "extractNTransformFunction",
            callback: (body) => {
                try {
                    const nMatch = body.match(new RegExp(N_TRANSFORM_REGEXP, "s"));
                    let tceVars = "";
                    let nFunction: string;

                    // Если найдена функция
                    if (nMatch) nFunction = nMatch[0];
                    else {
                        const nTceMatch = body.match(new RegExp(N_TRANSFORM_TCE_REGEXP, "s"));

                        // Если нет вспомогательные функций вычисления
                        if (!nTceMatch) return null;

                        nFunction = nTceMatch[0];

                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));

                        // Если вспомогательные параметры найдены
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);

                    // Если не найдено параметров
                    if (!paramMatch) return null;

                    const resultFunc = tceVars + "var " + N_TRANSFORM_FUNC_NAME + "=" + nFunction.replace(
                        new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramMatch[1]}\\s*;?`, "g"),
                        ""
                    ) + ";\n";
                    const callerFunc = N_TRANSFORM_FUNC_NAME + "(" + N_ARGUMENT + ");";

                    return resultFunc + callerFunc;
                } catch (e) {
                    console.error("Error in extractNTransformFunction:", e);
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
        const extractDecipher = (url: string): string => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url as string;

            try {
                const components = new URL(decodeURIComponent(args.url as string));
                const context = {};
                context[DECIPHER_ARGUMENT] = decodeURIComponent(args.s as string);
                const decipheredSig = decipher.runInNewContext(context);

                components.searchParams.set((args.sp || "sig") as string, decipheredSig);
                return components.toString();
            } catch (err) {
                console.error("Error applying decipher:", err);
                return args.url as string;
            }
        };
        const extractNTransform = (url: string): string => {
            try {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get("n");

                if (!n || !nTransform) return url;

                const context = {};
                context[N_ARGUMENT] = n;
                const transformedN = nTransform.runInNewContext(context);

                if (transformedN) {

                    if (n === transformedN) {
                        console.warn("Transformed n parameter is the same as input, n function possibly short-circuited");
                    } else if (transformedN.startsWith("enhanced_except_") || transformedN.endsWith("_w8_" + n)) {
                        console.warn("N function did not complete due to exception");
                    }

                    components.searchParams.set("n", transformedN);
                } else {
                    console.warn("Transformed n parameter is null, n function possibly faulty");
                }

                return components.toString();
            } catch (err) {
                console.error("Error applying n transform:", err);
                return url;
            }
        };

        const cipher = !format.url;
        const url = format.url || format.signatureCipher || format.cipher;

        if (!url) return;

        try {
            format.url = extractNTransform(cipher ? extractDecipher(url) : url);

            delete format.signatureCipher;
            delete format.cipher;
        } catch (err) {
            console.error("Error set download URL:", err);
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param html5 - Ссылка на плеер
     * @private
     */
    private static extractPage = async (html5: string) => {
        const body = await new httpsClient(html5).toString;

        if (body instanceof Error) return null;
        return [
            this.extractDecipher(body),
            this.extractNTransform(body)
        ];
    };

    /**
     * @description Извлекает функции расшифровки N типа
     * @param body - Страница плеера
     * @private
     */
    private static extractNTransform = (body: string) => {
        try {
            const nTransformFunc = this.extraction(this.extractors[1].callback, body);

            if (!nTransformFunc) return null;
            return nTransformFunc;
        } catch {
            return null;
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param body - Страница плеера
     * @private
     */
    private static extractDecipher = (body: string) => {
        const decipherFunc = this.extraction(this.extractors[0].callback, body);
        if (!decipherFunc) return null;
        return decipherFunc;
    };

    /**
     * @description Получаем функции для расшифровки
     * @param callback - Функция расшифровки
     * @param body - Станица youtube
     * @param postProcess - Если есть возможность обработать сторонний код
     * @private
     */
    private static extraction = (callback: Function, body: string, postProcess = null) => {
        try {
            // Если есть функция
            const func = callback(body);

            // Если нет функции
            if (!func) return null;

            // Выполняем виртуальный код
            return new Script(postProcess ? postProcess(func) : func);
        } catch {
            return null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Общий стандарт аудио или видео json объекта
 * @interface YouTubeFormat
 */
export interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
    acodec?: string;
}

/**
 * @author SNIPPIK
 * @description Варианты расшифровки url
 * @interface YouTubeChanter
 */
export interface YouTubeChanter {
    decipher?: Script;
    nTransform?: Script;
}

const DECIPHER_FUNC_NAME = "getDecipherFunc";
const N_TRANSFORM_FUNC_NAME = "getNTransformFunc";

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

const DECIPHER_REGEXP =
    "function(?: " + VARIABLE_PART + ")?\\(([a-zA-Z])\\)\\{" +
    "\\1=\\1\\.split\\(\"\"\\);\\s*" +
    "((?:(?:\\1=)?" + VARIABLE_PART + VARIABLE_PART_ACCESS + "\\(\\1,\\d+\\);)+)" +
    "return \\1\\.join\\(\"\"\\)" +
    "\\}";

const HELPER_REGEXP =
    "var (" + VARIABLE_PART + ")=\\{((?:(?:" +
    VARIABLE_PART_DEFINE + REVERSE_PART + "|" +
    VARIABLE_PART_DEFINE + SLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SPLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SWAP_PART +
    "),?\\n?)+)\\};";

const FUNCTION_TCE_REGEXP =
    "function(?:\\s+[a-zA-Z_\\$][a-zA-Z0-9_\\$]*)?\\(\\w\\)\\{" +
    "\\w=\\w\\.split\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\);" +
    "\\s*((?:(?:\\w=)?[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\[\\\"|\\.)[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\\"\\]|)\\(\\w,\\d+\\);)+)" +
    "return \\w\\.join\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\)}";

const N_TRANSFORM_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
    "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
    "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};';

const N_TRANSFORM_TCE_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*var\\s*(\\w+)=\\1\\.split\\(\\1\\.slice\\(0,0\\)\\),\\s*(\\w+)=\\[.*?];" +
    ".*?catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z_0-9$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
    "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};";

const TCE_GLOBAL_VARS_REGEXP =
    "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
    "(?:" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
    "\\s*\\.\\s*split\\((" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
    "\\))" +
    "|" +
    "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
    "))(?=\\s*[,;])";

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";
