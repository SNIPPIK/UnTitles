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
export class Components extends handler<Button | Selector> {
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
 * @description Интерфейс кнопки для общего понимания
 * @interface Button
 */
export interface Button {
    /**
     * @description Название кнопки
     */
    name: SupportButtons;

    /**
     * @description Функция выполнения кнопки
     * @param msg - Сообщение пользователя
     */
    callback: (ctx: buttonInteraction) => void;
}

/**
 * @author SNIPPIK
 * @description Интерфейс кнопки для общего понимания
 * @interface Button
 */
export interface Selector {
    /**
     * @description Название кнопки
     */
    name: SupportSelector;

    /**
     * @description Функция выполнения кнопки
     * @param msg - Сообщение пользователя
     */
    callback: (ctx: AnySelectMenuInteraction) => void;
}