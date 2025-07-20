import { BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip } from "node:zlib";
import { request as httpsRequest, RequestOptions } from "node:https";
import { IncomingMessage, request as httpRequest } from "node:http";

/**
 * @author SNIPPIK
 * @description Данные поступающие при head запросе
 * @interface httpsClient_head
 */
export interface httpsClient_head {
    // Статус код
    statusCode: number;

    // Статус сообщение
    statusMessage: string;

    // Заголовки
    headers: Record<string, string | string[]>;
}

/**
 * @author SNIPPIK
 * @description Класс создающий запрос нативно
 * @class Request
 * @abstract
 */
abstract class Request {
    /**
     * @description Данные для создания запроса
     * @protected
     */
    protected readonly data: {
        url?: string;

        method?: "POST" | "GET" | "HEAD" | "PATCH";

        // Headers запроса
        headers?: RequestOptions["headers"];

        // Если мы хотим что-то отправить серверу
        body?: string;

        // Пользовательский User-Agent
        userAgent?: string | boolean;
    } & RequestOptions = {
        headers: {}
    };

    /**
     * @description Получаем протокол ссылки
     * @returns httpsRequest | httpRequest
     * @private
     */
    private get protocol() {
        const protocol = this.data.protocol?.split(":")[0];
        return protocol === "https" ? httpsRequest : httpRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @return Promise<IncomingMessage | Error>
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
            const request = this.protocol(this.data, (res) => {

                // Если есть редирект куда-то
                if (res.headers?.location) {
                    if ((res.statusCode >= 300 && res.statusCode < 400)) {
                        this.data.path = res.headers.location;
                        return resolve(this.request);
                    }
                }

                return resolve(res);
            });

            // Если запрос POST, отправляем ответ на сервер
            if (this.data.method === "POST" && this.data.body) request.write(this.data.body);

            /**
             * @description Если превышено время ожидания
             */
            request.once("timeout", () => {
                return resolve(Error(`[httpsClient]: Connection Timeout Exceeded ${this.data.url}:443`))
            });

            /**
             * @description Если получена ошибка
             */
            request.once("error", (err) => {
                return resolve(Error(`[httpsClient]: Connection Error: ${err}`))
            });

            /**
             * @description Если запрос завершен
             */
            request.once("end", () => {
                request.removeAllListeners();
            });

            request.end();
        });
    };

    /**
     * @description Инициализируем класс
     * @param options - Опции
     * @constructor
     * @public
     */
    public constructor(options: httpsClient["data"]) {
        // Если ссылка является ссылкой
        if (options.url.startsWith("http")) {
            const {hostname, pathname, search, port, protocol} = new URL(options.url);

            //Создаем стандартные настройки
            Object.assign(this.data, {
                port, hostname, path: pathname + search, protocol
            });
        }

        // Надо ли генерировать user-agent
        if (options?.userAgent !== undefined) {
            // Если указан свой user-agent
            if (typeof options?.userAgent === "string") {
                Object.assign(this.data.headers, {
                    "User-Agent": options.userAgent
                });

                // Генерируем новый
            } else {
                const revision = `${(140).random(120)}.0`;
                const OS = ["(X11; Linux x86_64;", "(Windows NT 10.0; Win64; x64;"];

                Object.assign(this.data.headers, {
                    "User-Agent": `Mozilla/5.0 ${OS[(OS.length - 1).random(0)]} rv:${revision}) Gecko/20100101 Firefox/${revision}`,
                    "Sec-Ch-Ua-Full-Version": `Firefox/${revision}`,
                    "Sec-Ch-Ua-Bitness": `64`,
                    "Sec-Ch-Ua-Arch": "x86",
                    "Sec-Ch-Ua-Mobile": "?0"
                });
            }
        }

        options.url = null;
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
     * @description Выполняем HEAD-запрос — получаем только заголовки
     * @returns Promise<httpsClient_head>
     * @public
     */
    public get toHead(): Promise<httpsClient_head> {
        return new Promise(async (resolve) => {
            this.request.then((response) => {
                if (response instanceof Error) {
                    return resolve({
                        statusCode: undefined,
                        statusMessage: `${response}`,
                        headers: {}
                    });
                }


                return resolve({
                    statusCode: response.statusCode === 400 && response.statusMessage === "Bad Request" ? 200 : response.statusCode,
                    statusMessage: response.statusMessage,
                    headers: response.headers,
                });
            });
        });
    };

    /**
     * @description Получаем страницу в формате string
     * @returns Promise<string | Error>
     * @public
     */
    public get toString(): Promise<string | Error> {
        return new Promise((resolve) => {
            this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];
                let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage = res, data = "";

                if (encoding === "br") decoder = res.pipe(createBrotliDecompress()  as any);
                else if (encoding === "gzip") decoder = res.pipe(createGunzip()     as any);
                else if (encoding === "deflate") decoder = res.pipe(createDeflate() as any);

                decoder.setEncoding("utf-8").on("data", (c) => data += c).once("end", () => {
                    setImmediate(() => {
                        data = null;
                        decoder.removeAllListeners();
                        decoder.destroy();
                    });

                    return resolve(data);
                });
            }).catch((err) => {
                return resolve(err);
            });
        });
    };

    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @returns Promise<json | Error>
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
     * @returns Promise<string[] | Error>
     * @public
     */
    public get toXML(): Promise<Error | string[]> {
        return new Promise(async (resolve) => {
            const body = await this.toString;

            if (body instanceof Error) return resolve(Error("Not found XML data!"));

            const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
            const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
            return resolve(filtered.filter((text) => text.trim() !== ""));
        })
    };
}

/**
 * @author SNIPPIK
 * @description Парсинг статус-кода и возврат ошибки
 * @class httpsStatusCode
 */
export class httpsStatusCode {
    /**
     * @description Парсинг статус кода, возвращает Error или null
     * @returns Error
     * @public
     */
    public static parse = ({ statusCode, statusMessage }: httpsClient_head): Error | null => {
        if (statusCode < 400 && statusCode >= 200) return null;

        // Статус коды
        switch (statusCode) {
            case 400:
                return Error(`[400]: The server could not understand the request due to incorrect syntax`);
            case 401:
                return Error(`[401]: Authentication required, but data provided is incorrect or missing`);
            case 402:
                return Error(`[402]: Payment is required to access the requested resource`);
            case 403:
                return Error(`[403]: Access forbidden due to restrictions`);
        }

        // Если неизвестный статус код
        return Error(`[${statusCode}]: ${statusMessage}`);
    };
}
