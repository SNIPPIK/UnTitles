import type {LocalizationMap} from "discord-api-types/v10";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class PlayerAudioFilters
 * @public
 */
export class PlayerAudioFilters {
    /**
     * @description Включенные фильтры
     * @readonly
     * @private
     */
    private readonly _filters: AudioFilter[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enabled() {
        return this._filters;
    };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     * @param time - Время длительности трека
     * @public
     */
    public compress = (time: number) => {
        const realFilters: string[] = [`volume=${db.queues.options.volume / 150}`];
        const onFilters = this.enabled;

        // Если есть приглушение аудио
        if (db.queues.options.fade) {
            realFilters.push(`afade=t=in:st=0:d=${db.queues.options.fade + 2}`);

            // Если есть время трека
            if (typeof time === "number") realFilters.push(`afade=out:st=${time - (db.queues.options.fade + 5)}:d=${db.queues.options.fade + 5}`);
        }

        // Если есть включенные фильтры
        if (onFilters.length > 0) {
            // Берем данные из всех фильтров
            for (const filter of onFilters) {
                realFilters.push(filter.args ? `${filter.filter}${filter.argument ?? ""}` : filter.filter);
            }
        }

        return realFilters.join(",");
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