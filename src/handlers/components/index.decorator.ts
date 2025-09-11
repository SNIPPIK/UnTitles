import type {SupportButtons, SupportSelector} from "#handler/components/index";

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок команды
 * @decorator
 */
export function DeclareComponent(options: {name: SupportSelector | SupportButtons}) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
        }
}