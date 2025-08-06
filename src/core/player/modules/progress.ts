import { RestServerSide } from "#handler/rest";
import { env } from "#app/env";

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
    },

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button: env.get("progress.button"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_vk: env.get("progress.button.vk"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_yandex: env.get("progress.button.yandex"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_youtube: env.get("progress.button.youtube"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_spotify: env.get("progress.button.spotify"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_soundcloud: env.get("progress.button.soundcloud"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    button_deezer: env.get("progress.button.deezer")
}

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
    public constructor(private readonly size: number = 15) {};

    /**
     * @description Получаем готовый прогресс бар
     * @returns string
     * @public
     */
    public bar = ({ duration, platform }: PlayerProgressInput): string => {
        const { current, total } = duration;
        const button = emoji[`button_${platform.toLowerCase()}`] || emoji.button;

        // Если live-трек
        if (total === 0) {
            return emoji.upped.left + button + emoji.empty.center.repeat(this.size) + emoji.empty.right;
        }

        const clamped = Math.min(Math.max(current / total, 0), 1);
        const filled = Math.floor(this.size * clamped);

        const left = current > 0 ? emoji.upped.left : emoji.empty.left;
        const right = filled >= this.size ? emoji.upped.right : emoji.empty.right;

        // Если в самом начале — просто пустой бар без кнопки
        if (current === 0) {
            return left + emoji.empty.center.repeat(this.size) + right;
        }

        // Если в самом конце — полностью заполненный бар
        if (filled >= this.size || current >= total) {
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
    platform: RestServerSide.API["name"];

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