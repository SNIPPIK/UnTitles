import {env} from "@handler";

/**
 * @author SNIPPIK
 * @description Эмодзи в качестве дизайнерского решения
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
 * @protected
 */
export class PlayerProgress {
    /**
     * @description Размер прогресс бара
     * @readonly
     * @private
     */
    private readonly size: number = null;

    /**
     * @description Создаем класс для отображения прогресс бара
     * @param size - Размер
     */
    public constructor(size: number = 12) {
        this.size = size;
    };

    /**
     * @description Получаем готовый прогресс бар
     * @readonly
     * @public
     */
    public readonly bar = (options: {duration: {current: number; total: number}, platform: string}): string => {
        const button = emoji["bottom_" + options.platform.toLowerCase()] || emoji.bottom;
        const {current, total} = options.duration;
        const size = this.size;

        const number = Math.round(size * (isNaN(current) ? 0 : current / total));
        let txt = current > 0 ? `${emoji.upped.left}` : `${emoji.empty.left}`;

        // Высчитываем размер прогресс бара
        if (current === 0) txt += `${emoji.upped.center.repeat(number)}${emoji.empty.center.repeat((size + 1) - number)}`;
        else if (current >= total) txt += `${emoji.upped.center.repeat(size)}`;
        else txt += `${emoji.upped.center.repeat(number)}${button}${emoji.empty.center.repeat(size - number)}`;

        return txt + (current >= total ? `${emoji.upped.right}` : `${emoji.empty.right}`);
    };
}