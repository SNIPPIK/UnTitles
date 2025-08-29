import { RegisteredMiddlewares } from "#handler/middlewares";
import { buttonInteraction } from "#structures/discord";
import { AnySelectMenuInteraction } from "discord.js";
import { handler } from "#handler";

/**
 * @author SNIPPIK
 * @description Загружаем динамические компоненты для работы с ними
 * @support Buttons
 * @class Components
 * @extends handler
 * @public
 */
export class Components extends handler<SupportComponent> {
    public constructor() {
        super("src/handlers/components");
    };

    /**
     * @description Регистрируем кнопки в эко системе бота
     * @public
     */
    public register = () => {
        this.load();
    };

    /**
     * @description Выдача кнопки из всей базы
     * @param name - Название кнопки
     */
    public get = (name: string) => {
        return this.files.find((button) => button.name === name);
    };
}

/**
 * @author SNIPPIK
 * @description Доступные кнопки
 * @type SupportButtons
 */
export type SupportButtons = "resume_pause" | "shuffle" | "replay" | "repeat" | "lyrics" | "queue" | "skip" | "stop" | "back" | "filters";

/**
 * @author SNIPPIK
 * @description Доступные селекторы меню
 * @type SupportSelector
 */
export type SupportSelector = "filter_select";

/**
 * @author SNIPPIK
 * @description
 */
export type SupportComponent<T = "button" | "selector"> = {
    /**
     * @description Название кнопки
     */
    name?: T extends "button" ? SupportButtons : SupportSelector;

    /**
     * @description Функция выполнения кнопки
     * @param msg - Сообщение пользователя
     */
    callback?: (ctx: T extends "button" ? buttonInteraction : AnySelectMenuInteraction) => any;

    /**
     * @description Права для использования той или иной команды
     * @default null
     * @readonly
     * @public
     */
    readonly middlewares?: RegisteredMiddlewares[];
}

/**
 * @author SNIPPIK
 * @description Класс для создания компонентов
 */
export class Component<T = "button" | "selector"> implements SupportComponent<T> {
    public callback: SupportComponent<T>["callback"];
}

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок команды
 * @decorator
 */
export function DeclareComponent(options: {name: SupportSelector | SupportButtons}) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
        }
}