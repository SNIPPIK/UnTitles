import type { LocalizationMap } from "discord-api-types/v10";
import { SetArray } from "#structures";

/**
 * @author SNIPPIK
 * @description Управление аудио-фильтрами (эквалайзер, эффекты и т.п.),
 * применяемыми к голосовому потоку. Хранит активные фильтры в коллекции
 * с быстрым доступом и конвертирует их в строку параметров для FFmpeg.
 *
 * Ключевые возможности:
 * - Добавление/удаление фильтров с проверкой на дубликаты.
 * - Контроль совместимости: фильтр не будет добавлен, если он конфликтует
 *   с уже активным.
 * - Ленивая генерация строки фильтров (только при изменении состава).
 * - Упорядочивание фильтров по приоритету `priority` перед конвертацией.
 * - Оптимизация обратных проверок несовместимости через `Map<Filter, Set<string>>`.
 *
 * @class ControllerFilters
 * @extends SetArray — коллекция, обеспечивающая O(1) операции
 * и быстрый доступ к массиву элементов.
 * @typeParam T — тип фильтра, расширяющий интерфейс `AudioFilter`.
 * @public
 */
export class ControllerFilters<T extends AudioFilter> extends SetArray<T> {
    /**
     * Кешированная строка фильтров, готовая для передачи в FFmpeg.
     * Обновляется лениво при изменении набора фильтров (`_dirty = true`).
     */
    private _filters: string | null = null;

    /**
     * Флаг, сигнализирующий о необходимости пересчёта строки `_filters`.
     * Устанавливается при любом изменении состава коллекции.
     */
    private _dirty = true;

    /**
     * Карта обратной несовместимости: для каждого активного фильтра хранится
     * `Set` имён фильтров, с которыми он несовместим (поле `unsupported`).
     *
     * Позволяет быстро проверить, конфликтует ли уже включённый фильтр с новым,
     * без повторного перебора массива `unsupported` нового фильтра.
     */
    private _unsupportedMap = new Map<T, Set<string>>();

    /**
     * Строковое представление всех активных фильтров в формате FFmpeg.
     *
     * При первом обращении после изменения состава коллекции инициирует
     * пересборку через `_buildFilters()` и кэширует результат.
     * Последующие обращения возвращают кэш, пока не взведён `_dirty`.
     */
    public get filters(): string {
        if (this._dirty) {
            this._filters = this._buildFilters();
            this._dirty = false;
        }
        return this._filters!;
    };

    /**
     * Добавляет новый фильтр в коллекцию.
     *
     * Если фильтр уже присутствует, вызов игнорируется (дубликаты запрещены).
     * В противном случае:
     * - Добавляет фильтр в `SetArray` (O(1)).
     * - Кэширует его список несовместимых имён (`unsupported`) для быстрой
     *   проверки конфликтов в `hasUnsupported()`.
     * - Взводит флаг `_dirty` для последующего пересчёта строки фильтров.
     *
     * @param item - Экземпляр фильтра, реализующий `AudioFilter`.
     * @returns `this` для возможности цепочечных вызовов.
     */
    public add(item: T): this {
        // Если уже добавлен фильтр
        if (this.has(item)) return this;

        super.add(item);

        // Сохраняем Set несовместимых имён для будущих проверок.
        this._unsupportedMap.set(item, new Set(item.unsupported));
        this._dirty = true;
        return this;
    };

    /**
     * Удаляет фильтр из коллекции.
     *
     * В случае успешного удаления:
     * - Удаляет запись из карты несовместимости.
     * - Взводит `_dirty` для пересчёта строки фильтров.
     *
     * @param item - Удаляемый фильтр.
     * @returns `true`, если фильтр был в коллекции и успешно удалён, иначе `false`.
     */
    public delete(item: T): boolean {
        const deleted = super.delete(item);
        if (deleted) {
            this._unsupportedMap.delete(item);
            this._dirty = true;
        }
        return deleted;
    };

    /**
     * Проверяет совместимость нового фильтра с уже активными.
     *
     * Анализирует два направления конфликтов:
     * 1. **Новый → активный**: есть ли в `unsupported` нового фильтра имена активных фильтров?
     * 2. **Активный → новый**: есть ли в `unsupported` активного фильтра имя нового?
     *
     * Благодаря использованию `Set` и кешированной карты `_unsupportedMap`
     * обе проверки выполняются за **O(n)**, где n — количество активных фильтров,
     * но каждая отдельная проверка конфликта — O(1).
     *
     * @param filter - Новый фильтр, совместимость которого проверяется.
     * @returns `null`, если фильтр полностью совместим;
     *          иначе кортеж `[имя_конфликтующего, имя_с_чем_конфликт]`.
     */
    public hasUnsupported = (filter: T): null | [string, string] => {
        // Множество имён, с которыми новый фильтр несовместим.
        const incomingUnsupported = new Set(filter.unsupported);

        for (const enabled of this.array) {
            // Конфликт: новый фильтр явно запрещает активный.
            if (incomingUnsupported.has(enabled.name)) {
                return [filter.name, enabled.name];
            }
            // Конфликт: активный фильтр запрещает новый.
            const enabledConflicts = this._unsupportedMap.get(enabled)!;
            if (enabledConflicts.has(filter.name)) {
                return [enabled.name, filter.name];
            }
        }

        return null;
    };

    /**
     * Полностью очищает коллекцию активных фильтров.
     *
     * Сбрасывает:
     * - Внутренний массив и карту индексов через `super.clear()`.
     * - Карту несовместимости `_unsupportedMap`.
     * - Кэш строки фильтров.
     * - Взводит `_dirty` (хотя строка уже null, это сохраняет инвариант).
     */
    public clear(): void {
        super.clear();
        this._unsupportedMap.clear();
        this._filters = null;
        this._dirty = true;
    };

    /**
     * Собирает строку фильтров для FFmpeg на основе активных элементов.
     *
     * Алгоритм:
     * 1. Создаёт копию массива активных фильтров, чтобы не нарушить
     *    индексы и итерацию в `SetArray` (метод `sort` мутирует массив,
     *    а здесь используется копия).
     * 2. Сортирует копию по приоритету `priority` (по возрастанию).
     *    Если приоритет не задан, фильтр помещается в конец (`Infinity`).
     * 3. Для каждого фильтра, у которого задано свойство `filter`, формирует
     *    отдельный компонент строки: если у фильтра есть `args`, то берётся
     *    `filter` + (опциональный `argument`), иначе только `filter`.
     *    Лишние пробелы удаляются.
     * 4. Объединяет компоненты через запятую — это стандартный синтаксис
     *    цепочки фильтров FFmpeg (`filter1,filter2,...`).
     *
     * @returns Готовая строка фильтров, например `"volume=0.5,equalizer=f=1000:t=q:w=1:g=5"`.
     * @private
     */
    private _buildFilters(): string {
        // Копируем, чтобы не мутировать внутренний массив.
        const sorted = [...this.array].sort((a, b) => {
            const va = a.priority === undefined ? Infinity : a.priority;
            const vb = b.priority === undefined ? Infinity : b.priority;
            return va - vb;
        });

        const parts: string[] = [];
        for (const { filter, args, argument } of sorted) {
            if (!filter) continue; // фильтр без имени игнорируется
            parts.push(
                args
                    ? `${filter}${argument ?? ''}`.trim()
                    : filter.trim()
            );
        }

        return parts.join(',');
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 * @public
 */
export interface AudioFilter {
    /** Имя фильтра */
    readonly name: string;

    /** Приоритет фильтра **/
    readonly priority: 0 | 1;

    /** Имена переводов */
    readonly locale: LocalizationMap;

    /** Имена несовместимых фильтров */
    readonly unsupported: string[];

    /** Параметр фильтра для ffmpeg */
    readonly filter: string;

    /** Аргументы для фильтра */
    readonly args: false | [number, number];

    /** Аргументы указанные пользователем */
    argument?: number;
}