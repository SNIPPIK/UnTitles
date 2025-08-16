import { SetArray } from "#structures";
import * as path from "node:path";
import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Класс для загрузки директорий и их перезагрузки
 * @class handler
 * @abstract
 * @public
 */
export abstract class handler<T = unknown> {
    /**
     * @description Загруженные файлы, именно файлы не пути к файлам
     * @readonly
     * @private
     */
    private readonly _files = new SetArray<T>();

    /**
     * @description Выдаем все загруженные файлы
     * @protected
     */
    protected get files() {
        return this._files;
    };

    /**
     * @description Кол-во загруженных элементов
     * @public
     */
    public get size() {
        return this._files.size;
    };

    /**
     * @description Даем классу необходимые данные
     * @param directory - Имя директории
     * @protected
     */
    protected constructor(private readonly directory: string) {};

    /**
     * @description Загружаем директории полностью, за исключением index файлов
     * @protected
     */
    protected load = () => {
        // Если есть загруженные файлы
        if (this.size > 0) {
            // Удаляем все загруженные файлы
            this.files.clear();
        }

        const selfDir = path.resolve(this.directory);

        // Если нет такой директории
        if (!fs.existsSync(selfDir)) throw new Error(`Directory not found: ${selfDir}`);

        // Загружаем директорию
        this._loadRecursive(selfDir);
    };

    /**
     * @description Поиск файлов загрузки
     * @param dirPath - Путь до директории
     */
    private _loadRecursive = (dirPath: string) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.resolve(dirPath, entry.name);

            // Если это еще одна директория
            if (entry.isDirectory()) this._loadRecursive(fullPath);

            // Если это файл
            else if (entry.isFile()) {
                // Если это не файл ts или js
                if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;

                // Не загружаем index файлы (они являются загрузочными)
                if (entry.name.startsWith("index")) continue;

                this._push(fullPath);
            }
        }
    };

    /**
     * @description Добавляем загруженный файл в коллекцию файлов
     * @param path - Путь до файла
     */
    private _push = (path: string) => {
        const imported: { default?: T } | json = require(path);

        // Удаляем кеш загружаемого файла
        delete require.cache[require.resolve(path)];

        // Если нет импортируемых объектов
        if (!imported?.default) throw new Error(`Missing default export in ${path}`);

        const default_export = imported.default;

        // Если полученные данные являются списком
        if (default_export instanceof Array) {
            for (const obj of default_export) {
                if (obj.prototype) this._files.add(new obj(null));
                else this._files.add(obj);
            }
            return;
        }

        // Если загружаемый объект является классом
        else if (default_export.prototype) {
            this._files.add(new default_export(null));
            return;
        }

        // Добавляем файл в базу для дальнейшего экспорта
        this._files.add(default_export);
    };
}