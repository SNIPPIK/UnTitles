import * as process from "node:process";
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
 * @description Время запуска процесса
 * @private
 */
const _timestamp = Date.now();

/**
 * @description Функция превращающая число в строку с добавлением 0
 * @param n - Число
 */
const splitter = (n: number) => (n < 10 ? "0" : "") + n;

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
     */
    private static _path = path.resolve(env.get("cache.dir"), "logs");

    /**
     * @description Можно ли создавать файлы логов
     * @private
     */
    private static _createFiles = env.get("cache.file");

    /**
     * @description Отправляем лог в консоль
     * @returns void
     * @public
     * @static
     */
    public static log = (status: keyof typeof db.status, text: string | Error): void => {
        const date = new Date();
        const extStatus = db.status[status];
        const time = `${splitter(date.getDate())}/${(splitter(date.getMonth() + 1))}/${splitter(date.getFullYear())} ${splitter(date.getHours())}:${splitter(date.getMinutes())}`;

        // Получаем память в мегабайтах с двумя знаками после запятой
        const mem = process.memoryUsage();
        const memUsedMB = (mem.heapTotal / 1024 / 1024).toFixed(2);

        // Если пришел текст
        if (typeof text === "string") {
            // Сохраняем логи
            this.saveLog(`[RAM ${memUsedMB} MB] ${time}.${date.getMilliseconds()} | ${status} - ${text}`);
            text = `${text}`.replace(/\[/, `\x1b[104m\x1b[30m|`).replace(/]/, "|\x1b[0m");
        }

        // Если вместо текста пришла ошибка
        else if (text instanceof Error) {
            text = `Uncaught Exception\n` +
                `┌ Name:    ${text.name}\n` +
                `├ Message: ${text.message}\n` +
                `├ Origin:  ${text}\n` +
                `└ Stack:   ${text.stack}`;

            // Сохраняем логи
            this.saveLog(`[RAM ${memUsedMB} MB] ${time}.${date.getMilliseconds()} | ${status} - ${text}`);
        }

        // Если объект
        else if (typeof text === "object") text = JSON.stringify(text);

        // Игнорируем debug сообщения
        if (status === "DEBUG" && !this.debug) return;

        // Отправляем лог
        process.stdout.write(`\x1b[35m[RAM ${memUsedMB} MB]\x1b[0m \x1b[90m${time}\x1b[0m |\x1b[0m ${extStatus} `  + `${db.colors[status]} - ${text}\n`);
    };

    /**
     * @description Сохранение лога в файл для анализа
     * @param text
     */
    private static saveLog = (text: string) => {
        if (!this._createFiles) return;

        // Если нет пути сохранения
        else if (!fs.existsSync(this._path)) fs.mkdirSync(this._path);

        // Сохраняем данные в файл
        fs.appendFileSync(`${this._path}/${_timestamp}.txt`, text + "\n", "utf8");
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