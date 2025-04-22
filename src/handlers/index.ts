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
     * @description Путь до директории
     * @readonly
     * @private
     */
    private readonly _dir: string = null;

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
    protected get files() { return this._files; };

    /**
     * @description Даем классу необходимые данные
     * @param directory - Имя директории
     * @protected
     */
    protected constructor(directory: string) {
        this._dir = directory;
    };

    /**
     * @description Загружаем директории полностью, за исключением index файлов
     * @protected
     */
    protected load = () => {
        const self_dir = path.resolve(this._dir);

        // Если указанной директории нет
        if (!fs.existsSync(self_dir)) throw new Error(`Not found dir ${self_dir}`);

        for (let dir of fs.readdirSync(self_dir)) {
            // Не загружаем index файлы (они являются загрузочными)
            if (dir.startsWith("index")) continue;

            // Если найдена директория
            else if (!dir.endsWith(".ts") && !dir.endsWith(".js")) {

                // Загружаем директорию
                for (let file of fs.readdirSync(path.resolve(`${self_dir}/${dir}`))) {
                    const res_path = path.resolve(`${self_dir}/${dir}/${file}`);
                    const self_file = require(res_path);

                    // Удаляем кеш загружаемого файла
                    delete require.cache[require.resolve(res_path)];

                    // Если нет импортируемых объектов
                    if (!self_file?.default) throw new Error(`Not found imported data in ${res_path}`);

                    const default_export = self_file.default;

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
        }
    };

    /**
     * @description Выгружаем директорию полностью
     * @protected
     */
    protected unload = () => {
        // Нечего выгружать
        if (!this._files.length) return;

        // Удаляем все загруженные файлы
        this.files.splice(0, this.files.length);
    };
}
