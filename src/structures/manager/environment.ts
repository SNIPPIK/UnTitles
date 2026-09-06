import path from "node:path";

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
export class Environment {
    private readonly cache = new Map<string, unknown>();

    /**
     * @description Загружаем env файл в процесс
     * @public
     */
    public constructor() {
        if (!("loadEnvFile" in process))
            throw new Error("Node.js >=22 required");

        try {
            if (typeof process.loadEnvFile === "function") {
                process.loadEnvFile(".env");
            }
        } catch (error) {
            const fullPath = path.dirname(__filename);
            throw Error(`[Environment] has not found .env file in directory ${fullPath}`);
        }
    };

    /**
     * @description Получаем значение из env файла
     * @param name - Имя параметра в env
     * @param safe - Этот параметр будет возращен если ничего нет
     * @public
     */
    public get<T = string>(name: string, safe?: EnvironmentOut<T>): EnvironmentOut<T> {
        const cached = this.cache.get(name);

        if (cached !== undefined)
            return cached as EnvironmentOut<T>;

        const env = process.env[name];

        // Если нет параметра в файле .env
        if (env === undefined) {
            // Если есть безопасный параметр, то передаем его вместо ошибки
            if (safe !== undefined) return safe;

            // Если нет <safe> параметра
            throw Error(`[Environment] Not found key ${name} in .env file`);
        }

        // Если параметр имеет правду
        if (["on", "true"].includes(env)) {
            this.cache.set(name, true);
            return true as EnvironmentOut<T>;
        }

        // Если параметр имеет ложь
        else if (["off", "false"].includes(env)) {
            this.cache.set(name, false);
            return false as EnvironmentOut<T>;
        }

        this.cache.set(name, env);
        // Если параметр имеет что-то другое
        return env as EnvironmentOut<T>;
    };
}

/**
 * @author SNIPPIK
 * @description Тип выходящего параметра env.get
 * @type EnvironmentOut
 */
type EnvironmentOut<T> = T;

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
export const env = new Environment();