import type { RestAPIS_Names } from "#handler/rest/index.decorator";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Функция для отложенной загрузки кнопок
 * @function initButtons
 * @private
 */
function initButtons() {
    buttons = db.api.platforms.array.reduce((acc, api) => {
        const platform = api.name.toLowerCase();
        const inEnv = env.get(`progress.button.${platform}`, null);

        if (inEnv) acc[`button_${platform}`] = inEnv;
        return acc;
    }, {
        button: env.get("progress.button"),
    });
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
    /**
     * @description Создаем класс для отображения прогресс бара
     * @param size - Размер
     * @constructor
     * @public
     */
    public constructor(private size: number = 15) {};

    /**
     * @description Получаем готовый прогресс бар
     * @returns string
     * @public
     */
    public bar = ({ duration, platform }: PlayerProgressInput): string => {
        if (!buttons) initButtons();

        const { current, total } = duration;
        const button = buttons[`button_${platform.toLowerCase()}`] ?? buttons["button"];

        // Если live-трек
        if (total === 0) {
            return emoji.upped.left + button + emoji.empty.center.repeat(this.size) + emoji.empty.right;
        }

        const clamped = Math.min(Math.max(current / total, 0), 1);
        const filled = Math.floor(this.size * clamped);

        const left = current >= 1 ? emoji.upped.left : emoji.empty.left;
        const right = filled >= this.size ? emoji.upped.right : emoji.empty.right;

        // Если в самом начале — просто пустой бар без кнопки
        if (current < 1) {
            return left + emoji.empty.center.repeat(this.size) + right;
        }

        // Если в самом конце — полностью заполненный бар
        else if (filled >= this.size || current >= total) {
            return left + emoji.upped.center.repeat(this.size) + right;
        }

        // Стандартный случай: середина с кнопкой
        const middle = emoji.upped.center.repeat(filled) + button + emoji.empty.center.repeat(this.size - filled - 1); // -1 под кнопку
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
    /**
     * @description Название платформы
     * @public
     */
    platform: RestAPIS_Names;

    /**
     * @description Данные о времени трека
     * @public
     */
    duration: {
        // Текущее время
        current: number;

        // Общее время
        total: number
    }
}