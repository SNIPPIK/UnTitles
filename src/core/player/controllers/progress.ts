import type { RestAPINames } from "#handler/rest/index.decorator.js";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Эмодзи в качестве дизайнерского решения
 * @private
 */
const emoji = {
    /**
     * @description Пустой прогресс бар
     */
    empty: initElement("empty"),

    /**
     * @description Не пустой прогресс бар
     */
    upped: initElement("not_empty")
};

/**
 * @author SNIPPIK
 * @description Все найденные кнопки платформ
 * @private
 */
let buttons: { [key: string]: string; } = null;

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class PlayerProgress
 * @public
 */
export class PlayerProgress {
    public constructor(private size: number = 15) {};

    /**
     * @description Получаем готовый прогресс бар
     * @returns string
     * @public
     */
    public bar = ({ duration, platform }: PlayerProgressInput): string => {
        if (!buttons) initButtons();

        const { current, total } = duration;
        const button = buttons[`button_${platform?.toLowerCase()}`] ?? buttons["button"];

        // Для live-трека длина бара была на 1 символ больше из-за button + repeat(this.size)
        if (total === 0 || total === Infinity) {
            // Вычитаем 1 под саму кнопку, чтобы общая длина всегда равнялась this.size
            return emoji.upped.left + button + emoji.empty.center.repeat(Math.max(0, this.size - 1)) + emoji.empty.right;
        }

        const clamped = Math.min(Math.max(current / total, 0), 1);
        const filled = Math.floor(this.size * clamped);

        // Логичнее проверять > 0 (если current в секундах, то 0.5 — это уже не начало)
        const left = current > 0 ? emoji.upped.left : emoji.empty.left;
        const right = filled >= this.size ? emoji.upped.right : emoji.empty.right;

        // В самом начале (полностью пустой)
        if (current <= 0) {
            return left + emoji.empty.center.repeat(this.size) + right;
        }

        // В самом конце (полностью заполненный)
        else if (filled >= this.size || current >= total) {
            return left + emoji.upped.center.repeat(this.size) + right;
        }

        // Стандартный случай: середина с кнопкой
        // Добавлено Math.max(0, ...), чтобы избежать RangeError: Invalid count value
        const emptyCount = Math.max(0, this.size - filled - 1);
        const middle = emoji.upped.center.repeat(filled) + button + emoji.empty.center.repeat(emptyCount);

        return left + middle + right;
    };
}

/**
 * @author SNIPPIK
 * @description Данные для создания прогресс бара
 * @interface PlayerProgressInput
 * @private
 */
interface PlayerProgressInput {
    /** Название платформы */
    platform: RestAPINames;

    /** Данные о времени трека */
    duration: {
        /** Текущее время */
        current: number;

        /** Общее время */
        total: number
    };
}

/**
 * @author SNIPPIK
 * @description Доступные элементы для создания прогресс бара
 * @type Elements
 * @private
 */
type Elements = "left" | "center" | "right";

/**
 * @author SNIPPIK
 * @description Получение списка для создания прогресс бара
 * @param type - Тип элемента
 * @private
 */
function initElement(type: "empty" | "not_empty") {
    const keys = ["left", "center", "right"];
    return keys.reduce((acc, key) => {
        acc[key] = env.get(`progress.${type}.${key}`);
        return acc;
    }, {} as Record<Elements, string>);
}

/**
 * @author SNIPPIK
 * @description Функция для отложенной загрузки кнопок
 * @function initButtons
 * @private
 */
function initButtons() {
    buttons = db.api.array.reduce((acc, api) => {
        const platform = `${api.name}`.toLowerCase();
        const inEnv = env.get(`progress.button.${platform}`, null);

        if (inEnv) acc[`button_${platform}`] = inEnv;
        return acc;
    }, {
        button: env.get("progress.button"),
    });
}