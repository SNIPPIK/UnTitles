import {AudioPlayerEvents, CollectionAudioEvents} from "@service/player";
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
    public readonly emitter = new class extends TypedEmitter<CollectionAudioEvents & AudioPlayerEvents> {
        /**
         * @description Имена событий плеера, с авто поиском
         * @private
         */
        private _playerEvents: (keyof AudioPlayerEvents)[] = null;

        /**
         * @description События плеера
         * @return (keyof AudioPlayerEvents)[]
         */
        public get player() {
            if (this._playerEvents) return this._playerEvents;

            this._playerEvents = this.eventNames().filter((item) => (item as string).match(/player\//)) as (keyof AudioPlayerEvents)[];
            return this._playerEvents;
        };
    };

    /**
     * @description Выдаем все загруженные события
     * @public
     */
    public get events() { return this.files; };

    /**
     * @description Загружаем класс вместе с дочерним
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
            if (item.type === "client") client[item.once ? "once" : "on"](item.name as any, (...args) => item.execute(client, ...args));
            else this.emitter[item.once ? "once" : "on"](item.name as any, (...args: any) => item.execute(...args));
        }
    };

    /**
     * @description Функция для перезагрузки
     * @public
     */
    public preregister = (client: Client) => {
        this.unload();
        client.removeAllListeners();
        this.emitter.removeAllListeners();
        this.register(client);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для событий
 * @class Event
 * @public
 */
export abstract class Event<T extends keyof ClientEvents | keyof CollectionAudioEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    readonly name: T extends keyof CollectionAudioEvents ? keyof CollectionAudioEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    readonly type: T extends keyof CollectionAudioEvents | keyof AudioPlayerEvents ? "player" : "client";

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
    readonly execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (...args: Parameters<AudioPlayerEvents[T]>) => void : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
}