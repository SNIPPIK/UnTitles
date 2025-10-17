import type { DiscordClient } from "#structures/discord";
import type { AudioPlayerEvents } from "#core/player";
import { TypedEmitter } from "#structures";
import { QueueEvents } from "#core/queue";
import { ClientEvents } from "discord.js";
import { handler } from "#handler";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с событиями
 * @class Events
 * @extends handler
 * @public
 */
export class Events extends handler<Event<keyof ClientEvents>> {
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
     * @public
     */
    public register = (client: DiscordClient) => {
        if (this.size > 0) {
            // Отключаем только загруженные события
            for (let item of this.files) {
                client.off(item.name as any, item.execute);
            }
        }

        // Загружаем события заново
        this.emitter.removeAllListeners();
        this.load();

        // Проверяем ивенты
        for (let item of this.files) {
            if (item?.type === "client") client[item.once ? "once" : "on"](item.name as any, item.execute);
            else this.emitter[item.once ? "once" : "on"](item.name, item.execute);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
 * @class Event
 * @public
 */
export abstract class Event<T extends keyof ClientEvents | keyof QueueEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    readonly name: T extends keyof QueueEvents ? keyof QueueEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    readonly type?: T extends keyof QueueEvents | keyof AudioPlayerEvents ? "player" : "client";

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
    readonly execute: T extends keyof QueueEvents ? QueueEvents[T] : T extends keyof AudioPlayerEvents ? AudioPlayerEvents[T] : T extends keyof ClientEvents ? (...args: ClientEvents[T]) => void : never;
}