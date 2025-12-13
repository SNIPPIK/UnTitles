/**
 * @author SNIPPIK
 * @description Все prototype объектов, для модификации функций
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    // String
    {
        type: String.prototype, name: "duration",
        value: function () {
            const str = String(this).trim();
            if (!str) return 0;

            // Формат "HH:MM:SS" или "MM:SS"
            if (str.includes(":")) {
                // Разбираем строку по ":" и конвертируем в числа
                const parts = str.split(":").map(Number);

                // Если parts.length = 3 (HH:MM:SS), parts = [H, M, S]
                // Если parts.length = 2 (MM:SS), parts = [M, S]
                // Если parts.length = 1 (S), parts = [S]

                let seconds = 0;

                // Начинаем с конца и умножаем на 60 в соответствующей степени
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[parts.length - 1 - i]; // S, M, H
                    // (S * 60^0) + (M * 60^1) + (H * 60^2)
                    seconds += part * (60 ** i);
                }
                return seconds;
            }

            // Если строка содержит только цифры, преобразуем в целое число (считаем секундами)
            if (/^\d+$/.test(str)) {
                return parseInt(str, 10);
            }

            // Формат "1h 30m 5s" (с использованием регулярных выражений)
            let totalSeconds = 0;

            // Регулярное выражение для поиска H, M, S с их сокращениями
            const regex = /(?:(\d+)\s*(?:hours?|hr|hrs|h))?\s*(?:(\d+)\s*(?:minutes?|min|mins|m))?\s*(?:(\d+)\s*(?:seconds?|sec|secs|s))?/i;
            const match = str.match(regex);

            if (match) {
                const hours = parseInt(match[1] || '0', 10);
                const minutes = parseInt(match[2] || '0', 10);
                const seconds = parseInt(match[3] || '0', 10);

                totalSeconds += seconds;
                totalSeconds += minutes * 60;
                totalSeconds += hours * 3600;
            }

            return totalSeconds;
        }
    },

    // Number
    {
        type: Number.prototype, name: "duration",
        value: function (ms: boolean = false) {
            const t = Number(this);
            if (isNaN(t) || t < 0) return "00:00";

            // Внутренняя функция для добавления ведущего нуля
            const toZero = (val: number) => String(val).padStart(2, '0');

            // Выделяем дни, часы, минуты, секунды
            const days = Math.floor(t / 86400); // 86400 = 24 * 3600
            let remainder = t % 86400;

            const hours = Math.floor(remainder / 3600);
            remainder %= 3600;

            const minutes = Math.floor(remainder / 60);
            const seconds = Math.floor(remainder % 60);

            // Форматируем части
            const parts: (string | number)[] = [];

            if (days > 0) parts.push(`${days}d`);

            // Часы показываем, только если есть дни ИЛИ если это самый большой элемент
            // (например, "01:30:00" а не "30:00")
            if (days > 0 || hours > 0) {
                // Если есть дни, форматируем часы с нулем, иначе просто числом
                parts.push(days > 0 ? toZero(hours) : hours);
            }

            // Минуты и секунды обязательны
            parts.push(toZero(minutes), toZero(seconds));

            // Соединяем
            let result = parts
                .filter(Boolean) // Удаляем потенциальные нули
                .join(":");

            // Если надо указать миллисекунды
            if (ms) {
                // Добавляем миллисекунды (если число было дробным)
                const milliseconds = Math.round((t - Math.floor(t)) * 1000);
                if (milliseconds > 0) {
                    // Оставляем только 3 знака после запятой
                    result += `.${String(milliseconds).padStart(3, '0')}`;
                }
            }

            return result;
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
 * @author SNIPPIK
 * @description Задаем функции для их использования в проекте
 * @private
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
 * @author SNIPPIK
 * @description Декларируем данные для работы с typescript
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
        duration(ms?: boolean): string;

        /**
         * @prototype Number
         * @description Получаем случайное число
         * @param min {number} Мин число
         */
        random(min?: number): number;
    }
}