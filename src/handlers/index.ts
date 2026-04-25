import { Logger, SetArray } from "#structures";
import { pathToFileURL } from 'url';
import * as path from "node:path";
import fs from "node:fs";

/**
 * Абстрактный базовый класс для загрузки и управления модулями из директории.
 * Предназначен для динамической загрузки файлов (команд, плагинов, слушателей и т.п.)
 * с поддержкой «горячей» перезагрузки (удаление из кэша require).
 *
 * @typeParam T - Тип загружаемых объектов (по умолчанию unknown).
 *
 * @remarks
 * - Загрузка происходит синхронно через `fs.readdirSync` и `require`.
 * - После загрузки файла его кэш удаляется через `setImmediate`,
 *   что позволяет повторно загружать изменённые файлы при следующем вызове `load()`.
 * - Поддерживаются как одиночные экспорты, так и массивы экспортов.
 * - Если экспорт является классом (имеет `prototype`), создаётся экземпляр.
 * - Файлы с именами, начинающимися с `index` (например, `index.ts`), игнорируются.
 *
 * @example
 * ```ts
 * class CommandHandler extends handler<Command> {
 *   constructor() {
 *     super(path.join(__dirname, 'commands'));
 *   }
 *
 *   public reload() {
 *     this.load();
 *     console.log(`Loaded ${this.size} commands`);
 *   }
 * }
 * ```
 *
 * @public
 * @abstract
 */
export abstract class handler<T = unknown> {
    /**
     * Внутреннее хранилище загруженных объектов.
     * Используется `SetArray` для эффективного хранения уникальных элементов
     * с возможностью быстрой итерации.
     *
     * @private
     * @readonly
     */
    private readonly _files = new SetArray<T>();

    /**
     * Внутреннее хранилище загруженных объектов.
     * Используется `Map` для эффективного хранения уникальных элементов
     * с возможностью быстрой итерации.
     *
     * @public
     * @readonly
     */
    public readonly map = new Map<string, T>();

    /**
     * Возвращает коллекцию всех загруженных объектов (только для чтения).
     *
     * @protected
     */
    protected get files() {
        return this._files;
    };

    /**
     * Количество загруженных объектов.
     *
     * @public
     */
    public get size() {
        return this._files.size;
    };

    /**
     * Создаёт экземпляр загрузчика.
     *
     * @param directory - Путь к директории, из которой будут загружаться файлы.
     *                    Может быть относительным или абсолютным; будет нормализован через `path.resolve`.
     * @protected
     */
    protected constructor(private readonly directory: string) {
    };

    /**
     * @description Если произойдет ошибка при запуске
     * @param reason
     * @protected
     */
    protected onRunFail = (reason: string | Error) => {
        Logger.log(
            "ERROR",
            `Unhandled Execute Module | ${this.directory}\n` +
            `┌ Reason:  ${reason instanceof Error ? reason.message : String(reason)}\n` +
            `└ Stack:   ${reason instanceof Error ? reason.stack : "N/A"}`
        );
    };

    /**
     * Загружает все допустимые файлы из указанной директории (рекурсивно).
     * При повторном вызове очищает предыдущие загруженные объекты.
     *
     * @throws {Error} Если директория не существует.
     *
     * @remarks
     * Процесс загрузки:
     * 1. Очистка существующих объектов.
     * 2. Проверка существования директории.
     * 3. Рекурсивный обход файлов.
     * 4. Для каждого файла:
     *    - Проверка расширения (.ts или .js).
     *    - Игнорирование файлов с именем, начинающимся на `index`.
     *    - Вызов `_push` для загрузки модуля.
     *
     * @protected
     */
    protected load = () => {
        // Очистка предыдущей загрузки
        if (this.size > 0) {
            this.files.clear();
            this.map.clear();
        }

        const selfDir = path.resolve(this.directory);

        // Проверка существования директории
        if (!fs.existsSync(selfDir)) {
            return this.onRunFail(Error(`Directory not found: ${selfDir}`));
        }

        // Запуск рекурсивного обхода
        return this._loadRecursive(selfDir);
    };

    /**
     * Рекурсивно обходит директорию и добавляет все подходящие файлы.
     *
     * @param dirPath - Абсолютный путь к директории для обхода.
     *
     * @private
     */
    private _loadRecursive = async (dirPath: string) => {
        const entries = fs.readdirSync(dirPath, {withFileTypes: true});

        for (const entry of entries) {
            const fullPath = path.resolve(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Рекурсивный обход поддиректорий
                await this._loadRecursive(fullPath);
                continue;
            }

            if (entry.isFile()) {
                // Фильтрация по расширению
                if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) {
                    continue;
                }

                // Игнорирование индексных файлов (предполагается, что они являются точками входа)
                if (entry.name.startsWith("index")) {
                    continue;
                }

                await this._push(fullPath);
            }
        }
    };

    /**
     * Загружает конкретный файл через `require`, извлекает экспорт по умолчанию
     * и добавляет его в коллекцию.
     *
     * @param filePath - Абсолютный путь к файлу.
     *
     * @throws {Error} Если файл не содержит `export default`.
     *
     * @remarks
     * - Сразу после загрузки файла его кэш помечается на удаление через `setImmediate`,
     *   что позволяет при следующей загрузке получить актуальную версию.
     * - Если экспорт по умолчанию является массивом, каждый элемент обрабатывается индивидуально.
     * - Если экспорт является классом (определён `prototype`), создаётся экземпляр.
     * - В остальных случаях объект добавляется как есть.
     *
     * @private
     */
    private _push = async (filePath: string) => {
        const url = pathToFileURL(filePath).href;
        const imported = await import(url);

        if (!imported?.default) {
            return this.onRunFail(new Error(`Missing default export in ${filePath}`));
        }

        const defaultExport = imported.default;
        if (Array.isArray(defaultExport)) {
            for (const item of defaultExport) this._init(item);
        } else {
            this._init(defaultExport);
        }
    };

    /**
     * @author SNIPPIK
     * @description Инициализирует отдельный экспорт, определяя, является ли он классом или обычным объектом.
     *              Добавляет экземпляр/объект в коллекцию `_files` и, при наличии поля `name`, в карту `map`.
     * @param exported - Экспортируемая сущность (класс, объект, функция).
     * @remarks
     * - Классом считается функция-конструктор, имеющая `prototype` и не являющаяся `Function.prototype`.
     * - Если передан класс, создаётся его экземпляр через `new exported()`.
     * - Если передан обычный объект (в т.ч. функция не-конструктор), он добавляется как есть.
     * - При наличии у экземпляра/объекта строкового поля `name`, он также сохраняется в `this.map` для быстрого доступа по имени.
     * @private
     */
    private _init = (exported: any) => {
        // Проверка, является ли экспорт классом (конструктором):
        // - тип 'function'
        // - наличие свойства prototype (у классов и функций-конструкторов оно есть)
        // - не является встроенным Function.prototype (чтобы не путать с обычной функцией)
        const isClass = typeof exported === 'function' && exported.prototype && exported !== Function.prototype;

        if (isClass) {
            // Создаём экземпляр класса
            const instance = new exported();
            this._files.add(instance);
            // Сохраняем по имени, если оно определено (например, Command.name)
            if (instance.name) this.map.set(instance.name, instance);
        } else {
            // Обычный объект или функция – добавляем напрямую
            this._files.add(exported);
            // Если объект имеет строковое свойство "name", тоже сохраняем в карту
            if (exported?.["name"]) this.map.set(exported["name"], exported);
        }
    };
}