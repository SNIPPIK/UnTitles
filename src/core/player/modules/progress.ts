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
 * @description Эмодзи в качестве дизайнерского решения
 * @private
 */
const emoji = {
    /**
     * @description Пустой прогресс бар
     */
    empty: {
        left: env.get("progress.empty.left"),
        center: env.get("progress.empty.center"),
        right: env.get("progress.empty.right")
    },

    /**
     * @description Не пустой прогресс бар
     */
    upped: {
        left: env.get("progress.not_empty.left"),
        center: env.get("progress.not_empty.center"),
        right: env.get("progress.not_empty.right")
    }
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
 */
interface PlayerProgressInput {
    /**
     * @description Название платформы
     * @readonly
     */
    platform: RestAPIS_Names;

    /**
     * @description Данные о времени трека
     */
    duration: {
        // Текущее время
        current: number;

        // Общее время
        total: number
    }
}