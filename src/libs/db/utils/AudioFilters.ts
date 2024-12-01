import {SlashComponent} from "@lib/discord/utils/SlashBuilder";
import type {LocalizationMap} from "discord-api-types/v10";
import filters from "@lib/db/json/filters.json";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class AudioFilters
 * @public
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
 * @public
 */
export class ExtraFilters {
    /**
     * @description Создаем список фильтров для дискорд
     * @public
     */
    public get discord_command() {
        const temples: SlashComponent["choices"] = [];

        // Если фильтров слишком много
        if (filters.length > 25) return temples;

        // Перебираем фильтр
        for (const filter of filters as AudioFilter[]) {
            const default_locale = Object.keys(filter.locale)[0];

            // Проверяем кол-во символов на допустимость discord (100 шт.)
            for (const [key, value] of Object.entries(filter.locale)) {
                if (value.startsWith("[")) continue;

                // Добавляем диапазон аргументов
                if (filter.args) filter.locale[key] = `<${filter.args[0]}-${filter.args[1]}> - ${filter.locale[key]}`;

                // Удаляем лишний размер описания
                filter.locale[key] = value.length > 75 ? `[${filter.name}] - ${filter.locale[key].substring(0, 75)}...` : `[${filter.name}] - ${filter.locale[key]}`;
            }

            // Создаем список для показа фильтров в командах
            temples.push({
                name: filter.locale[default_locale],
                nameLocalizations: filter.locale,
                value: filter.name
            });
        }

        return temples;
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 * @public
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