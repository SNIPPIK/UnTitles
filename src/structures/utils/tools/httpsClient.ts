import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
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
    /** Требуется, если был выполнен редирект */
    protected _redirect_url: string | null = null;

    /** Максимальное количество редиректов */
    private static readonly MAX_REDIRECTS = 5;

    /** Тайм-аут запроса по умолчанию */
    private static readonly REQUEST_TIMEOUT = 3e3;

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
        body?: string | Buffer;

        // Пользовательский User-Agent
        userAgent?: string | boolean;
    } & RequestOptions = {
        timeout: Request.REQUEST_TIMEOUT,
        sessionTimeout: Request.REQUEST_TIMEOUT,
        headers: {
            "Accept-Encoding": "gzip, deflate, br",
            "Priority": "u=5, i"
        }
    };

    /**
     * @description Выполняет HTTP/HTTPS-запрос.
     *
     * Поддерживает:
     * - HTTP/HTTPS;
     * - автоматические редиректы;
     * - относительные и абсолютные Location;
     * - ограничение количества редиректов;
     * - тайм-аут;
     * - POST/GET/HEAD/PATCH;
     * - передачу Buffer/string body;
     * - автоматическую установку Content-Length.
     *
     * @returns Promise<IncomingMessage | Error>
     */
    public get request(): Promise<IncomingMessage | Error> {
        this._redirect_url = null;

        return this._request(this.data, 0);
    }

    /**
     * @description Выполняет один HTTP-запрос с поддержкой редиректов.
     *
     * @param options - Параметры запроса
     * @param redirectCount - Текущее количество редиректов
     * @private
     */
    private _request(
        options: typeof this.data,
        redirectCount: number
    ): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
            if (redirectCount > Request.MAX_REDIRECTS) {
                resolve(new Error(
                    "[httpsClient]: Too many redirects"
                ));

                return;
            }

            const protocol = this.getProtocolRequest(options.protocol);

            let settled = false;

            /**
             * Гарантирует, что Promise будет завершён только один раз.
             */
            const finish = (result: IncomingMessage | Error) => {
                if (settled) return;

                settled = true;
                resolve(result);
            };

            const req = protocol(
                options,
                (res) => {
                    const status = res.statusCode ?? 0;
                    const location = res.headers.location;

                    /**
                     * ========================================================
                     * REDIRECT
                     * ========================================================
                     */

                    if (
                        location &&
                        status >= 300 &&
                        status < 400
                    ) {
                        let redirect: URL;

                        try {
                            const base =
                                `${options.protocol}//${options.hostname}` +
                                `${options.port ? `:${options.port}` : ""}`;

                            redirect = new URL(location, base);
                        } catch {
                            res.resume();

                            finish(new Error(
                                `[httpsClient]: Invalid redirect URL: ${location}`
                            ));

                            return;
                        }

                        /**
                         * Сохраняем последний URL редиректа.
                         */
                        this._redirect_url = redirect.href;

                        /**
                         * Полностью потребляем старый response.
                         */
                        res.resume();

                        /**
                         * Создаём новые options.
                         *
                         * Исходный объект не мутируем.
                         */
                        const nextOptions = {
                            ...options,

                            protocol: redirect.protocol,
                            hostname: redirect.hostname,

                            port: redirect.port
                                ? Number(redirect.port)
                                : redirect.protocol === "https:"
                                    ? 443
                                    : 80,

                            path:
                                redirect.pathname +
                                redirect.search
                        };

                        /**
                         * Следующий запрос получает тот же timeout,
                         * который был задан для исходного запроса.
                         */
                        this._request(
                            nextOptions,
                            redirectCount + 1
                        )
                            .then(finish)
                            .catch((error) => {
                                finish(
                                    error instanceof Error
                                        ? error
                                        : Error(String(error))
                                );
                            });

                        return;
                    }

                    /**
                     * ========================================================
                     * RESPONSE
                     * ========================================================
                     */

                    finish(res);
                });

            /**
             * ================================================================
             * TIMEOUT
             * ================================================================
             */

            req.setTimeout(
                options.timeout ?? Request.REQUEST_TIMEOUT,
                () => {
                    req.destroy(
                        new Error(
                            `[httpsClient]: Timeout ` +
                            `${options.hostname}:${options.port || 443}`
                        )
                    );
                }
            );

            /**
             * ================================================================
             * ERROR
             * ================================================================
             */

            req.once("error", (error: Error) => {
                /**
                 * Если это наш timeout — сохраняем
                 * нормальное сообщение.
                 */
                if (
                    error.message.startsWith(
                        "[httpsClient]: Timeout"
                    )
                ) {
                    finish(error);
                    return;
                }

                /**
                 * SSL / proxy ошибка.
                 */
                if (
                    error.message.includes(
                        "ssl3_get_record"
                    )
                ) {
                    finish(new Error(
                        "[httpsClient]: Failed proxy/SSL handshake"
                    ));

                    return;
                }

                finish(new Error(
                    `[httpsClient]: Error: ${error.message}`
                ));
            });

            /**
             * ================================================================
             * BODY
             * ================================================================
             */

            const method = options.method ?? "GET";

            if (
                options.body &&
                method !== "GET" &&
                method !== "HEAD"
            ) {
                const body = Buffer.isBuffer(options.body)
                    ? options.body
                    : Buffer.from(options.body);

                req.setHeader(
                    "Content-Length",
                    body.length
                );

                req.end(body);
                return;
            }

            /**
             * ================================================================
             * SEND
             * ================================================================
             */

            req.end();
        });
    }

    /**
     * @description Последняя ссылка перенаправления.
     * @public
     */
    public get redirect(): string | null {
        return this._redirect_url;
    }

    /**
     * @description Генерирует случайный User-Agent.
     * @private
     */
    private get generateRandomUserAgent(): string {
        const revision =
            Math.floor(Math.random() * 2) + 147;

        const OS = [
            "X11; Linux x86_64",
            "Windows NT 10.0; Win64; x64",
            "X11; Linux i686"
        ];

        const randomOS =
            OS[Math.floor(Math.random() * OS.length)];

        return (
            `Mozilla/5.0 (${randomOS}; rv:${revision}.0) ` +
            `Gecko/20100101 Firefox/${revision}.0`
        );
    }

    /**
     * @description Инициализация класса.
     *
     * @param options - Параметры HTTP-запроса
     * @constructor
     */
    public constructor(options: Request["data"]) {
        const {
            url,
            userAgent,
            agent,
            ...baseOptions
        } = options;

        if (!url) {
            throw new Error(
                "[httpsClient]: Not found URL"
            );
        }

        let parsedUrl: URL;

        try {
            parsedUrl = new URL(url);
        } catch {
            throw new TypeError(
                `[httpsClient] Invalid URL: ${url}`
            );
        }

        /**
         * ================================================================
         * HEADERS
         * ================================================================
         */

        const headers = {
            ...this.data.headers,
            ...baseOptions.headers
        };

        if (userAgent !== undefined) {
            headers["User-Agent"] =
                typeof userAgent === "string"
                    ? userAgent
                    : this.generateRandomUserAgent;
        }

        /**
         * ================================================================
         * FINAL OPTIONS
         * ================================================================
         */

        this.data = {
            ...this.data,
            ...baseOptions,

            agent,
            headers,

            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,

            path:
                parsedUrl.pathname +
                parsedUrl.search,

            port: parsedUrl.port
                ? Number(parsedUrl.port)
                : parsedUrl.protocol === "https:"
                    ? 443
                    : 80
        };
    }

    /**
     * @description Генерирует HTTP/HTTPS request функцию.
     * @private
     */
    private getProtocolRequest(protocol?: string) {
        return protocol === "https:"
            ? httpsRequest
            : httpRequest;
    }
}


/**
 * @author SNIPPIK
 * @description Создаем http или https запрос
 * @class httpsClient
 * @public
 */
export class httpsClient extends Request {
    /**
     * @description Выполняем HEAD-запрос.
     *
     * @returns Promise<httpsClient_head>
     * @public
     */
    public get toHead(): Promise<httpsClient_head> {
        this.data.method = "HEAD";

        return this.request.then((response) => {
            /**
             * Если получена ошибка.
             */
            if (response instanceof Error) {
                return {
                    statusCode: undefined,
                    statusMessage: response.message,
                    headers: {}
                };
            }

            /**
             * Полностью потребляем response.
             *
             * Это позволяет Node.js освободить/reuse socket.
             */
            response.resume();

            return {
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                headers:
                    response.headers as Record<
                        string,
                        string | string[]
                    >
            };
        });
    }

    /**
     * @description Получаем страницу в формате string.
     *
     * @returns Promise<string | Error>
     * @public
     */
    public get toString(): Promise<string | Error> {
        return this.request.then((res) => {
            if (res instanceof Error) {
                return res;
            }

            let stream: NodeJS.ReadableStream = res;

            switch (res.headers["content-encoding"]) {
                case "br":
                    stream = res.pipe(
                        createBrotliDecompress()
                    );
                    break;

                case "gzip":
                    stream = res.pipe(
                        createGunzip()
                    );
                    break;

                case "deflate":
                    stream = res.pipe(
                        createInflate()
                    );
                    break;
            }

            return new Promise<string | Error>((resolve) => {
                let text = "";

                stream.setEncoding("utf8");

                stream.on("data", (chunk) => {
                    text += chunk;
                });

                stream.once("end", () => {
                    resolve(text);
                });

                stream.once("error", (error) => {
                    resolve(
                        Error(error.message)
                    );
                });
            });
        });
    }

    /**
     * @description Получаем страницу в формате JSON.
     *
     * @returns Promise<json | Error>
     * @public
     */
    public get toJson(): Promise<json | Error> {
        return this.toString.then((body) => {
            if (body instanceof Error) {
                return body;
            }

            if (
                typeof body !== "string" ||
                body.trim().length === 0
            ) {
                return Error(
                    `Empty response body from ${this.data.hostname}`
                );
            }

            try {
                return JSON.parse(body);
            } catch {
                return Error(
                    `Invalid json response body at ${this.data.hostname}`
                );
            }
        });
    }

    /**
     * @description Берем данные из XML страницы.
     *
     * @returns Promise<string[] | Error>
     * @public
     */
    public get toXML() {
        return this.toString.then((body) => {
            if (body instanceof Error) {
                return body;
            }

            const items = body.match(
                /<[^<>]+>([^<>]+)<\/[^<>]+>/gi
            );

            if (!items) {
                return [];
            }

            return items
                .map((tag) =>
                    tag
                        .replace(
                            /<\/?[^<>]+>/gi,
                            ""
                        )
                        .trim()
                )
                .filter(
                    (text) => text.length > 0
                );
        }).catch((error) => {
            return [
                Error(
                    `[httpsClient]: ` +
                    `Unexpected error occurred during XML parsing: ${error}`
                )
            ];
        });
    }
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
        if (statusCode && statusCode < 400 && statusCode >= 200) return null;

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

        return Error(`[${statusCode || "Unknown"}]: ${statusMessage || "Unknown Error"}`);
    };
}