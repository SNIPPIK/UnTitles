import type { LocalizationMap } from "discord-api-types/v10";
import { db } from "#app/db";
import {SetArray} from "#structures";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class ControllerFilters
 * @public
 */
export class ControllerFilters<T extends AudioFilter> extends SetArray<T> {
    /**
     * @description Сжимаем фильтры для работы ffmpeg
     * @returns string
     * @public
     */
    public toString = (time: number, volume: number, isSwap = false) => {
        const { fade, optimization, swapFade } = db.queues.options;
        const filters: string[] = [`volume=${volume / 150}`];
        const fade_int = isSwap ? swapFade : fade;
        const live = time === 0;

        // Если есть приглушение аудио
        if (fade_int) {
            filters.push(`afade=t=in:st=0:d=${fade_int}`);

            // Если есть время трека
            if (typeof time === "number" && time >= optimization && !live) {
                const start = time - (fade + 5);

                if (start > 0) filters.push(`afade=t=out:st=${start}:d=${fade + 5}`);
            }
        }

        // Если трек не live
        if (!live) {
            // Берем данные из всех фильтров
            for (const enabled of this) {
                const {filter, args, argument} = enabled;

                filters.push(args ? `${filter}${argument ?? ""}` : filter);
            }
        }

        return filters.join(",")
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