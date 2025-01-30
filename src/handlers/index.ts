import {config, DotenvPopulateInput} from "dotenv";
import * as path from "node:path";
import fs from "node:fs";
import os from "node:os";

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


/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
class Environment {
    /**
     * @description Загружаем .env файл
     * @readonly
     * @private
     */
    private readonly _env = config();

    /**
     * @description Получаем значение
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly get = (name: keyof DotenvPopulateInput): any => {
        const env = this._env.parsed[name];

        // Если нет параметра в файле .env
        if (!env) throw new Error(`[ENV]: Not found ${name} in .env`);

        // Проверяем параметр для конвертации
        return env === "true" ? true : env === "false" ? false : env;
    };

    /**
     * @description Обновляем данные в env (не работает на некоторых хостингах)
     * @param key {string} Имя
     * @param value {string} значение
     * @readonly
     * @public
     */
    public readonly set = (key: string, value: string): void => {
        // Открываем файл env в array
        const envFile = fs.readFileSync(".env", "utf8").split(os.EOL);

        // Ищем имя
        const target = envFile.indexOf(
            envFile.find((line) => line.match(new RegExp(key))),
        );

        // Обновляем данные
        envFile.splice(target, 1, `${key}="${value}"`);

        try {
            // Сохраняем файл
            fs.writeFileSync(".env", envFile.join(os.EOL));

            // Обновляем env
            setImmediate(() => require("dotenv").config());
        } catch (e) {
            throw `[ENV]: Fail save >${key}< to .env`;
        }
    };

    /**
     * @description Проверяем есть ли данные
     * @param name {string} Имя
     * @readonly
     * @public
     */
    public readonly check = (name: string) => {
        const env = this._env.parsed[name];

        return !(!env || env === "undefined");
    };
}


/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 */
export const env = new Environment();