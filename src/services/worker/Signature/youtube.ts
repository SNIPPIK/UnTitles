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
const mRegex = (pattern: string | RegExp, text: string) => {
    const match = text.match(pattern);
    return match ? match[1].replace(/\$/g, "\\$") : null;
};

const extractTCEVariable = (body) => {
    const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));
    if (tceVarsMatch) {
        return new TCEVariable(
            tceVarsMatch[2],
            tceVarsMatch[1],
            tceVarsMatch[1].split("=")[1].trim()
        );
    }

    const tceVarsMatchJava = body.match(new RegExp(TCE_GLOBAL_VARS_PATTERN_JAVA));
    if (tceVarsMatchJava && tceVarsMatchJava.groups) {
        return new TCEVariable(
            tceVarsMatchJava.groups.varname,
            tceVarsMatchJava.groups.code,
            tceVarsMatchJava.groups.value
        );
    }

    return null;
};
const extractSigFunctionTCE = (body, tceVariable) => {
    if (!tceVariable) return null;

    try {
        const sigFunctionMatch = body.match(new RegExp(SIG_FUNCTION_TCE_PATTERN));
        if (!sigFunctionMatch) return null;
        const sigFunctionActionsMatch = body.match(new RegExp(TCE_SIG_FUNCTION_ACTIONS_PATTERN));
        if (!sigFunctionActionsMatch) return null;

        return {
            sigFunction: sigFunctionMatch[0],
            sigFunctionActions: sigFunctionActionsMatch[0],
            actionVarName: sigFunctionActionsMatch[1] || "Dw"
        };
    } catch (e) {
        return null;
    }
};
const extractNFunctionTCE = (body, tceVariable) => {
    if (!tceVariable) return null;

    try {
        const nFunctionMatch = body.match(new RegExp(N_FUNCTION_TCE_PATTERN, "s"));
        if (!nFunctionMatch) {
            const nTceMatch = body.match(new RegExp(N_TRANSFORM_TCE_REGEXP, "s"));
            if (!nTceMatch) return null;
            return nTceMatch[0];
        }

        let nFunction = nFunctionMatch[0];
        const shortCircuitPattern = new RegExp(
            `;\\s*if\\s*\\(\\s*typeof\\s+[a-zA-Z0-9_$]+\\s*===?\\s*(?:"undefined"|'undefined'|${tceVariable.getEscapedName()}\\[\\d+\\])\\s*\\)\\s*return\\s+\\w+;`
        );

        if (shortCircuitPattern.test(nFunction)) {
            nFunction = nFunction.replace(shortCircuitPattern, ";");
        } else {
            const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);
            if (paramMatch) {
                const paramName = paramMatch[1];
                nFunction = nFunction.replace(
                    new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramName}\\s*;?`, "g"),
                    ""
                );
            }
        }

        return nFunction;
    } catch (e) {
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
    private static extractors: { name: string, callback: (body: string) => any }[] = [
        /**
         * @description Получаем функцию с данными
         */
        {
            name: "extractDecipherFunction",
            callback: (body) => {
                try {
                    const tceVariable = extractTCEVariable(body);
                    if (tceVariable) {

                        const tceSigResult = extractSigFunctionTCE(body, tceVariable);
                        const nFunction = extractNFunctionTCE(body, tceVariable);

                        if (tceSigResult && nFunction) {
                            const { sigFunction, sigFunctionActions } = tceSigResult;
                            return {
                                script: `${tceVariable.getCode()}\n${sigFunctionActions}\nvar ${DECIPHER_FUNC_NAME}=${sigFunction};\nvar ${N_TRANSFORM_FUNC_NAME}=${nFunction};\n`,
                                decipher: `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`,
                                nTransform: `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`,
                                isTCE: true
                            };
                        } else {
                        }
                    }

                    const helperMatch = body.match(new RegExp(HELPER_REGEXP, "s"));
                    if (!helperMatch) {
                        return null;
                    }

                    const helperObject = helperMatch[0];
                    const actionBody = helperMatch[2];
                    const reverseKey = mRegex(REVERSE_PATTERN, actionBody);
                    const sliceKey = mRegex(SLICE_PATTERN, actionBody);
                    const spliceKey = mRegex(SPLICE_PATTERN, actionBody);
                    const swapKey = mRegex(SWAP_PATTERN, actionBody);

                    const quotedFunctions = [reverseKey, sliceKey, spliceKey, swapKey]
                        .filter(Boolean)
                        .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

                    if (quotedFunctions.length === 0) {
                        return null;
                    }

                    let funcMatch = body.match(new RegExp(DECIPHER_REGEXP, "s"));
                    let isTce = false;
                    let decipherFunc;

                    if (funcMatch) {
                        decipherFunc = funcMatch[0];
                    } else {
                        const tceFuncMatch = body.match(new RegExp(FUNCTION_TCE_REGEXP, "s"));
                        if (!tceFuncMatch) {
                            return null;
                        }

                        decipherFunc = tceFuncMatch[0];
                        isTce = true;
                    }

                    let tceVars = "";
                    if (isTce) {
                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));
                        if (tceVarsMatch) {
                            tceVars = tceVarsMatch[1] + ";\n";
                        }
                    }
                    const result = {
                        script: tceVars + helperObject + "\nvar " + DECIPHER_FUNC_NAME + "=" + decipherFunc + ";\n",
                        decipher: DECIPHER_FUNC_NAME + "(" + DECIPHER_ARGUMENT + ");",
                        isTCE: false
                    };

                    return result;
                } catch (e) {
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
                    const tceVariable = extractTCEVariable(body);
                    if (tceVariable) {
                        const nFunction = extractNFunctionTCE(body, tceVariable);
                        if (nFunction) {
                            return {
                                already: true
                            };
                        }
                    }

                    let nMatch = body.match(new RegExp(N_TRANSFORM_REGEXP, "s"));
                    let isTce = false;
                    let nFunction;

                    if (nMatch) {
                        nFunction = nMatch[0];
                    } else {
                        const nTceMatch = body.match(new RegExp(N_TRANSFORM_TCE_REGEXP, "s"));
                        if (!nTceMatch) {
                            return null;
                        }

                        nFunction = nTceMatch[0];
                        isTce = true;
                    }

                    const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);
                    if (!paramMatch) {
                        return null;
                    }

                    const paramName = paramMatch[1];
                    const cleanedFunction = nFunction.replace(
                        new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramName}\\s*;?`, "g"),
                        ""
                    );

                    let tceVars = "";
                    if (isTce) {
                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));
                        if (tceVarsMatch) {
                            tceVars = tceVarsMatch[1] + ";\n";
                        }
                    }

                    const result = {
                        script: tceVars + "var " + N_TRANSFORM_FUNC_NAME + "=" + cleanedFunction + ";\n",
                        nTransform: N_TRANSFORM_FUNC_NAME + "(" + N_ARGUMENT + ");",
                        isTCE: false
                    };
                    return result;
                } catch (e) {
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

        const decipherF = url => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url;

            try {

                const components = new URL(decodeURIComponent(args.url as any));
                const context = {};
                context[DECIPHER_ARGUMENT] = decodeURIComponent(args.s as any);
                const decipheredSig = decipher.runInNewContext({
                    ...context,
                    console: console
                });

                components.searchParams.set((args.sp || "sig" as any), decipheredSig);
                return components.toString();
            } catch (err) {
                return args.url;
            }
        };

        const nTransformF = url => {
            try {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get("n");

                if (!n || !nTransform) return url;
                const context = {};
                context[N_ARGUMENT] = n;
                const transformedN = nTransform.runInNewContext({
                    ...context,
                    console: console
                });

                if (transformedN) {
                    if (n === transformedN) {
                    } else if (transformedN.startsWith("enhanced_except_") || transformedN.endsWith("_w8_" + n)) {
                    }

                    components.searchParams.set("n", transformedN);
                } else {
                }

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

        try {
            const decipherResult = this.extractDecipher(body);
            const nTransformResult = this.extractNTransform(body);
            if (decipherResult) {
                try {
                    const context = {};
                    context[DECIPHER_ARGUMENT] = "testValue";
                    decipherResult.runInNewContext(context);
                } catch (error) {
                }
            }

            if (nTransformResult) {
                try {
                    const context = {};
                    context[N_ARGUMENT] = "testValue";
                    nTransformResult.runInNewContext(context);
                } catch (error) {
                }
            }

            return [decipherResult, nTransformResult];
        } catch (error) {
            return [null, null];
        }
    };

    /**
     * @description Извлекает функции расшифровки N типа
     * @param body - Страница плеера
     * @private
     */
    private static extractNTransform = (body: string) => {
        try {
            const decipherFuncResult = this.extractors[0].callback(body);
            if (decipherFuncResult && decipherFuncResult.isTCE && decipherFuncResult.nTransform) {
                try {
                    const scriptText = decipherFuncResult.script + '\n' + decipherFuncResult.nTransform;
                    return new Script(scriptText);
                } catch (err) {
                }
            }

            const nTransformFuncResult = this.extractors[1].callback(body);
            if (nTransformFuncResult && nTransformFuncResult.already) {
                return null;
            }

            if (nTransformFuncResult) {
                try {
                    const scriptText = nTransformFuncResult.script + '\n' + nTransformFuncResult.nTransform;
                    return new Script(scriptText);
                } catch (err) {
                }
            }

            return null;
        } catch (error) {
            return null;
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param body - Страница плеера
     * @private
     */
    private static extractDecipher = (body: string) => {
        const decipherFunc = this.extractors[0].callback(body);
        if (!decipherFunc) return null;

        if (decipherFunc) {
            try {
                if (decipherFunc.isTCE) {
                    const scriptText = decipherFunc.script + '\n' + decipherFunc.decipher;
                    return new Script(scriptText);
                }
                const scriptText = decipherFunc.script + '\n' + decipherFunc.decipher;
                return new Script(scriptText);
            } catch (err) {
            }
        }

        return decipherFunc;
    };
}

class TCEVariable {
    public name: string;
    public code: number;
    public value: string;

    constructor(name, code, value) {
        this.name = name;
        this.code = code;
        this.value = value;
    }

    getEscapedName() {
        return this.name.replace(/\$/g, "\\$");
    }

    getName() {
        return this.name;
    }

    getCode() {
        return this.code;
    }

    getValue() {
        return this.value;
    }
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

const SIG_FUNCTION_TCE_PATTERN =
    "function\\(\\s*([a-zA-Z0-9$])\\s*\\)\\s*\\{" +
    "\\s*\\1\\s*=\\s*\\1\\[(\\w+)\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\);" +
    "([a-zA-Z0-9$]+)\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    "\\s*\\3\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    ".*?return\\s*\\1\\[\\2\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\)\\};";

const TCE_SIG_FUNCTION_ACTIONS_PATTERN =
    "var\\s*([a-zA-Z0-9$_]+)\\s*=\\s*\\{\\s*[a-zA-Z0-9$_]+\\s*:\\s*function\\((\\w+|\\s*\\w+\\s*,\\s*\\w+\\s*)\\)\\s*\\{\\s*(\\s*var\\s*\\w+=\\w+\\[\\d+\\];\\w+\\[\\d+\\]\\s*=\\s*\\w+\\[\\w+\\s*\\%\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\];\\s*\\w+\\[\\w+\\s*%\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\]\\s*=\\s*\\w+\\s*\\},|\\w+\\[\\w+\\[\\d+\\]\\]\\(\\)\\},)\\s*[a-zA-Z0-9$_]+\\s*:\\s*function\\((\\s*\\w+\\w*,\\s*\\w+\\s*|\\w+)\\)\\s*\\{(\\w+\\[\\w+\\[\\d+\\]\\]\\(\\)|\\s*var\\s*\\w+\\s*=\\s*\\w+\\[\\d+\\]\\s*;\\w+\\[\\d+\\]\\s*=\\w+\\[\\s*\\w+\\s*%\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\]\\s*;\\w+\\[\\s*\\w+\\s*%\\s*\\w\\[\\w+\\[\\d+\\]\\]\\]\\s*=\\s*\\w+\\s*)\\},\\s*[a-zA-Z0-9$_]+\\s*:\\s*function\\s*\\(\\s*\\w+\\s*,\\s*\\w+\\s*\\)\\{\\w+\\[\\w+\\[\\d+\\]\\]\\(\\s*\\d+\\s*,\\s*\\w+\\s*\\)\\}\\};";

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
    "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z0-9_$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
    "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};";

const N_FUNCTION_TCE_PATTERN =
    "function\\s*\\((\\w+)\\)\\s*\\{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?catch\\(\\s*(\\w+)\\s*\\s*\\)\\s*\\{return\\s*\\w+\\[\\d+\\](\\+\\1)?\\}\\s*return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\;";

const TCE_GLOBAL_VARS_REGEXP =
    "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
    "(?:" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
    "\\s*\\.\\s*split\\((" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
    "\\))" +
    "|" +
    "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
    "|" +
    "\"[^\"]*\"\\.split\\(\"[^\"]*\"\\)" +
    "))(?=\\s*[,;])";

const TCE_GLOBAL_VARS_PATTERN_JAVA =
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
    ")";

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";
