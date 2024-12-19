import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {ClientRequest, IncomingMessage, request as httpRequest} from "node:http";
import {MessageEvent as WebSocketEvent, WebSocket as WS} from "ws";
import {request as httpsRequest, RequestOptions} from "node:https";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {TypedEmitter} from "tiny-typed-emitter";

/**
 * @author SNIPPIK
 * @description Список ивент функций для ClientRequest
 * @private
 */
const requests: { name: string, callback: (req: ClientRequest, url?: string) => any }[] = [
    /**
     * @description Ивент если превышено время ожидания подключения
     * @public
     */
    {
        name: "timeout",
        callback: (_, url) => {
            return new Error(`[APIs]: Connection Timeout Exceeded ${url}:443`);
        }
    },
    /**
     * @description Ивент если подключение было сорвано
     * @public
     */
    {
        name: "close",
        callback: (request) => {
            request.destroy();
        }
    },
    /**
     * @description Ивент если что-то пошло не так или была получена ошибка
     * @public
     */
    {
        name: "error",
        callback: () => {
            return;
        }
    }
];

/**
 * @author SNIPPIK
 * @description Класс создающий запрос
 * @class Request
 * @public
 * @abstract
 */
abstract class Request {
    /**
     * @description Данные хранимые для произведения запроса
     * @protected
     * @readonly
     */
    protected readonly data: RequestData = { headers: {} };

    /**
     * @description Получаем протокол ссылки
     * @private
     */
    private get protocol() {
        const protocol = this.data.protocol;

        if (protocol.startsWith("https")) return httpsRequest;
        return httpRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
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

            // Подключаем ивенты для отслеживания состояния
            for (const {name, callback} of requests) request.once(name, () => callback(request, this.data.hostname));

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
                "User-Agent": options.useragent,
            });
        }

        // Надо ли генерировать user-agent
        else if (options?.useragent) {
            const OS = [ "(X11; Linux x86_64)", "(Windows NT 10.0; Win64; x64)" ];
            const version = `${(128).random(96)}.0.${(6250).random(1280)}.${(250).random(59)}`;

            Object.assign(this.data.headers, {
                "User-Agent": `Mozilla/5.0 ${OS[(OS.length - 1).random(0)]} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
                "Sec-Ch-Ua-Full-Version": version,
                "Sec-Ch-Ua-Bitness": `64`,
                "Sec-Ch-Ua-Arch": "x86",
                "Sec-Ch-Ua-Mobile": "?0"
            });
        }

        Object.assign(this.data, options);
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

    //Headers запроса
    headers?: RequestOptions["headers"];

    //Если мы хотим что-то отправить серверу
    body?: string;

    //Добавлять рандомный user-agent
    useragent?: boolean | string;
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
        return new Promise<string | Error>((resolve) => {
            this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];
                let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage = res, data = "";

                // Делаем выбор расшифровщика UFT-8
                if (encoding === "br") decoder = res.pipe(createBrotliDecompress() as any);
                else if (encoding === "gzip") decoder = res.pipe(createGunzip() as any);
                else if (encoding === "deflate") decoder = res.pipe(createDeflate() as any);

                // Запускаем расшифровку
                decoder.setEncoding("utf-8")
                    .on("data", (c) => data += c)
                    .once("end", () => {
                        setImmediate(() => { data = null });
                        return resolve(data);
                    });
            }).catch((err) => {
                return resolve(err);
            });
        });
    };

    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @public
     */
    public get toJson(): Promise<null | {[key:string]: any} | Error> {
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
        return new Promise(async (resolve) => {
            const body = await this.toString;

            // Если была получена ошибка
            if (body instanceof Error) return resolve(Error("Not found XML data!"));

            // Ищем данные в XML странице для дальнейшего вывода
            const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
            const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
            return resolve(filtered.filter((text) => text.trim() !== ""));
        });
    };

    /**
     * @description Проверяем ссылку на работоспособность
     * @public
     */
    public get status(): Promise<boolean> | false {
        return this.request.then((resource: IncomingMessage) => {
            return resource?.statusCode && resource.statusCode >= 200 && resource.statusCode <= 400;
        });
    };
}

/**
 * @author SNIPPIK
 * @description WebSocket для взаимодействия с discord, node.js не предоставляет свой
 * @class WebSocket
 * @public
 */
export class WebSocket extends TypedEmitter<WebSocketEvents> {
    /**
     * @description Класс сокета для подключения к серверам discord
     * @readonly
     * @private
     */
    private readonly socket: WS = null;

    /**
     * @description Данные для проверки жизни
     * @readonly
     * @private
     */
    private readonly KeepAlive = {
        interval: null as NodeJS.Timeout, miss: 0, send: 0
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     * @public
     */
    public set keepAlive(ms: number) {
        if (this.KeepAlive.interval !== undefined) clearInterval(this.KeepAlive.interval);

        // Если есть время для проверки жизни
        if (ms > 0) this.KeepAlive.interval = setInterval(() => {
            if (this.KeepAlive.send !== 0 && this.KeepAlive.miss >= 3) this.destroy(0);

            // Задаем время и прочие параметры для правильной работы
            this.KeepAlive.send = Date.now();
            this.KeepAlive.miss++;

            // Отправляем пакет
            this.packet = {
                op: VoiceOpcodes.Heartbeat,
                d: this.KeepAlive.send
            };
        }, ms);
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public set packet(packet: string | object) {
        try {
            this.socket.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Создаем WebSocket для передачи голосовых пакетов
     * @param address - Адрес сервера для соединения
     * @public
     */
    public constructor(address: string) {
        super();
        const Socket = new WS(address);

        //Подключаем события
        for (const event of ["message", "open", "close", "error"]) {
            if (this[`on${event}`]) Socket[`on${event}`] = (arg: WebSocketEvent) => this[`on${event}`](arg);
            else Socket[`on${event}`] = (arg: WebSocketEvent) => this.emit(event as any, arg);
        }

        // Задаем сокет в класс
        this.socket = Socket;
    };

    /**
     * @description Используется для перехвата сообщения от сервера
     * @param event - Данные для перехвата
     * @readonly
     * @private
     */
    private readonly onmessage = (event: WebSocketEvent) => {
        if (typeof event.data !== "string") return;

        try {
            const packet = JSON.parse(event.data);

            // Если надо обновить интервал жизни
            if (packet.op === VoiceOpcodes.HeartbeatAck) this.KeepAlive.miss = 0;

            this.emit("packet", packet);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code: number = 1_000): void => {
        try {
            this.keepAlive = -1;
            this.socket.close(code);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };
}

/**
 * @description Ивенты для VoiceWebSocket
 * @interface WebSocketEvents
 * @class VoiceWebSocket
 */
interface WebSocketEvents {
    "error": (error: Error) => void;
    "open": (event: Event) => void;
    "close": (event: CloseEvent) => void;
    "packet": (packet: any) => void;
}