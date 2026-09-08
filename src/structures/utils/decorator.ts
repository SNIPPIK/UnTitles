import type { BaseCommand } from "seyfert";

/**
 * Опции разработчика для команд Seyfert.
 * Позволяют задать кулдаун, ограничения по использованию и пропуск регистрации.
 */
export interface DeveloperOptions {
    /**
     * Кулдаун команды (вероятно, в секундах).
     * @default 3
     */
    cooldown?: number;

    /**
     * Команда доступна только разработчику бота.
     * И отправляется в гильдии разработчика(ов).
     * @default false
     */
    onlyDeveloper?: boolean;

    /**
     * Команда доступна только владельцу гильдии.
     * @default false
     */
    onlyGuildOwner?: boolean;

    /**
     * Пропустить регистрацию команды (не загружать в Discord API).
     * @default false
     */
    skipRegister?: boolean;
}

/**
 * Тип, описывающий конструктор (класс), принимающий произвольные аргументы
 * и возвращающий экземпляр типа T.
 */
type Instantiable<T> = new (...arg: any[]) => T;

/**
 * Тип функции-декоратора: принимает цель (конструктор) и возвращает изменённый конструктор.
 */
type Decorator<T> = (target: T) => T;

/**
 * Фабрика декоратора для применения `DeveloperOptions` к классам команд.
 *
 * Если целевой класс не является наследником `BaseCommand`, параметр `options`
 * должен быть `null` (защита от неправильного использования).
 *
 * @param options - объект с опциями разработчика или `null`.
 * @returns Декоратор, который расширяет целевой класс и применяет опции через `Object.assign`.
 */
export function DeveloperOptions<A extends Instantiable<any>>(
    options: A extends Instantiable<BaseCommand> ? DeveloperOptions : null
): Decorator<A> {
    return (target: A) =>
        class extends target {
            constructor(...args: any[]) {
                super(...args);
                // Копируем все свойства из options в экземпляр команды.
                Object.assign(this, options);
            }
        };
}