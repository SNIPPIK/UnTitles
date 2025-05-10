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
    private readonly _files: T[] = [];

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
        return this._files.length;
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
            this.files.splice(0, this.files.length);
        }

        const selfDir = path.resolve(this.directory);

        // Если указанной директории нет
        if (!fs.existsSync(selfDir)) {
            throw new Error(`Directory not found: ${selfDir}`);
        }

        const directories = fs.readdirSync(selfDir);
        for (const dir of directories) {
            // Не загружаем index файлы (они являются загрузочными)
            if (dir.startsWith("index")) continue;

            const isCodeFile = dir.endsWith(".ts") || dir.endsWith(".js");
            // Если не найдена директория
            if (isCodeFile) continue;

            const fullDirPath = path.resolve(selfDir, dir);
            const files = fs.readdirSync(fullDirPath);

            for (const file of files) {
                const resPath = path.resolve(fullDirPath, file);

                // Удаляем кеш загружаемого файла
                delete require.cache[require.resolve(resPath)];

                const imported = require(resPath);

                // Если нет импортируемых объектов
                if (!imported?.default) {
                    throw new Error(`Missing default export in ${resPath}`);
                }

                const default_export = imported.default;

                // Если полученные данные являются списком
                if (default_export instanceof Array) {
                    for (const obj of default_export) {
                        if (obj.prototype) this._files.push(new obj(null));
                        else this._files.push(obj);
                    }
                    continue;
                }

                // Если загружаемый объект является классом
                else if (default_export.prototype) {
                    this._files.push(new default_export(null));
                    continue;
                }

                // Добавляем файл в базу для дальнейшего экспорта
                this._files.push(default_export);
            }
        }
    };
}