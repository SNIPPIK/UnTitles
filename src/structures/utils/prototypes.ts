/**
 * @author SNIPPIK
 * @description Все prototype объектов, для модификации функций
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    // String.prototype.duration
    {
        type: String.prototype, name: "duration",
        value: function (): number {
            const str = String(this).trim();
            if (!str) return 0;

            // Только цифры
            if (/^\d+$/.test(str)) return Number(str);

            // Формат "HH:MM:SS" или "MM:SS"
            if (str.includes(":")) {
                return str.split(":").reduce((acc, val) => (acc * 60) + Number(val), 0);
            }

            // Формат "1h 30m 5s"
            let totalSeconds = 0;
            str.replace(/(\d+)\s*([a-z])/gi, (_, val, unit) => {
                const n = Number(val);
                const u = unit.toLowerCase();

                if (u === 'h') totalSeconds += n * 3600;
                else if (u === 'm') totalSeconds += n * 60;
                else if (u === 's') totalSeconds += n;

                return "";
            });

            return totalSeconds;
        }
    },

    // Number.prototype.duration
    {
        type: Number.prototype, name: "duration",
        value: function (ms: boolean = false): string {
            const t = Number(this);
            if (Number.isNaN(t) || t <= 0) return ms ? "00:00.000" : "00:00";

            // Хелпер для добавления нулей (вынесен наверх, чтобы не пересоздаваться)
            const pad = (n: number, len = 2) => String(n).padStart(len, '0');

            // Извлекаем только нужные значения без остатка (t % ...)
            const d = Math.floor(t / 86400);
            const h = Math.floor((t % 86400) / 3600);
            const m = Math.floor((t % 3600) / 60);
            const s = Math.floor(t % 60);

            // Сборка строки "от меньшего к большему" без создания массивов (join)
            let res = `${pad(m)}:${pad(s)}`;

            if (h > 0 || d > 0) {
                res = `${d > 0 ? pad(h) : h}:${res}`;
            }

            if (d > 0) {
                res = `${d}d:${res}`;
            }

            // Обработка миллисекунд
            if (ms) {
                const mil = Math.round((t % 1) * 1000);
                if (mil > 0) res += `.${pad(mil, 3)}`;
            }

            return res;
        }
    },

    // Number.prototype.random
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