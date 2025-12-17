import type { SupportEvent, SupportKeysOfEvents } from "#handler/events";

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
 * @description Декоратор задающий разовое событие
 * @decorator
 * @public
 */
export function EventOnce() {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            once = true;
        }
}

/**
 * @author SNIPPIK
 * @description Декоратор задающий много-разовое событие
 * @decorator
 * @public
 */
export function EventOn() {
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            once = false;
        }
}