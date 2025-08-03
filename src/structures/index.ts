export * from "./logger";
export * from "./locale";
export * from "./tools/TypedEmitter";
export * from "./tools/Assign";
export * from "./tools/Collection";
export * from "./tools/SetArray";
export * from "./tools/Cycle";
export * from "./tools/httpsClient";
export * from "./tools/SimpleWorker";

/**
 * @description Все prototype объектов
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    // String
    {
        type: String.prototype, name: "duration",
        value: function () {
            const time = this?.["split"](":").map(Number) ?? [parseInt(this as any)];
            return time.length === 1 ? time[0] : time.reduce((acc: number, val: number) => acc * 60 + val);
        }
    },

    {
        type: Number.prototype, name: "random",
        value: function (min = 0) {
            return Math.floor(Math.random() * ((this as any) - min) + min);
        }
    },

    // Number
    {
        type: Number.prototype, name: "duration",
        value: function () {
            const t = Number(this), f = (n: number) => (n < 10 ? "0" : "") + n,
                days = ~~(t / 86400),
                hours = ~~(t % 86400 / 3600),
                min = ~~(t % 3600 / 60),
                sec = ~~(t % 60);

            return [days && days, (days || hours) && f(hours), f(min), f(sec)].filter(Boolean).join(":");
        }
    },
    {
        type: Number.prototype, name: "toSplit",
        value: function () {
            const fixed = parseInt(this as any);
            return (fixed < 10) ? ("0" + fixed) : fixed;
        }
    },
];

/**
 * @description Задаем функции для их использования в проекте
 */
for (const {type, name, value} of prototypes) {
    Object.defineProperty(type, name, { value, writable: true, configurable: true });
}

/**
 * @description Декларируем для TS
 * @global
 */
declare global {
    /**
     * @description Любое значение в json
     */
    interface json { [key: string]: any }
    interface String {
        /**
         * @prototype String
         * @description Превращаем 00:00 в число
         * @returns number
         */
        duration(): number;
    }
    interface Number {
        /**
         * @prototype Number
         * @description Превращаем число в 00:00
         * @returns string
         */
        duration(): string;

        /**
         * @prototype Number
         * @description Добавляем 0 к числу. Пример: 01:10
         * @returns string | number
         */
        toSplit(): string | number;

        /**
         * @prototype Number
         * @description Получаем случайное число
         * @param min {number} Мин число
         */
        random(min?: number): number;
    }
}