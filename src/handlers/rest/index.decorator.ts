/**
 * @author SNIPPIK
 * @description Названия всех доступных платформ
 * @type RestAPIS_Names
 * @public
 */
export type RestAPIS_Names = "YOUTUBE" | "SPOTIFY" | "VK" | "YANDEX" | "SOUNDCLOUD" | "DEEZER";

/**
 * @author SNIPPIK
 * @description Параметры запроса
 * @interface RestOptions
 * @private
 */
interface RestOptions {
    readonly name: RestAPIS_Names;
    readonly url: string;
    readonly color: number;
    readonly audio: boolean;
    readonly auth?: string;
    readonly filter: RegExp;
}

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок запроса
 * @decorator
 * @public
 */
export function DeclareRest(options: RestOptions) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
            url = options.url;
            color = options.color;
            audio = options.audio;
            auth = options.auth;
            filter = options.filter;
        }
}

/**
 * @author SNIPPIK
 * @description Дополнительные параметры
 * @decorator
 * @public
 */
export function OptionsRest<T>(options: T) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            options = options;
        }
}