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
            // Если требуется преобразовать число из строки в число
            if ((this as any).match(/^\d+$/)) return parseInt(this as any);

            // Если надо разобрать строковое время в число
            else if (!(this as any).match(":")) {
                let hours = 0, minutes = 0, seconds = 0;

                const h = (this as any).match(/(\d+)\s*(?:hour|hours|hr|hrs)/i);
                const m = (this as any).match(/(\d+)\s*(?:minute|minutes|min|mins)/i);
                const s = (this as any).match(/(\d+)\s*(?:second|seconds|sec|secs)/i);

                if (h) hours = parseInt(h[1], 10);
                if (m) minutes = parseInt(m[1], 10);
                if (s) seconds = parseInt(s[1], 10);

                return seconds + (minutes * 60) + (hours * 3600);
            }

            // Если указан формат HH:MM:SS
            const time = this?.["split"](":").map(Number);
            return time.length === 1 ? time[0] : time.reduce((acc: number, val: number) => acc * 60 + val);
        }
    },

    // Number
    {
        type: Number.prototype, name: "duration",
        value: function () {
            const t = Number(this), days = ~~(t / 86400), hours = ~~(t % 86400 / 3600), min = ~~(t % 3600 / 60), sec = ~~(t % 60);
            return [days && days, (days || hours) && hours.toZero(), min.toZero(), sec.toZero()].filter(Boolean).join(":");
        }
    },
    {
        type: Number.prototype, name: "toZero",
        value: function (size: number = 2) {
            return String(this).padStart(size, "0");
        }
    },
    {
        type: Number.prototype, name: "random",
        value: function (min = 0) {
            return Math.floor(Math.random() * ((this as any) - min) + min);
        }
    }
];

/**
 * @description Задаем функции для их использования в проекте
 */
for (const {type, name, value} of prototypes) {
    Object.defineProperty(type, name, { value, writable: true, configurable: true });
}

export * from "./array";
export * from "./logger";
export * from "./locale";
export * from "./tools/TypedEmitter";
export * from "./tools/Assign";
export * from "./tools/Cycle";
export * from "./tools/httpsClient";
export * from "./tools/SimpleWorker";

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
         * @description Получаем случайное число
         * @param min {number} Мин число
         */
        random(min?: number): number;

        /**
         * @prototype Number
         * @description Функция превращающая число в строку с добавлением 0
         * @param size - Размер ряда, 2 = 00
         */
        toZero(size?: number): number;
    }
}