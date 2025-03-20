import {handler} from "@handler";
import {Interact} from "@utils";

/**
 * @author SNIPPIK
 * @description Загружаем доступные кнопки
 * @class Buttons
 */
export class Buttons extends handler<Button> {
    /**
     * @description Кол-во загруженных кнопок
     * @public
     */
    public get size() {
        return this.files.length;
    };

    /**
     * @description Загружаем класс вместе с дочерним
     */
    public constructor() {
        super("src/handlers/modals/buttons");
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
export type SupportButtons = "resume_pause" | "shuffle" | "replay" | "repeat" | "lyrics" | "queue" | "skip" | "stop" | "back" | "filters" | MenuButtons;

/**
 * @author SNIPPIK
 * @description Имена кнопок в меню взаимодействия
 * @type MenuButtons
 */
export type MenuButtons = "menu_back" | "menu_select" | "menu_cancel" | "menu_next";

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
    callback: (msg: Interact) => void;
}