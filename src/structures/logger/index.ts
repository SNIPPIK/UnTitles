import * as process from "node:process";
import { inspect } from "node:util";
import { env } from "#app/env";
import path from "node:path";
import fs from "node:fs";

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
        "DEBUG": "\x1b[34md\x1b[0m",
        "WARN": "\x1b[33mw\x1b[0m",
        "ERROR": "\x1b[31me\x1b[0m",
        "LOG": "\x1b[32mi\x1b[0m"
    }
};

/**
 * @author SNIPPIK
 * @description Функция создания локального времени
 * @private
 */
const createDate = (ms: boolean = false) => {
    const local_date = new Date();
    return `${local_date.getDate().toZero()}.${(local_date.getMonth() + 1).toZero()}.${local_date.getFullYear()} ${local_date.getHours().toZero()}:${local_date.getMinutes().toZero()}` + (ms ? `.${local_date.getMilliseconds().toZero(4)}` : "");
}

/**
 * @description Время запуска процесса
 * @private
 */
const _timestamp = createDate(true);

/**
 * @author SNIPPIK
 * @description Простенький logger, не надо использовать new, все функции в нем статичны
 * @class Logger
 * @public
 */
export class Logger {
    /**
     * @description Если включен режим отладки
     * @public
     * @static
     */
    public static debug = env.get("NODE_ENV") === "development";

    /**
     * @description Путь для сохранения логов
     * @private
     * @static
     */
    private static _path = path.resolve(env.get("cache.dir"), "logs");

    /**
     * @description Можно ли создавать файлы логов
     * @private
     * @static
     */
    private static _createFiles = this.debug ? env.get("cache.file") : null;

    /**
     * @description Отправляем лог в консоль
     * @returns void
     * @public
     * @static
     */
    public static log = (status: keyof typeof db.status, text: string | Error): void => {
        const extStatus = db.status[status];

        // Получаем память в мегабайтах с двумя знаками после запятой
        const mem = process.memoryUsage();
        const memUsedMB = ((mem.heapUsed + mem.external + mem.arrayBuffers) / 1024 / 1024).toFixed(2);
        const time = createDate(true);

        // Если пришел текст
        if (typeof text === "string") {
            // Сохраняем логи
            this.saveLog(`[RAM ${memUsedMB} MB] ${time} | ${status} - ${text}`);
            text = `${text}`.replace(/\[/, `\x1b[104m\x1b[30m|`).replace(/]/, "|\x1b[0m");
        }

        // Если вместо текста пришла ошибка
        else if (text instanceof Error) {
            text = `Uncaught Exception\n` +
                `┌ Name:    ${text.name}\n` +
                `├ Message: ${text.message}\n` +
                `└ Stack:   ${text.stack}`;

            // Сохраняем логи
            this.saveLog(`[RAM ${memUsedMB} MB] ${time} | ${status} - ${text}`);
        }

        // Если объект
        else if (typeof text === "object") {
            text = inspect(text, { depth: 3, colors: false });
        }

        // Игнорируем debug сообщения
        if (status === "DEBUG" && !this.debug) return;

        // Отправляем лог
        process.stdout.write(`\x1b[35m[RAM ${memUsedMB} MB]\x1b[0m \x1b[90m${time}\x1b[0m |\x1b[0m ${extStatus} `  + `${db.colors[status]} - ${text}\n`);
    };

    /**
     * @description Сохранение лога в файл для анализа
     * @param text
     * @private
     * @static
     */
    private static saveLog = (text: string) => {
        try {
            if (!this._createFiles) return;

            // Если нет пути сохранения
            else if (!fs.existsSync(this._path)) fs.mkdirSync(this._path);

            // Сохраняем данные в файл
            fs.appendFileSync(`${this._path}/${_timestamp}.txt`, text + "\n", "utf8");
        } catch {
            return;
        }
    };

    /**
     * @description Добавляем цвет к тексту
     * @param color - Цвет текста, в number console
     * @param text - Текст
     * @returns string
     * @public
     * @static
     */
    public static color = (color: number, text: string): string => {
        return `\x1b[${color}m${text}\x1b[0m`
    };
}