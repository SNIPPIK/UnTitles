import type { DiscordClient } from "#structures/discord/index.js";
import type { ClientEventTypes } from "discord.js";
import { TypedEmitter } from "#structures";
import { handler } from "#handler";

// Events
import type { AudioPlayerEvents } from "./index.player.js";
import type { RestAPIEvents } from "./index.rest.js";
import type { QueueEvents } from "./index.queue.js";

// Export decorator
export * from "./index.decorator.js";
export type { AudioPlayerEvents } from "./index.player.js";
export type { RestAPIEvents } from "./index.rest.js";
export type { QueueEvents } from "./index.queue.js";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с событиями
 * @class Events
 * @extends handler
 * @public
 */
export class Events extends handler<Event<SupportKeysOfEvents>> {
    /** Вспомогательный класс для событий, по умолчанию используется для players, queues и прочего */
    public readonly emitter = new class extends TypedEmitter<EmitterEvents> {};

    /**
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        super("build/src/handlers/events");
    };

    /**
     * @description Регистрируем ивенты в эко системе бота
     * @returns void
     * @public
     */
    public register = async (client: DiscordClient) => {
        if (this.size > 0) {
            // Отключаем только загруженные события
            for (let item of this.files) {
                //@ts-ignore
                client.off(item.name as any, item.run);
            }
        }

        // Загружаем события заново
        this.emitter.removeAllListeners();
        await this.load();

        try {
            // Проверяем ивенты
            for (let item of this.files) {
                if (item?.type === "client") client[item.once ? "once" : "on"](item.name as any, item.run);
                else this.emitter[item.once ? "once" : "on"](item.name as any, item.run);
            }
        } catch (err) {
            return this.onRunFail(err as Error);
        }
    };
}

/**
 * @author SNIPPIK
 * @description События для типизированного сборщика событий
 * @type EmitterEvents
 * @public
 */
type EmitterEvents = QueueEvents & AudioPlayerEvents & RestAPIEvents;

/**
 * @author SNIPPIK
 * @description Поддерживаемые названия событий
 * @type SupportKeysOfEvents
 * @public
 */
export type SupportKeysOfEvents = keyof ClientEventTypes | keyof QueueEvents | keyof AudioPlayerEvents | keyof RestAPIEvents;

/**
 * @author SNIPPIK
 * @description Функция выполнение с типами данных
 * @type SupportEventCallback
 * @public
 */
export type SupportEventCallback<T> =
    T extends keyof QueueEvents ? QueueEvents[T] :
        T extends keyof RestAPIEvents ? RestAPIEvents[T] :
            T extends keyof AudioPlayerEvents ? AudioPlayerEvents[T] :
            T extends keyof ClientEventTypes ? (...args: ClientEventTypes[T]) => void : never;

/**
 * @author SNIPPIK
 * @description Декоратор события
 * @type SupportEvent
 * @public
 */
export type SupportEvent<T extends SupportKeysOfEvents> = {
    /** Название события */
    name?: T extends SupportKeysOfEvents ? SupportKeysOfEvents : keyof ClientEventTypes;

    /** Тип события */
    type?: T extends keyof QueueEvents | keyof AudioPlayerEvents | keyof RestAPIEvents ? "player" : "client";
}

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
 * @class Event
 * @public
 */
export abstract class Event<T extends SupportKeysOfEvents> implements SupportEvent<T> {
    /** Название событие */
    public name: SupportEvent<T>["name"];

    /** Тип события */
    public type: SupportEvent<T>["type"];

    /** Логика выполнения события */
    readonly once: boolean;

    /** Функция, которая будет запущена при вызове события */
    run: SupportEventCallback<T>;
}