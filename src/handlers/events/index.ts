import type { DiscordClient } from "#structures/discord";
import type { AudioPlayerEvents } from "#core/player";
import type { ClientEvents } from "discord.js";
import type { QueueEvents } from "#core/queue";
import { TypedEmitter } from "#structures";
import { handler } from "#handler";

// Export decorator
export * from "./index.decorator";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с событиями
 * @class Events
 * @extends handler
 * @public
 */
export class Events extends handler<Event<SupportKeysOfEvents>> {
    /**
     * @description Вспомогательный класс для событий, по умолчанию используется для players, queues
     * @readonly
     * @public
     */
    public readonly emitter = new class extends TypedEmitter<QueueEvents & AudioPlayerEvents> {};

    /**
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        super("src/handlers/events");
    };

    /**
     * @description Регистрируем ивенты в эко системе бота
     * @returns void
     * @public
     */
    public register = (client: DiscordClient) => {
        if (this.size > 0) {
            // Отключаем только загруженные события
            for (let item of this.files) {
                client.off(item.name as any, item.run);
            }
        }

        // Загружаем события заново
        this.emitter.removeAllListeners();
        this.load();

        // Проверяем ивенты
        for (let item of this.files) {
            if (item?.type === "client") client[item.once ? "once" : "on"](item.name as any, item.run);
            else this.emitter[item.once ? "once" : "on"](item.name as any, item.run);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Поддерживаемые названия событий
 * @type SupportKeysOfEvents
 * @public
 */
export type SupportKeysOfEvents = keyof ClientEvents | keyof QueueEvents | keyof AudioPlayerEvents;

/**
 * @author SNIPPIK
 * @description Функция выполнение с типами данных
 * @type SupportEventCallback
 * @public
 */
export type SupportEventCallback<T> = T extends keyof QueueEvents ? QueueEvents[T] : T extends keyof AudioPlayerEvents ? AudioPlayerEvents[T] : T extends keyof ClientEvents ? (...args: ClientEvents[T]) => void : never;

/**
 * @author SNIPPIK
 * @description Декоратор события
 * @type SupportEvent
 * @public
 */
export type SupportEvent<T extends SupportKeysOfEvents> = {
    /**
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    name?: T extends keyof QueueEvents ? keyof QueueEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    type?: T extends keyof QueueEvents | keyof AudioPlayerEvents ? "player" : "client";
}

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
 * @class Event
 * @public
 */
export abstract class Event<T extends keyof ClientEvents | keyof QueueEvents | keyof AudioPlayerEvents> implements SupportEvent<T> {
    /**
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    public name: SupportEvent<T>["name"];

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    public type: SupportEvent<T>["type"];

    /**
     * @description Логика выполнения события
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
    run: SupportEventCallback<T>
}