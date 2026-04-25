import type { SupportEvent, SupportKeysOfEvents } from "#handler/events/index.js";

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок события
 * @decorator
 * @public
 */
export function DeclareEvent(options: SupportEvent<SupportKeysOfEvents>) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
            type = options.type;
        }
}

/**
 * @author SNIPPIK
 * @description Декоратор задающий много-разовое событие
 * @decorator
 * @public
 */
export function EventOn(once: boolean = false) {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            once = once;
        }
}