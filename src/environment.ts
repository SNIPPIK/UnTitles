import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
export class Environment {
    /**
     * @description Загружаем env файл в процесс
     * @public
     */
    public constructor() {
        try {
            if (fs.existsSync("node_modules/dotenv")) {
                const dotenv = require('dotenv');
                if (dotenv) dotenv.config();
                return;
            }

            process.loadEnvFile(".env");
        } catch (error) {
            const path = __dirname.split("/");
            throw new Error(`[Environment] has not found .env file in directory ${path.splice(path.length, 1).join("/")}`);
        }
    };

    /**
     * @description Получаем значение из env файла
     * @param name - Имя параметра в env
     * @param safe - Этот параметр будет возращен если ничего нет
     * @public
     */
    public get<T = string>(name: string, safe?: EnvironmentOut<T>): EnvironmentOut<T> {
        const env = process.env[name];

        // Если нет параметра в файле .env
        if (!env) {
            if (safe !== undefined) return safe;

            // Если нет <safe> параметра
            throw new Error(`[Environment] Not found key ${name} in .env file`);
        }

        // Если параметр имеет правду
        if (["on", "true"].includes(env)) return true as EnvironmentOut<T>;

        // Если параметр имеет ложь
        else if (["off", "false"].includes(env)) return false as EnvironmentOut<T>;

        // Если параметр имеет что-то другое
        return env as EnvironmentOut<T>;
    };
}

/**
 * @author SNIPPIK
 * @description Тип выходящего параметра env.get
 * @type EnvironmentOut
 */
type EnvironmentOut<T> = T extends boolean ? T : T extends string ? T : T extends number ? string : never;

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
export var env: Environment;

/**
 * @author SNIPPIK
 * @description Инициализация .env файла
 * @private
 */
(() => {
    if (env) return;

    try {
        env = new Environment();
    } catch (err) {
        throw new Error(`Fail init environment: ${err}`);
    }
})();