import { CommandInteraction } from "#structures";
import { Command } from "#handler/commands";
import { handler } from "#handler";

/**
 * @author SNIPPIK
 * @description Все доступные middlewares, присутствующие в системе динамической загрузки
 * @class Middlewares
 * @extends handler
 * @public
 */
export class Middlewares<T = middleware<CommandInteraction>> extends handler<T> {
    /**
     * @description Загружаем класс вместе с дочерним
     */
    public constructor() {
        super("src/handlers/middlewares");
    };

    /**
     * @description Регистрируем в эко системе бота
     * @public
     */
    public register = () => {
        this.load();
    };

    /**
     * @description Производим фильтрацию по функции
     * @param predicate - Функция поиска
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
    name: Command["middlewares"][number],
    callback: (message: T) => Promise<boolean>;
}