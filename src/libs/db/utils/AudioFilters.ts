import {SlashComponent} from "@lib/discord/utils/SlashBuilder";
import type {LocalizationMap} from "discord-api-types/v10";
import filters from "@lib/db/json/filters.json";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @need ExtraPlayer
 * @class AudioFilters
 */
export class AudioFilters {
    /**
     * @description Включенные фильтры
     * @private
     */
    private readonly enables: AudioFilter[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enable() { return this.enables; };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     */
    public get compress() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`, `afade=t=in:st=0:d=${db.audio.options.fade}`];
        let chunk = 0;

        // Берем данные из всех фильтров
        for (const filter of this.enable) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            // Если есть модификация скорости, то изменяем размер пакета
            if (filter.speed) {
                if (typeof filter.speed === "number") chunk += Number(filter.speed);
                else chunk += Number(this.enable.slice(this.enable.indexOf(filter) + 1));
            }
        }

        return { filters: realFilters.join(","), chunk };
    };
}

/**
 * @author SNIPPIK
 * @description Взаимодействие с фильтрами через класс для удобства
 * @class ExtraFilters
 */
export class ExtraFilters {
    /**
     * @description Создаем список фильтров для дискорд
     * @public
     */
    public get discord_command() {
        if (filters.length > 25) return [];

        const temples: SlashComponent["choices"] = [];

        // Перебираем фильтр
        for (const [key, value] of Object.entries(filters as AudioFilter[])) {
            const default_locale = Object.keys(value.locale)[0];

            // Создаем список для показа фильтров в командах
            temples.push({
                name: value.locale[default_locale],
                nameLocalizations: value.locale,
                value: value.name
            });
        }

        return temples;
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 */
export interface AudioFilter {
    //Имена
    name: string;

    // Перевод описания фильтров
    locale: LocalizationMap;

    //Имена несовместимых фильтров
    unsupported: string[];

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number];

    //Аргумент пользователя
    user_arg?: any;

    //Меняется ли скорость
    speed?: string | number;
}