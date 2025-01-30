/**
 * @author SNIPPIK
 * @description База данных
 */
const db = {
    /**
     * @description Цвета текста
     */
    colors: {
        "DEBUG": "\x1b[90m",
        "WARN": "\x1b[33m",
        "ERROR": "\x1b[31m",
        "LOG": ""
    },

    /**
     * @description Цвета фона
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
     * @description Отправляем лог в консоль
     */
    public static log = (status: keyof typeof db.status, text: string) => {
        // Игнорируем debug сообщения
        if (status === "DEBUG") return;

        text = text.replace(/\[/g, "\x1b[100m \x1b[30m").replace(/]/g, " \x1b[0m");

        const extStatus = db.status[status];
        const time = `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`;

        // Отправляем лог
        console.log(`\x1b[35m${process.pid}\x1b[0m [${time}] |\x1b[0m ${extStatus} `  + `${db.colors[status]} - ${text}`);
        return;
    };
}