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
 * @description Упрощение проверки загрузки библиотек
 * @class LoaderLibs
 * @abstract
 * @public
 */
export abstract class LoaderLibs<T = unknown> {
    /**
     * @description Данные для загрузки библиотеки
     * @private
     */
    protected readonly self: { libs: lib_exec<T>; current: T; };

    /**
     * @description Выдаем найденную библиотеку
     * @public
     */
    public get lib() { return this.self.current; };

    /**
     * @description Имена библиотек
     * @public
     */
    public get names() { return Object.keys(this.self.libs); };

    /**
     * @description Проверка библиотек на наличие в системе
     * @protected
     */
    protected check = async () => {
        // Удаляем мусорные данные
        setImmediate(() => { this.self.libs = null; });

        for (const name of this.names) {
            try {
                const library = require(name);

                // Если библиотеке надо сообщить о подготовке
                if (library?.ready) await library.ready;

                // Записываем библиотеку в базу для работы с библиотекой
                Object.assign(this.self.current, this.self.libs[name](library));
                delete require.cache[require.resolve(name)];
                return true;
            } catch {}
        }

        return false;
    };
}

/**
 * @description Поддерживаемый запрос к библиотеке
 * @type supported
 */
export type lib_exec<T> = {
    [name: string]: (lib: any) => T
}


/**
 * @author SNIPPIK
 * @description Тип выходящего параметра env.get
 */
type EnvironmentExit<T> = T extends boolean ? T : T extends string ? T : never;

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
     * @param name - Имя параметра в env
     * @param safe - Этот параметр будет возращен если ничего нет
     * @public
     */
    public get<T = string>(name: keyof DotenvPopulateInput, safe?: EnvironmentExit<T>): EnvironmentExit<T> {
        const env = this._env.parsed[name];

        // Если нет параметра в файле .env
        if (!env) {
            if (safe !== undefined) return safe;

            // Если нет <safe> параметра
            throw new Error(`[ENV]: Not found ${name} in .env`);
        }

        // Если параметр имеет правду
        if (["on", "true"].includes(env)) return true as EnvironmentExit<T>;

        // Если параметр имеет ложь
        else if (["off", "false"].includes(env)) return false as EnvironmentExit<T>;

        // Если параметр имеет что-то другое
        return env as EnvironmentExit<T>;
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