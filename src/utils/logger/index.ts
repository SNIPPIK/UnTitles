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

        text = text.replace(/\[/, "\x1b[102m \x1b[30m").replace(/]/, " \x1b[0m");

        const date = new Date();
        const ms = `${date.getMilliseconds()}`
        const extStatus = db.status[status];
        const time = `\x1b[90m${date.getDate().toSplit()}/${(date.getMonth() + 1).toSplit()}/${date.getFullYear()} ${date.getHours().toSplit()}:${date.getMinutes().toSplit()}.${ms.slice(0, 2)}\x1b[0m`;

        // Отправляем лог
        console.log(`${time} |\x1b[0m ${extStatus} `  + `${db.colors[status]} - ${text}`);
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