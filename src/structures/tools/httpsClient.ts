import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, RequestOptions } from "node:https";
import { URL } from "node:url";
import * as os from "node:os";

/**
 * @author SNIPPIK
 * @description Интерфейс с данными запроса
 * @interface RequestData
 */
export interface RequestData {
    url: string; // Полный URL
    method?: string; // HTTP-метод, по умолчанию "GET"
    headers?: Record<string, string>; // Заголовки
    body?: any; // Тело запроса (если применимо)
    maxRedirects?: number; // Максимальное количество редиректов
    validateStatus?: (statusCode: number) => boolean; // Проверка допустимости статус-кода
    userAgent?: string | boolean; // Пользовательский User-Agent
}

/**
 * @author SNIPPIK
 * @description Данные поступающие при head запросе
 * @interface httpsClient_head
 */
interface httpsClient_head {
    statusCode: number,
    statusMessage: string,
    headers: RequestData["headers"] & IncomingMessage | RequestData["headers"] | {},
}

/**
 * @author SNIPPIK
 * @description Генерация User-Agent строки, эмулирующей браузер
 * @private
 */
function generateUserAgent(): string {
    const platform = os.platform();
    const arch = os.arch();
    const nodeVersion = process.version;
    return `Mozilla/5.0 (${platform}; ${arch}) Node/${nodeVersion} httpsClient/1.1`;
}

/**
 * @author SNIPPIK
 * @description Класс HttpClient отправляет HTTP/HTTPS-запрос с автоматической обработкой ответа
 * @class httpsClient
 */
export class httpsClient {
    public constructor(private data: RequestData) {
        this.data.method = this.data?.method || 'GET';
        this.data.headers = this.data?.headers || {};
        this.data.maxRedirects = this.data.maxRedirects ?? 5;

        // Установим User-Agent, если передан
        if (this.data.userAgent !== undefined) {
            if (typeof this.data.userAgent === "string") this.data.headers['User-Agent'] = this.data.userAgent;
            else this.data.headers['User-Agent'] = generateUserAgent();
        }
    };

    /**
     * @description Берем данные из XML страницы
     * @public
     */
    public get toXML(): Promise<Error | string[]> {
        return new Promise(async (resolve) => {
            const body = await this.send() as string | Error;

            // Если была получена ошибка
            if (body instanceof Error) return resolve(Error("Not found XML data!"));

            // Ищем данные в XML странице для дальнейшего вывода
            const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
            const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
            return resolve(filtered.filter((text) => text.trim() !== ""));
        });
    };

    /**
     * @description Определяем, какую библиотеку использовать: http или https
     * @param url - Ссылка
     * @private
     */
    private getProtocol(url: string) {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    };

    /**
     * @description Проверка, нужно ли выполнить редирект
     * @param res - Исходный запрос
     * @private
     */
    private shouldRedirect(res: IncomingMessage): boolean {
        return (
            res.statusCode !== undefined &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            !!res.headers.location
        );
    };

    /**
     * @description Проверка, удовлетворяет ли статус ответа заданному условию
     * @param statusCode - Статус код
     * @private
     */
    private isStatusValid(statusCode: number): boolean {
        if (!this.data.validateStatus) return true;
        return this.data.validateStatus(statusCode);
    };

    /**
     * @description Метод HEAD-запроса, возвращающий только заголовки и статус
     * @public
     */
    public async head(): Promise<httpsClient_head> {
        this.data.method = "HEAD";
        const response = await this.send() as httpsClient_head;

        return {
            statusCode: (response && response.statusCode) || 0,
            statusMessage: response.statusMessage || "",
            headers: response && response.headers || {},
        };
    };

    /**
     * Метод отправки запроса с поддержкой редиректов и проверки статус-кода
     * @returns Promise с автоматически разобранным ответом: JSON, текст или Buffer
     * @public
     */
    public async send(currentRedirects = 0): Promise<any> {
        const { url, method, headers, body, maxRedirects } = this.data;
        const parsedUrl = new URL(url);

        const options: RequestOptions = {
            method,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            headers: headers,
        };

        return new Promise((resolve, reject) => {
            const req = this.getProtocol(url)(options, (res: IncomingMessage) => {
                // Обработка redirects (5xx)
                if (this.shouldRedirect(res)) {
                    if (currentRedirects >= (maxRedirects ?? 5)) return reject(new Error("Maximum number of redirects exceeded"));

                    const redirectUrl = new URL(res.headers.location!, parsedUrl).toString();
                    const newClient = new httpsClient({ ...this.data, url: redirectUrl });
                    return resolve(newClient.send(currentRedirects + 1));
                }

                // Проверка статус-кода
                if (!this.isStatusValid(res.statusCode || 0)) return reject(new Error(`Invalid response status: ${res.statusCode}`));

                // HEAD-запрос — сразу вернуть результат без чтения тела
                if (method === 'HEAD') return resolve({ statusCode: res.statusCode, headers: res.headers, statusMessage: res.statusMessage });

                let stream: IncomingMessage | ReturnType<typeof createGunzip> = res;

                // Распаковка, если ответ сжат
                const encoding = res.headers["content-encoding"];
                if (encoding === "gzip") stream = res.pipe(createGunzip());
                else if (encoding === "br") stream = res.pipe(createBrotliDecompress());
                else if (encoding === "deflate") stream = res.pipe(createInflate());

                const chunks: Uint8Array[] = [];
                stream.on("data", (chunk) => chunks.push(chunk));
                stream.on("end", () => {
                    const buffer = Buffer.concat(chunks);
                    const contentType = res.headers['content-type'] || '';

                    try {
                        // Автоопределение формата ответа по Content-Type
                        if (contentType.includes('application/json')) resolve(JSON.parse(buffer.toString('utf-8')));
                        else if (contentType.includes('text/')) resolve(buffer.toString('utf-8'));
                        else resolve(buffer); // бинарный контент
                    } catch (err) {
                        reject(new Error(`Error parsing response: ${err}`));
                    }
                });
                stream.on("error", (err) => reject(err));
            });

            req.on("error", (err) => reject(err));

            // Если есть тело — отправим его
            if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));

            req.end();
        });
    };
}

/**
 * @author SNIPPIK
 * @description Класс с утилитами для работы с HTTP/HTTPS
 * @class httpsStatusCode
 */
export class httpsStatusCode {
    /**
     * @description Парсинг статус кода
     * @static
     * @public
     */
    public static parse = ({statusCode, statusMessage}: httpsClient_head) => {
        // Допустимый статус код
        if (statusCode < 300 && statusCode >= 200) return null;

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