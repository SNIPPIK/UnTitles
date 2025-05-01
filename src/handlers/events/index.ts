import {AudioPlayerEvents, QueuesEvents} from "@service/player";
import {ClientEvents, Client} from "discord.js";
import {TypedEmitter} from "@utils";
import {handler} from "@handler";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с событиями
 * @class Events
 */
export class Events extends handler<Event<any>> {
    /**
     * @description События привязанные к плееру и очереди
     * @readonly
     * @private
     */
    public readonly emitter = new class extends TypedEmitter<QueuesEvents & AudioPlayerEvents> {};

    /**
     * @description Выдаем все загруженные события
     * @public
     */
    public get events() {
        return this.files;
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        super("src/handlers/events");
    };

    /**
     * @description Регистрируем ивенты в эко системе бота
     * @public
     */
    public register = (client: Client) => {
        this.load();

        // Проверяем ивенты
        for (let item of this.events) {
            if (item?.type === "client") client[item.once ? "once" : "on"](item.name as any, item.execute);
            else this.emitter[item.once ? "once" : "on"](item.name as any, item.execute);
        }
    };

    /**
     * @description Функция для перезагрузки
     * @public
     */
    public preregister = (client: Client) => {
        this.emitter.removeAllListeners();

        // Отключаем только загруженные события
        for (let item of this.events) {
            client.off(item.name as any, item.execute);
        }

        // Загружаем события заново
        this.register(client);
    };
}

/**
 * @author SNIPPIK
 * @description Все имена событий доступных для прослушивания
 * @type EventNames
 */
type EventNames<T> = T extends keyof QueuesEvents ? keyof QueuesEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

/**
 * @author SNIPPIK
 * @description Все типы для фильтрации событий
 * @type EventType
 */
type EventType<T> = T extends keyof QueuesEvents | keyof AudioPlayerEvents ? "player" : "client";

/**
 * @author SNIPPIK
 * @description Функция выполняемая при вызове события
 * @type EventCallback
 */
type EventCallback<T> = T extends keyof QueuesEvents ? QueuesEvents[T] : T extends keyof AudioPlayerEvents ? AudioPlayerEvents[T] : T extends keyof ClientEvents ? (...args: ClientEvents[T]) => void : never;

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
 * @class Event
 * @public
 */
export abstract class Event<T extends keyof ClientEvents | keyof QueuesEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    readonly name: EventNames<T>;

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    readonly type?: EventType<T>;

    /**
     * @description Тип выполнения события
     * @default null
     * @readonly
     * @public
     */
    readonly once: boolean;

    /**
     * @description Функция, которая будет запущена при вызове события
     * @default null
     * @readonly
     * @public
     */
    readonly execute: EventCallback<T>;
}