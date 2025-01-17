import {db} from "@service/db";

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
     * @description Эмодзи в качестве дизайнерского решения
     * @readonly
     * @static
     * @private
     */
    private static emoji: typeof db.emojis.progress = null;

    /**
     * @description Создаем класс для отображения прогресс бара
     * @param size - Размер
     */
    public constructor(size: number = 12) {
        if (!PlayerProgress.emoji) PlayerProgress.emoji = db.emojis.progress;
        this.size = size;
    };

    /**
     * @description Получаем готовый прогресс бар
     * @readonly
     * @public
     */
    public readonly bar = (options: {duration: {current: number; total: number}, platform: string}): string => {
        const emoji = PlayerProgress.emoji;
        const button = emoji["bottom_" + options.platform.toLowerCase()] || emoji.bottom;
        const {current, total} = options.duration;
        const size = this.size;

        const number = Math.round(size * (isNaN(current) ? 0 : current / total));
        let txt = current > 0 ? `${emoji.upped.left}` : `${emoji.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) txt += `${emoji.upped.center.repeat(number)}${emoji.empty.center.repeat((size + 1) - number)}`;
        else if (current >= total) txt += `${emoji.upped.center.repeat(size)}`;
        else txt += `${emoji.upped.center.repeat(number)}${button}${emoji.empty.center.repeat(size - number)}`;

        return txt + (current >= total ? `${emoji.upped.right}` : `${emoji.empty.right}`);
    };
}