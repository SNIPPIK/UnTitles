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
    protected _redirect_url = null;

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
        //minVersion: 'TLSv1.2',
        //maxVersion: 'TLSv1.3',

        // Crypto
        //ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
        //sigalgs: 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256',
    };

    /**
     * @description Получаем протокол ссылки
     * @returns httpsRequest | httpRequest
     * @private
     */
    private get protocol() {
        const protocol = this.data.protocol;
        return protocol === "https:" ? httpsRequest : httpRequest;
    };

    /**
     * Выполняет HTTP/HTTPS-запрос с поддержкой автоматического следования редиректам (до 5).
     * Возвращает Promise с объектом `IncomingMessage` (ответ сервера).
     *
     * @remarks
     * - Метод учитывает настройки из `this.data` (метод, заголовки, тело, тайм-аут и т.д.).
     * - При получении статуса 3xx (редирект) из заголовка `Location` формируется новый запрос.
     * - Тело запроса отправляется только для методов, отличных от GET и HEAD.
     * - Устанавливается заголовок `Content-Length` автоматически.
     * - Тайм-аут соединения отслеживается через событие `timeout`.
     * - При любой ошибке или превышении лимита редиректов Promise отклоняется.
     *
     * @returns Promise, который разрешается объектом ответа или отклоняется с ошибкой.
     *
     * @throws {Error} При слишком большом количестве редиректов (>5).
     * @throws {Error} При некорректном URL редиректа.
     * @throws {Error} При превышении времени ожидания соединения.
     * @throws {Error} При ошибке соединения (сеть, DNS, SSL).
     *
     * @example
     * ```ts
     * const client = new HttpsClient({ hostname: 'api.example.com', path: '/data' });
     * const response = await client.request;
     * console.log(response.statusCode);
     * ```
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
            const options = { ...this.data };

            /**
             * Рекурсивная функция для выполнения запроса с обработкой редиректов.
             * @param opts - Опции запроса (hostname, path, method, headers и т.д.)
             * @param redirectCount - Текущее количество выполненных редиректов
             */
            const makeRequest = (opts: typeof options, redirectCount = 0) => {
                // Защита от бесконечных циклов редиректов (RFC позволяет не более 5)
                if (redirectCount > 5) {
                    return resolve(new Error(`[httpsClient]: Too many redirects`));
                }

                // Создаём запрос с использованием протокола (http/https)
                const req = this.protocol(opts, (res) => {
                    // Проверяем, является ли ответ редиректом и есть ли заголовок Location
                    if (res.headers.location) {
                        const newUrl = res.headers.location;

                        let newOptions = { ...opts };

                        // Парсим новый URL, чтобы извлечь hostname, protocol, path, port
                        try {
                            const parsedUrl = new URL(newUrl);

                            newOptions.hostname = parsedUrl.hostname;
                            newOptions.protocol = parsedUrl.protocol;
                            newOptions.path = parsedUrl.pathname + parsedUrl.search;
                            newOptions.port = parsedUrl.port;

                            this._redirect_url = `${parsedUrl.href}`;
                        } catch (e) {
                            return resolve(new Error(`[httpsClient]: Invalid redirect URL: ${newUrl}`));
                        }

                        // Повторяем запрос с новыми опциями, увеличивая счётчик редиректов
                        return makeRequest(newOptions, redirectCount++);
                    }

                    // Не редирект – возвращаем ответ
                    resolve(res);
                });

                // Если в опциях есть тело и метод не GET/HEAD, отправляем тело
                if (opts.body && opts.method !== "GET" && opts.method !== "HEAD") {
                    const body =
                        typeof opts.body === "string"
                            ? Buffer.from(opts.body)
                            : opts.body;

                    // Устанавливаем заголовок Content-Length (обязателен для некоторых серверов)
                    req.setHeader("Content-Length", body.length);
                    req.write(body);
                }

                // Обработка тайм-аута соединения (например, если сервер не отвечает)
                req.once("timeout", () => {
                    req.destroy();
                    resolve(
                        new Error(
                            `[httpsClient]: Connection Timeout Exceeded ${opts.hostname}:${opts.port || 443}`
                        )
                    );
                });

                // Обработка ошибок сокета (ECONNRESET, ENOTFOUND и т.п.)
                req.once("error", (err) => {
                    if (err?.name?.match(/routines:ssl3_get_record:decryption/)) throw new Error("Failed to connect to Proxy!");

                    req.destroy();
                    resolve(
                        new Error(
                            `[httpsClient]: Connection Error: ${err.message}`
                        )
                    );
                });

                // Завершаем запрос (отправляем заголовки и тело, если не отправлено ранее)
                req.end();
            };

            // Начинаем запрос
            makeRequest(options);
        });
    };

    /**
     * @description Последняя ссылка перенаправления
     * @public
     */
    public get redirect() {
        return this._redirect_url;
    };

    /**
     * Генерирует случайный User-Agent (Firefox на Linux/Windows)
     * @private
     */
    private get generateRandomUserAgent(): string {
        // Генерируем новый User-Agent
        const revision = Math.floor(Math.random() * 2) + 145; // Генерация числа около 140
        const OS = ["X11; Linux x86_64", "Windows NT 10.0; Win64; x64", "X11; Linux i686"];
        const randomOS = OS[Math.floor(Math.random() * OS.length)];

        return `Mozilla/5.0 (${randomOS}; rv:${revision}.0) Gecko/20100101 Firefox/${revision}.0`;
    };

    /**
     * @description Инициализируем класс
     * @param options - Опции
     * @constructor
     * @public
     */
    public constructor(options: httpsClient["data"]) {
        // Извлекаем url и userAgent отдельно, остальное сохраняем как переопределяемые поля
        const { url, userAgent, agent, ...baseOptions } = options;

        // Парсим URL и получаем компоненты (если URL передан)
        let urlComponents: Partial<Pick<httpsClient["data"], "hostname" | "protocol" | "path" | "port">> = {};
        if (url) {
            try {
                const parsed = new URL(url);
                urlComponents = {
                    protocol: parsed.protocol,
                    hostname: parsed.hostname,
                    path: parsed.pathname + parsed.search,
                    port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                };
            } catch {
                // URL невалидный – выбрасываем ошибку, чтобы избежать неопределённого поведения
                throw new TypeError(`[httpsClient] Invalid URL: ${url}`);
            }
        } else {
            throw new Error("[httpsClient]: Not found URL");
        }

        // Готовим заголовки: базовые + User-Agent
        const headers = { ...this.data.headers, ...baseOptions.headers };

        if (userAgent !== undefined) {
            // вынесено в отдельный метод
            headers["User-Agent"] = typeof userAgent === "string" ? userAgent : this.generateRandomUserAgent;
        }

        // Формируем финальный объект data:
        //    - сначала значения по умолчанию из this.data
        //    - затем компоненты URL (если есть)
        //    - затем явные поля из baseOptions (включая headers)
        //    - agent передаётся отдельно: если не указан – создаём новый
        this.data = {
            ...this.data,
            ...urlComponents,
            ...baseOptions,
            agent,
            headers,
        };
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

        return new Promise(async (resolve) => {
            const response = await this.request;

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
        return new Promise((resolve) => {
            this.toString.then((body) => {
                if (body instanceof Error) return resolve(body);

                try {
                    // Добавляем проверку на пустой/короткий body
                    if (typeof body !== 'string' || body.trim().length === 0) {
                        return resolve(Error(`Empty response body from ${this.data.hostname}`));
                    }

                    return resolve(JSON.parse(body));
                } catch {
                    return resolve(Error(`Invalid json response body at ${this.data.hostname}`));
                }
            }).catch((err) => {
                return resolve(err);
            });
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