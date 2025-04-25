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
            process.loadEnvFile(".env");
        } catch (error) {
            const path = __dirname.split("/");
            throw new Error(`[ENV] has not found .env file in directory ${path.splice(path.length, 1).join("/")}`);
        }
    };

    /**
     * @description Получаем значение
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
            throw new Error(`[ENV] Not found ${name} in .env`);
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