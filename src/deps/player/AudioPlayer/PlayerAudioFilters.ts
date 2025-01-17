import type {LocalizationMap} from "discord-api-types/v10";
import {db} from "@service/db";

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
    public get enabled() { return this._filters; };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     */
    public get compress() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`, `afade=t=in:st=0:d=${db.audio.options.fade}`];
        let chunk = 0;

        // Берем данные из всех фильтров
        for (const filter of this.enabled) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            // Если есть модификация скорости, то изменяем размер пакета
            if (filter.speed) {
                if (typeof filter.speed === "number") chunk += Number(filter.speed);
                else chunk += Number(this.enabled.slice(this.enabled.indexOf(filter) + 1));
            }
        }

        return { filters: realFilters.join(","), chunk };
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
    user_arg?: any;

    /**
     * @description Модификатор скорости
     * @readonly
     */
    readonly speed?: string | number;
}