export * from "./prototypes.js";

export * from "./logger/index.js";
export * from "./locale/index.js";
export * from "./tools/TypedEmitter.js";
export * from "./array/index.js";
export * from "./tools/Assign.js";
export * from "./tools/httpsClient.js";
export * from "./tools/SimpleWorker.js";
export * from "./tools/CycleManager.js";


/**
 * @description Функция для создания прокси данных для FFmpeg
 * @param proxy
 */
export function createProxyFFmpeg(proxy: string) {
    const isSocks = proxy.startsWith("socks");

    // Если протокол socks
    if (isSocks) {
        const path = proxy.split(":/")[1];

        // Если нашлись данные для входа
        if (path.match(/@/)) {
            return `http:/${proxy.split(":/")[1].split("@")[1]}`;
        }

        // Если данных для входа нет
        else return `http:/${proxy.split(":/")[1]}`;
    }

    // Если протокол http
    else return `http:/${proxy.split(":/")[1]}`;
}