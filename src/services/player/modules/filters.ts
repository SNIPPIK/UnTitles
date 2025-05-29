import type { LocalizationMap } from "discord-api-types/v10";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class PlayerAudioFilters
 * @public
 */
export class PlayerAudioFilters<T extends AudioFilter> {
    /**
     * @description Включенные фильтры
     * @readonly
     * @private
     */
    private readonly _filters: T[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enabled() {
        return this._filters;
    };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     * @public
     */
    public compress = (time?: number) => {
        const { volume, fade, optimization } = db.queues.options;
        const filters: string[] = [`volume=${volume / 150}`];

        // Если есть приглушение аудио
        if (fade) {
            filters.push(`afade=t=in:st=0:d=${fade + 2}`);

            // Если есть время трека
            if (typeof time === "number" && time >= optimization) {
                const start = time - (fade + 5);

                if (start > 0) filters.push(`afade=t=out:st=${start}:d=${fade + 5}`);
            }
        }

        // Берем данные из всех фильтров
        for (const { filter, args, argument } of this.enabled) {
            filters.push(args ? `${filter}${argument ?? ""}` : filter);
        }

        return filters.join(",");
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 * @public
 */
export interface AudioFilter {
    /**
     * @description Имя фильтра
     * @readonly
     */
    readonly name: string;

    /**
     * @description Имена переводов
     * @readonly
     */
    readonly locale: LocalizationMap;

    /**
     * @description Имена несовместимых фильтров
     * @readonly
     */
    readonly unsupported: string[];

    /**
     * @description Параметр фильтра для ffmpeg
     * @readonly
     */
    readonly filter: string;

    /**
     * @description Аргументы для фильтра
     * @readonly
     */
    readonly args: false | [number, number];

    /**
     * @description Аргументы указанные пользователем
     * @readonly
     */
    argument?: number;
}