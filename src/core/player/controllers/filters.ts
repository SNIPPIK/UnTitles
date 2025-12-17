import type { LocalizationMap } from "discord-api-types/v10";
import { SetArray } from "#structures";

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class ControllerFilters
 * @public
 */
export class ControllerFilters<T extends AudioFilter> extends SetArray<T> {
    /**
     * @description Скомпилированные фильтры, заранее подготовленные
     * @private
     */
    private _filters: string = null;

    /**
     * @description Выдаем скомпилированные фильтры
     * @public
     */
    public get filters() {
        return this._filters;
    };

    /**
     * @description Добавляем фильтр/ы из списка
     * @param item - Фильтр
     * @public
     */
    public add(item: T) {
        super.add(item);
        this._filters = this.parseFilters();
        return this;
    };

    /**
     * @description Удаляем фильтр/ы из списка
     * @param item - Фильтр
     * @public
     */
    public delete(item: T) {
        super.delete(item);
        this._filters = this.parseFilters();
        return true;
    };

    /**
     * @description Подготавливаем фильтры в строчку
     * @private
     */
    private parseFilters = () => {
        const filters: string[] = [];

        // Добавляем пользовательские фильтры
        for (const { filter, args, argument } of this) {
            if (!filter || typeof filter !== "string") continue;
            const argString = args ? `${filter}${argument ?? ""}` : filter;
            filters.push(argString.trim());
        }

        return filters.join(",");
    };

    /**
     * @description Проверяем совместимость фильтров
     * @param filter - Сам фильтр
     * @public
     */
    public hasUnsupported = (filter: T): null | [string, string] => {
        // Делаем проверку на совместимость
        // Проверяем, не конфликтует ли новый фильтр с уже включёнными
        for (const enabledFilter of this) {
            // Новый фильтр несовместим с уже включённым?
            if (filter.unsupported && filter.unsupported?.includes(enabledFilter.name)) return [filter.name, enabledFilter.name];

            // Уже включённый фильтр несовместим с новым?
            else if (enabledFilter.unsupported.includes(filter.name)) return [enabledFilter.name, filter.name];
        }

        return null;
    };

    /**
     * @description Чистим фильтры включая подготовленные
     * @public
     */
    public clear() {
        this._filters = null;
        super.clear();
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