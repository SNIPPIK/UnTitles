import { RestServerSide } from "#handler/rest/apis";
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
    bottom: env.get("progress.bottom"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    bottom_vk: env.get("progress.bottom.vk"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    bottom_yandex: env.get("progress.bottom.yandex"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    bottom_youtube: env.get("progress.bottom.youtube"),

    /**
     * @description Разделение прогресс бара, поддерживает платформы
     */
    bottom_spotify: env.get("progress.bottom.spotify")
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
     */
    public constructor(private readonly size: number = 12) {};

    /**
     * @description Получаем готовый прогресс бар
     * @public
     */
    public bar = ({duration, platform}: PlayerProgressInput): string => {
        const {current, total} = duration;
        const button = emoji[`bottom_${platform.toLowerCase()}`] || emoji.bottom;

        // Если live трек
        if (total === 0) return emoji.upped.left + button + emoji.empty.center.repeat(this.size) + emoji.empty.right;

        const left = current > 0 ? emoji.upped.left : emoji.empty.left;
        const right = current >= total ? emoji.upped.right : emoji.empty.right;

        const filled = Math.round(this.size * (isNaN(current) ? 0 : current / (total)));
        const middle =
            current === 0 ?
                emoji.upped.center.repeat(filled) + emoji.empty.center.repeat(this.size + 1 - filled) :
                current >= total ?
                    emoji.upped.center.repeat(this.size) :
                    emoji.upped.center.repeat(filled) + button + emoji.empty.center.repeat(this.size - filled);

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