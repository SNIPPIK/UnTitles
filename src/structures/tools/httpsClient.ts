import { BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip } from "node:zlib";
import { request as httpsRequest, RequestOptions } from "node:https";
import { IncomingMessage, request as httpRequest } from "node:http";

/**
 * @author SNIPPIK
 * @description Данные поступающие при head запросе
 * @interface httpsClient_head
 * @public
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
    protected data: {
        url?: string;

        method?: "POST" | "GET" | "HEAD" | "PATCH";

        // Headers запроса
        headers?: RequestOptions["headers"];

        // Если мы хотим что-то отправить серверу
        body?: string;

        // Пользовательский User-Agent
        userAgent?: string | boolean;
    } & RequestOptions = {
        timeout: 5e3,
        headers: {
            "Accept-Encoding": "gzip, deflate, br"
        },
        maxVersion: "TLSv1.3"
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
            // Клонируем данные, чтобы избежать изменения опций при параллельных запросах
            const options = { ...this.data };

            const req = this.protocol(options, (res) => {

                // Более строгая проверка редиректа.
                // Возврат resolve(this.request) запускает новый запрос, что правильно для автоматического редиректа.
                if (res.headers.location && (res.statusCode >= 300 && res.statusCode < 400)) {
                    // Создаем новый объект данных на основе старого + новый путь
                    const newUrl = res.headers.location;

                    // Повторный парсинг URL для корректного обновления всех полей (hostname, protocol, path, port)
                    try {
                        const parsedUrl = new URL(newUrl);
                        this.data.hostname = parsedUrl.hostname;
                        this.data.protocol = parsedUrl.protocol;
                        this.data.path = parsedUrl.pathname + parsedUrl.search;
                        this.data.port = parsedUrl.port;
                    } catch (e) {
                        // Если редирект на некорректный URL, возвращаем ошибку
                        return resolve(Error(`[httpsClient]: Invalid redirect URL: ${newUrl}`));
                    }

                    // Возвращаем промис нового запроса, чтобы продолжить цепочку
                    return this.request.then(resolve).catch(resolve);
                }

                return resolve(res);
            });

            // Обработка POST/PUT/PATCH (если есть body)
            if (options.body) {
                // Если body — строка, можно установить заголовок Content-Length
                if (typeof options.body === "string") {
                    req.setHeader("Content-Length", Buffer.byteLength(options.body).toString());
                    req.write(options.body);
                }
            }

            req.once("timeout", () => {
                req.destroy(); // Уничтожаем запрос при таймауте
                return resolve(Error(`[httpsClient]: Connection Timeout Exceeded ${options.hostname}:${options.port || 443}`));
            });

            req.once("error", (err) => {
                req.destroy(); // Уничтожаем запрос при ошибке
                return resolve(Error(`[httpsClient]: Connection Error: ${err.message}`));
            });

            req.end();
        });
    };

    /**
     * @description Инициализируем класс
     * @param options - Опции
     * @constructor
     * @public
     */
    public constructor(options: httpsClient["data"]) {
        let parsedUrl: URL | undefined;

        // Проверяем, является ли это корректным URL, используя try/catch с URL
        try {
            parsedUrl = new URL(options.url);
        } catch (e) {
            // Если URL не корректен, можно выбросить ошибку
            console.error(`[httpsClient]: Invalid URL provided: ${options.url}`);
        }

        // Применяем стандартные настройки и настройки из URL
        if (parsedUrl) {
            this.data = {
                ...this.data,
                hostname: parsedUrl.hostname,
                protocol: parsedUrl.protocol,
                path: parsedUrl.pathname + parsedUrl.search,
                port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
            };
        }

        // Устанавливаем User-Agent
        if (options.userAgent !== undefined) {
            let ua: string;

            if (typeof options.userAgent === "string") ua = options.userAgent;
            else {
                // Генерируем новый User-Agent
                const revision = Math.floor(Math.random() * 2) + 140; // Генерация числа около 140
                const OS = ["X11; Linux x86_64", "Windows NT 10.0; Win64; x64", "X11; Linux i686"];
                const randomOS = OS[Math.floor(Math.random() * OS.length)];

                ua = `Mozilla/5.0 (${randomOS}; rv:${revision}.0) Gecko/20100101 Firefox/${revision}.0`;
            }

            this.data.headers = { ...this.data.headers, "User-Agent": ua };
        }

        // Чистое объединение опций: сначала удаляем, потом объединяем.
        const { url, userAgent, ...restOptions } = options;
        this.data = { ...this.data, ...restOptions };
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
        this.data.method = "HEAD";

        return new Promise((resolve) => {
            this.request.then((response) => {

                // Если получена ошибка
                if (response instanceof Error) {
                    return resolve({
                        statusCode: undefined,
                        statusMessage: `${response}`,
                        headers: {}
                    });
                }

                return resolve({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage,
                    headers: response.headers as Record<string, string | string[]>
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
                let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage = res;

                if (encoding === "br") decoder = res.pipe(createBrotliDecompress()  as any);
                else if (encoding === "gzip") decoder = res.pipe(createGunzip()     as any);
                else if (encoding === "deflate") decoder = res.pipe(createDeflate() as any);

                const chunks: string[] = [];
                decoder.setEncoding("utf-8")
                    .on("data", (c: string) => chunks.push(c))
                    .once("end", () => resolve(chunks.join("")))
                    .once("error", (err) => resolve(Error(`[httpsClient]: Decoding Error: ${err.message}`)));
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
                // Добавляем проверку на пустой/короткий body
                if (typeof body !== 'string' || body.trim().length === 0) {
                    return Error(`Empty response body from ${this.data.hostname}`);
                }

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
            try {
                const body = await this.toString;

                // Если при получении страниц произошла ошибка
                if (body instanceof Error) return resolve(body);

                // Более строгий и эффективный RegExp для извлечения текста между тегами
                // Регулярное выражение: /<[^<>]+>([^<>]+)<\/[^<>]+>/g
                const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/gi);

                // Если нет данных xml в странице
                if (!items) return resolve([]);

                // ⚡️ Ускорение: Используем map с try/catch для обработки ошибок парсинга
                const filtered = items
                    .map(tag => tag.replace(/<\/?[^<>]+>/gi, "").trim())
                    .filter(text => text.length > 0); // Проверка на пустую строку через length

                return resolve(filtered);
            } catch (error) {
                return resolve(Error(`[httpsClient]: Unexpected error occurred during XML parsing: ${error}`));
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Парсинг статус-кода и возврат ошибки
 * @class httpsStatusCode
 * @public
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