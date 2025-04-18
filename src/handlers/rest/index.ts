import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {request as httpsRequest, RequestOptions} from "node:https";
import {IncomingMessage, request as httpRequest} from "node:http";





/**
 * @author SNIPPIK
 * @description Класс создающий запрос
 * @class Request
 * @abstract
 */
abstract class Request {
    /**
     * @description Данные хранимые для произведения запроса
     * @protected
     * @readonly
     */
    protected data: RequestData = { headers: {} };

    /**
     * @description Получаем протокол ссылки
     * @private
     */
    private get protocol() {
        return this.data.protocol.startsWith("https") ? httpsRequest : httpRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise<IncomingMessage | Error>((resolve) => {
            const request = this.protocol(this.data, (res) => {
                // Если надо сделать редирект на другой ресурс
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) {
                    this.data.path = res.headers.location;
                    return resolve(this.request);
                }

                return resolve(res);
            });

            // Если запрос POST, отправляем ответ на сервер
            if (this.data.method === "POST" && this.data.body) request.write(this.data.body);

            /**
             * @description Событие если подключение было сорвано
             */
            request.once("close", () => {
                this.data = null;
                request.removeAllListeners();
                request.destroy();
            });

            request.end();
        });
    };

    /**
     * @description Инициализируем класс
     * @param url - Ссылка
     * @param options - Опции
     * @public
     */
    public constructor(url: string, options?: httpsClient["data"]) {
        // Если ссылка является ссылкой
        if (url.startsWith("http")) {
            const {hostname, pathname, search, port, protocol} = new URL(url);

            // Создаем стандартные настройки
            Object.assign(this.data, {
                port, hostname, path: pathname + search, protocol
            });
        }

        // Если user-agent есть готовый
        if (typeof options?.useragent === "string") {
            Object.assign(this.data.headers, {
                "User-Agent": options.useragent
            });
        }

        // Надо ли генерировать user-agent
        else if (options?.useragent) {
            const OS = [ "X11; Linux x86_64;", "Windows NT 10.0; Win64; x64;" ];
            const platform = OS[(OS.length - 1).random(0)];
            const version = (136).random(120);

            Object.assign(this.data.headers, {
                "User-Agent": `Mozilla/5.0 (${platform} rv:${version}.0) Gecko/20100101 Firefox/${version}.0`,
            });
        }

        Object.assign(this.data, options);
    };
}

/**
 * @author SNIPPIK
 * @description Создаем http или https запрос
 * @class httpsClient
 * @public
 */
export class httpsClient extends Request {
    /**
     * @description Получаем страницу в формате string
     * @public
     */
    public get toString(): Promise<string | Error> {
        let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage, data = "";

        return new Promise<string | Error>((resolve) => {
            this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];

                // Делаем выбор расшифровщика UFT-8
                if (encoding === "br") decoder = res.pipe(createBrotliDecompress());
                else if (encoding === "gzip") decoder = res.pipe(createGunzip());
                else if (encoding === "deflate") decoder = res.pipe(createDeflate());
                else decoder = res;

                // Запускаем расшифровку
                decoder.setEncoding("utf-8")
                    .on("data", (chunk) => { data += chunk; })
                    .once("end", () => resolve(data));
            }).catch((err) => {
                return resolve(err);
            });
        });
    };

    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @public
     */
    public get toJson(): Promise<json | Error> {
        return this.toString.then((body) => {
            if (body instanceof Error) return body;

            try {
                return JSON.parse(body);
            } catch {
                return Error(`Invalid json response body at ${this.data.hostname}`);
            }
        });
    };

    /**
     * @description Берем данные из XML страницы
     * @public
     */
    public get toXML(): Promise<Error | string[]> {
        return new Promise((resolve) => {
            this.toString.then((body) => {
                // Если была получена ошибка
                if (body instanceof Error) return resolve(Error("Not found XML data!"));

                // Ищем данные в XML странице для дальнейшего вывода
                const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
                const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
                return resolve(filtered.filter((text) => text.trim() !== ""));
            });
        });
    };

    /**
     * @description Проверяем ссылку на работоспособность
     * @public
     */
    public get status(): Promise<boolean> {
        return this.request.then((resource) => {
            if (resource instanceof Error) return false;
            return resource?.statusCode && resource.statusCode >= 200 && resource.statusCode <= 400;
        });
    };
}

/**
 * @author SNIPPIK
 * @description Данные для произведения запроса
 * @interface RequestData
 * @private
 */
interface RequestData extends RequestOptions {
    // Метод запроса
    method?: "POST" | "GET" | "HEAD" | "PATCH";

    // Headers запроса
    headers?: RequestOptions["headers"];

    // Если мы хотим что-то отправить серверу
    body?: string;

    // Добавлять user-agent, рандомный или указанный
    useragent?: boolean | string;
}