import type { CommandInteraction, SelectMenuInteract } from "#structures/discord/index.js";
import type { ButtonInteraction } from "discord.js";
import { handler } from "#handler";

/**
 * @author SNIPPIK
 * @description Все доступные ограничения
 * @type RegisteredMiddlewares
 * @public
 */
export type RegisteredMiddlewares = "voice" | "client_voice" | "queue" | "another_voice" | "player-not-playing" | "player-wait-stream" | "cooldown";

/**
 * @author SNIPPIK
 * @description Все доступные middlewares, присутствующие в системе динамической загрузки
 * @class Middlewares
 * @extends handler
 * @public
 */
export class Middlewares<T = middleware<CommandInteraction | ButtonInteraction | SelectMenuInteract>> extends handler<T> {
    /**
     * @description Производим поиск по функции
     * @returns T[]
     * @public
     */
    public get array() {
        return this.files.values();
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @constructor
     * @public
     */
    public constructor() {
        super("src/handlers/middlewares");
    };

    /**
     * @description Регистрируем в эко системе бота
     * @returns () => void
     * @public
     */
    public register = () => this.load();

    /**
     * @description Производим фильтрацию по функции
     * @param predicate - Функция поиска
     * @returns T[]
     * @public
     */
    public filter(predicate: (item: T) => boolean) {
        return this.files.filter(predicate);
    };
}

/**
 * @author SNIPPIK
 * @description Стандартный middleware, без наворотов!
 * @interface middleware
 * @public
 */
export interface middleware<T> {
    /** Имя middleware */
    name: RegisteredMiddlewares;

    /** Функция вызова middleware */
    callback: (message: T) => MiddlewareResult;
}

/**
 * @author SNIPPIK
 * @description Коды состояния ответа
 * @enum MiddlewareResult
 * @public
 */
export enum MiddlewareResult {
    /** Если все сходится и можно продолжить проверять */
    "ok",

    /** Если не сходится */
    "fail"
}