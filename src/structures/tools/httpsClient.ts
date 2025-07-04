import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { request } from "undici";
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
    validateStatus?: (statusCode: number) => boolean; // Проверка допустимости статус-кода
    userAgent?: string | boolean; // Пользовательский User-Agent
}

/**
 * @author SNIPPIK
 * @description Данные поступающие при head запросе
 * @interface httpsClient_head
 */
export interface httpsClient_head {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string | string[]>;
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
    return `Mozilla/5.0 (${platform}; ${arch}) Node/${nodeVersion} httpsClient/2.0`;
}

/**
 * @author SNIPPIK
 * @description Класс для обработки HTTP/HTTPS-запросов с поддержкой undici
 * @class httpsClient
 * @public
 */
export class httpsClient {
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

    public constructor(private readonly data: RequestData) {
        data.method = data?.method || "GET";
        data.headers = data?.headers || {};

        if (data.userAgent !== undefined) {
            if (typeof data.userAgent === "string") data.headers["user-agent"] = data.userAgent;
            else data.headers["user-agent"] = generateUserAgent();
        }

        this.data = data;
    }

    /**
     * @description Выполняем HEAD-запрос — получаем только заголовки
     * @public
     */
    public async head(): Promise<httpsClient_head> {
        this.data.method = "HEAD";
        const response = await this.send();

        return {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
        };
    }

    /**
     * @description Отправка HTTP/HTTPS-запроса с поддержкой редиректов и автоматического парсинга ответа
     * @returns Promise<any>
     * @public
     */
    public async send(): Promise<any> {
        const { url, method, headers, body } = this.data;

        const res = await request(url, {
            body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
            maxRedirections: 5,
            method,
            headers
        });

        const { statusCode, headers: resHeaders } = res;

        // HEAD-запрос — сразу вернуть результат без чтения тела
        if (method === "HEAD")  return { statusCode, headers: resHeaders, statusMessage: res?.["statusMessage"] };

        if (this.data.validateStatus && !this.data.validateStatus(statusCode))
            throw new Error(`Invalid response status: ${statusCode}`);

        let stream = res.body as any;

        // Распаковка, если ответ сжат
        const encoding = resHeaders["content-encoding"];
        if (encoding === "gzip") stream = stream.pipe(createGunzip());
        else if (encoding === "br") stream = stream.pipe(createBrotliDecompress());
        else if (encoding === "deflate") stream = stream.pipe(createInflate());

        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const raw = Buffer.concat(chunks);

        try {
            const contentType = resHeaders["content-type"] || "";

            if (contentType.includes("application/json")) return JSON.parse(raw.toString("utf-8"));
            else if (contentType.includes("text/")) return raw.toString("utf-8");
            else return raw;
        } catch (err) {
            throw new Error(`Error parsing response: ${err}`);
        }
    }
}

/**
 * @author SNIPPIK
 * @description Парсинг статус-кода и возврат ошибки
 * @class httpsStatusCode
 */
export class httpsStatusCode {
    /**
     * @description Парсинг статус кода, возвращает Error или null
     * @static
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
