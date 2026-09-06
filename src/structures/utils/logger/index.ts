import { Logger as SLogger } from "seyfert";
import * as process from "node:process";
import { inspect } from "node:util";


type LoggerKeys = "DEBUG" | "WARN" | "ERROR" | "LOG";

/**
 * @author SNIPPIK
 * @description Простенький logger, не надо использовать new, все функции в нем статичны
 * @class Logger
 * @public
 */
export class Logger {
    private static _logger = new SLogger({
        name: ""
    });

    /**
     * @description Если включен режим отладки
     * @public
     * @static
     */
    public static debug = process.env["NODE_ENV"] === "development";

    /**
     * @description Отправляем лог в консоль
     * @returns void
     * @public
     * @static
     */
    public static log = (status: LoggerKeys, text: string | Error): void => {
        queueMicrotask(() => {
            // Если вместо текста пришла ошибка
            if (text instanceof Error) {
                text = `\nCaught Exception\n` +
                    `┌ Name:    ${text.name}\n` +
                    `├ Message: ${text.message}\n` +
                    `└ Stack:   ${text.stack}`;
            }

            // Если объект
            else if (typeof text === "object") {
                text = inspect(text, {depth: 3, colors: false});
            }

            // Игнорируем debug сообщения
            if (status === "DEBUG" && !this.debug) return;

            switch (status) {
                case "LOG": return this._logger.info(text);
                case "WARN": return this._logger.warn(text);
                case "DEBUG": return this._logger.debug(text);
                case "ERROR": return this._logger.error(text);
            }
        });
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