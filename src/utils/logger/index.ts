/**
 * @author SNIPPIK
 * @description База данных
 */
const db = {
    /**
     * @description Цвета текста
     * @protected
     */
    colors: {
        "DEBUG": "\x1b[90m",
        "WARN": "\x1b[33m",
        "ERROR": "\x1b[31m",
        "LOG": ""
    },

    /**
     * @description Цвета фона
     * @protected
     */
    status: {
        "DEBUG": "\x1b[34mi\x1b[0m",
        "WARN": "\x1b[33mi\x1b[0m",
        "ERROR": "\x1b[31mi\x1b[0m",
        "LOG": "\x1b[32mi\x1b[0m"
    }
};

/**
 * @author SNIPPIK
 * @description Простенький logger, не надо использовать new, все функции в нем статичны
 * @class Logger
 * @public
 */
export class Logger {
    /**
     * @description Если включен режим отладки
     * @private
     */
    public static debug = null;

    /**
     * @description Отправляем лог в консоль
     * @public
     * @static
     */
    public static log = (status: keyof typeof db.status, text: string) => {
        // Игнорируем debug сообщения
        if (status === "DEBUG" && !this.debug) return;

        text = text.replace(/\[/, `\x1b[104m\x1b[30m|`).replace(/]/, "|\x1b[0m");

        const date = new Date();
        const extStatus = db.status[status];
        const time = `\x1b[90m${date.getDate().toSplit()}/${(date.getMonth() + 1).toSplit()}/${date.getFullYear()} ${date.getHours().toSplit()}:${date.getMinutes().toSplit()}\x1b[0m`;

        // Получаем память в мегабайтах с двумя знаками после запятой
        const mem = process.memoryUsage();
        const memUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(2);

        // Отправляем лог
        console.log(`\x1b[35m[RAM: ${memUsedMB} MB]\x1b[0m ${time} |\x1b[0m ${extStatus} `  + `${db.colors[status]} - ${text}`);
        return;
    };

    /**
     * @description Добавляем цвет к тексту
     * @param color - Цвет текста, в number console
     * @param text - Текст
     */
    public static color = (color: number, text: string) => {
        return `\x1b[${color}m${text}\x1b[0m`
    };
}