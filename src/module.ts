import { DiscordClient } from "#structures/discord/index.js";
import { middlewares } from "#handler/middlewares/index.js";
import { AudioPlayerEvents } from "#core/player/index.js";
import { QueueEvents } from "#core/queue/index.js";
import { RestAPIEvents } from "#handler/rest/index.js";
import { DeveloperOptions } from "#structures/utils/decorator.js";

/**
 * Глобальные декларации типов и расширения встроенных прототипов.
 * Позволяют использовать кастомные методы и тип `json` во всём проекте без импортов.
 */
declare global {
    /**
     * Универсальный тип для представления произвольного JSON-объекта.
     * Ключи — строки, значения — любые (`any`). Удобен для работы с динамическими данными.
     */
    interface json { [key: string]: any }

    /**
     * Расширение прототипа `String`.
     */
    interface String {
        /**
         * Преобразует строку формата "MM:SS" (минуты:секунды) в количество секунд.
         * Пример: "03:45".duration() => 225.
         *
         * @returns Число секунд (целое).
         */
        duration(): number;
    }

    /**
     * Расширение прототипа `Number`.
     */
    interface Number {
        /**
         * Преобразует число (секунды или миллисекунды) в строку "MM:SS".
         * Если `ms` равно true, число интерпретируется как миллисекунды,
         * иначе — как секунды.
         *
         * @param ms — флаг, указывающий, что значение задано в миллисекундах (по умолчанию false).
         * @returns Строка в формате "минуты:секунды".
         */
        duration(ms?: boolean): string;

        /**
         * Возвращает случайное целое число в диапазоне [min, this].
         * `this` — верхняя граница (включительно), `min` — нижняя (по умолчанию 0).
         *
         * @param min — минимальное значение (по умолчанию 0).
         * @returns Случайное целое число.
         */
        random(min?: number): number;
    }
}

/**
 * Расширение типов библиотеки Seyfert для интеграции
 * с клиентом Discord и кастомными событиями/промежуточным ПО.
 *
 * Позволяет использовать собственные типы клиента (`DiscordClient`),
 * зарегистрированные middleware и события аудиоплеера/очереди/REST API
 * во всех механизмах Seyfert, где ожидаются стандартные интерфейсы.
 */
declare module "seyfert" {
    /**
     * Дополняет реестр Seyfert:
     * - `client` — конкретный класс DiscordClient вместо стандартного.
     * - `middlewares` — объект с пользовательскими middleware.
     */
    interface SeyfertRegistry {
        client: DiscordClient;
        middlewares: typeof middlewares;
    }

    /**
     * Расширяет интерфейс обычной команды параметрами разработчика
     * (например, `ownerOnly`, `cooldown` и т.п.).
     */
    interface Command extends DeveloperOptions {}

    /**
     * Расширяет интерфейс подкоманды параметрами разработчика.
     */
    interface SubCommand extends DeveloperOptions {}

    /**
     * Расширяет интерфейс компонентной команды параметрами разработчика.
     */
    interface ComponentCommand extends DeveloperOptions {}

    /**
     * Расширяет интерфейс модальной команды параметрами разработчика.
     */
    interface ModalCommand extends DeveloperOptions {}

    /**
     * Расширяет интерфейс контекстной команды параметрами разработчика.
     */
    interface ContextMenuCommand extends DeveloperOptions {}

    /**
     * Расширяет интерфейс команды точки входа (entry point) параметрами разработчика.
     */
    interface EntryPointCommand extends DeveloperOptions {}

    /**
     * Объединяет пользовательские события (аудиоплеер, очередь, REST API)
     * с базовыми событиями Seyfert. Теперь все эти события будут
     * типизированы в соответствующих методах `on`, `once` и т.д.
     */
    interface CustomEvents extends AudioPlayerEvents, QueueEvents, RestAPIEvents { }
}