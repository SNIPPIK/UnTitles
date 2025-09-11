import { isMainThread, parentPort } from "node:worker_threads";
import { httpsClient } from "#structures";
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
 * @description Поиск вспомогательных данных
 * @param body - Страница
 */
const extractTceFunc = (body: string) => {
    try {
        const matcher = body.match(GLOBAL_VARS_PATTERN);
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
    private static extractors: { name: string, callback: (body: string, name: string, code: number) => string }[] = [
        /**
         * @description Получаем функцию с данными
         */
        {
            name: "extractDecipherFunction",
            callback: (body, _, code) => {
                try {
                    const callerFunc = `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;

                    // --- Попытка взять TCE-вариант (новая схема YouTube) ---
                    const sigFunc = body.match(TCE_SIG_FUNCTION_PATTERN);
                    const sigActions = body.match(SIG_ACTIONS_PATTERN);

                    if (sigFunc && sigActions && code) return `var ${DECIPHER_FUNC_NAME}=${sigFunc[0]}${sigActions[0]}${code};\n${callerFunc}`;
                    return null;
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
                    const caller = `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`; // Метод выполнения функции

                    // Попытка найти прямую NTransform функцию
                    const NTransformTce = body.match(N_TRANSFORM_PATTERN);

                    // Если все данные есть для выполнения такого метода
                    if (NTransformTce && name && code) {
                        const NTransform = NTransformTce[0], NTransformName = name.replace("$", "\\$");
                        const shortCircuit = new RegExp(`;\\s*if\\s*\\(\\s*typeof\\s+[\\w$]+\\s*===?\\s*(?:\"undefined\"|'undefined'|${NTransformName}\\[\\d+])\\s*\\)\\s*return\\s+\\w+;`);
                        return `var ${N_TRANSFORM_FUNC_NAME}=${NTransform.replace(shortCircuit, ";")}${code};\n${caller}`;
                    }

                    return null;
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
        const [ decipher, nTransform ] = [
            // Decipher
            this.extraction(this.extractors[0].callback, body, name, code),

            // nTransform
            this.extraction(this.extractors[1].callback, body, name, code)
        ];

        for (let item of formats) this.parseFormat(item, {decipher, nTransform});
        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     * @private
     */
    private static parseFormat = (format: YouTubeFormat, {decipher, nTransform}: YouTubeChanter): void => {
        if (!format) return;

        const rawUrl = format.url || format.signatureCipher || format.cipher;
        if (!rawUrl) return;

        // Парсим аргументы из URL или signatureCipher
        const args: Record<string, string> = {};
        for (const part of rawUrl.split("&")) {
            const [k, v] = part.split("=");
            if (k && v && ["s", "sp", "url", "n"].includes(k)) args[k] = decodeURIComponent(v);
        }

        // Применяем decipher к s
        const applyDecipher = (): string => {
            if (!decipher || !args.s || !args.url) return args.url || rawUrl;

            try {
                const context = { [DECIPHER_ARGUMENT]: args.s };
                const deciphered = decipher.runInNewContext(context);

                const urlObj = new URL(args.url);
                urlObj.searchParams.set(args.sp || DECIPHER_ARGUMENT, deciphered);

                return urlObj.toString();
            } catch {
                return args.url;
            }
        };

        // Применяем nTransform к n
        const applyNTransform = (url: string): string => {
            if (!nTransform) return url;

            try {
                const urlObj = new URL(url);
                const nParam = urlObj.searchParams.get("n");
                if (!nParam) return url;

                const context = { [N_ARGUMENT]: nParam };
                const transformed = nTransform.runInNewContext(context);

                if (transformed) urlObj.searchParams.set("n", transformed);
                return urlObj.toString();
            } catch {
                return url;
            }
        };

        try {
            const decipheredUrl = rawUrl === format.url ? rawUrl : applyDecipher();
            format.url = applyNTransform(decipheredUrl);

            delete format.signatureCipher;
            delete format.cipher;
        } catch (err) {
            console.error("Error in getting_url:", err);
        }
    };

    /**
     * @description Получаем функции для расшифровки
     * @param extractFunction - Функция расшифровки
     * @param body - Станица youtube
     * @param name - Имя функции
     * @param code - Данные функции
     * @private
     */
    private static extraction = (extractFunction: Function, body: string, name: string, code: string) => {
        // Если есть функция
        const func = extractFunction(body, name, code);

        // Выполняем виртуальный код
        return func ? new Script(func) : null;
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
const VARIABLE_PART_OBJECT_DECLARATION = "[\"']?[a-zA-Z_\\$][a-zA-Z_0-9\\$]*[\"']?"

/**
 * @description RegExp для поиска параметров
 */
const GLOBAL_VARS_PATTERN = new RegExp(
    "('use\\s*strict';)?(?<code>var\\s*" +
    "(?<varname>[a-zA-Z0-9_$]+)\\s*=\\s*(?<value>" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')\\.split\\(" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')\\)|\\[" +
    "(?:(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\s*,?\\s*)*\\]|\"[^\"]*\"\\.split\\(\"[^\"]*\"\\)))", "m"
);

/**
 * @description RegExp для поиска более короткого варианта SIG_FUNCTION_PATTERN а именно функции
 */
const SIG_ACTIONS_PATTERN = new RegExp(
    "var\\s+([$A-Za-z0-9_]+)\\s*=\\s*\\{" +
    "\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*," +
    "\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*," +
    "\\s*" + VARIABLE_PART_OBJECT_DECLARATION + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*};", "s"
);
/**
 * @description RegExp для поиска более короткого варианта SIG_FUNCTION_PATTERN а именно фрагмента sig
 */
const TCE_SIG_FUNCTION_PATTERN = new RegExp(
    "function\\(\\s*([a-zA-Z0-9$])\\s*\\)\\s*\\{\\s*\\1\\s*=\\s*\\1\\[(\\w+)\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\);" +
    "([a-zA-Z0-9$]+)\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    "\\s*\\3\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    ".*?return\\s*\\1\\[\\2\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\)\\};", "s"
);

/**
 * @description RegExp для поиска функции получения истинного n code
 */
const N_TRANSFORM_PATTERN = new RegExp(
    "function\\s*\\((\\w+)\\)\\s*\\" +
    "{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?" +
    "catch\\s*\\(\\s*(\\w+)\\s*\\)\\s*\\" +
    "{return\\s*\\w+\\[\\d+\\]\\s*\\+\\s*\\1\\}\\s*" +
    "return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\s*\\;", "gs"
);