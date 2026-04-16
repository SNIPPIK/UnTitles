import { buttonInteraction, SelectMenuInteract } from "#structures/discord";
import { RegisteredMiddlewares } from "#handler/middlewares";
import { handler } from "#handler";

// Export decorator
export * from "./index.decorator";

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
     * @returns void
     * @public
     */
    public register = () => {
        this.load();
    };

    /**
     * @description Выдача кнопки из всей базы
     * @param name - Название кнопки
     * @public
     */
    public get = (name: string) => {
        return this.files.find((button) => button.name === name);
    };
}

/**
 * @author SNIPPIK
 * @description Доступные кнопки
 * @type SupportButtons
 * @public
 */
export type SupportButtons = "resume_pause" | "shuffle" | "repeat" | "lyrics" | "queue" | "skip" | "stop" | "back" | "filters";

/**
 * @author SNIPPIK
 * @description Доступные селекторы меню
 * @type SupportSelector
 * @public
 */
export type SupportSelector = "filter_select";

/**
 * @author SNIPPIK
 * @description Тип поддержки компонента
 * @public
 */
export type SupportComponent<T = "button" | "selector"> = {
    /**
     * @description Название кнопки
     * @public
     */
    name?: T extends "button" ? SupportButtons : SupportSelector;

    /**
     * @description Функция выполнения кнопки
     * @param msg - Сообщение пользователя
     * @public
     */
    callback?: (ctx: T extends "button" ? buttonInteraction : SelectMenuInteract) => any;

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
 * @class Component
 * @implements SupportComponent
 * @public
 */
export class Component<T = "button" | "selector"> implements SupportComponent<T> {
    public callback: SupportComponent<T>["callback"];
}