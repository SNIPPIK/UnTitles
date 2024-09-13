import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {ClientRequest, IncomingMessage, request as httpRequest} from "node:http";
import {MessageEvent as WebSocketEvent, WebSocket as WS} from "ws";
import {request as httpsRequest, RequestOptions} from "node:https";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {TypedEmitter} from "tiny-typed-emitter";
import {SocksProxyAgent} from "socks-proxy-agent";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Подключаемся к прокси серверу
 */
const agent = env.get("proxy.socks") ? new SocksProxyAgent('socks://127.0.0.1:1080'): null;

/**
 * @author SNIPPIK
 * @description Список ивент функций для ClientRequest
 */
const requests: { name: string, callback: (req: ClientRequest, url?: string) => any }[] = [
    {
        name: "timeout",
        callback: (_, url) => {
            return Error(`[APIs]: Connection Timeout Exceeded ${url}:443`);
        }
    },
    {
        name: "close",
        callback: (request) => {
            request.destroy();
        }
    },
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
 * @abstract
 */
abstract class Request {
    protected readonly data: {
        method?: "POST" | "GET" | "HEAD" | "PATCH";

        //Headers запроса
        headers?: RequestOptions["headers"];

        //Если мы хотим что-то отправить серверу
        body?: string;

        //Добавлять рандомный user-agent
        useragent?: boolean;
    } & RequestOptions = { agent };
    /**
     * @description Получаем протокол ссылки
     * @private
     */
    private get protocol() {
        const protocol = this.data.protocol?.split(":")[0];

        //Logger.log("DEBUG", `${protocol}Client: [${this.data.method}:|${this.data.hostname}${this.data.path}]`);
        return protocol === "https" ? httpsRequest : httpRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise((resolve) => {
            const request = this.protocol(this.data, (res) => {
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) {
                    this.data.path = res.headers.location;

                    //Logger.log("DEBUG", `request/redirect: [${res.headers.location}]`);
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

            //Создаем стандартные настройки
            Object.assign(this.data, {
                port, hostname, path: pathname + search, protocol
            });
        }

        // Надо ли генерировать user-agent
        if (options?.useragent) {
            const OS = [ "(X11; Linux x86_64)", "(Windows NT 10.0; Win64; x64)" ];
            const version = `${(123).random(96)}.0.${(6250).random(1280)}.${(250).random(59)}`;

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
        return new Promise((resolve) => {
           this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];
                let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage = res, data = "";

                if (encoding === "br") decoder = res.pipe(createBrotliDecompress()  as any);
                else if (encoding === "gzip") decoder = res.pipe(createGunzip()     as any);
                else if (encoding === "deflate") decoder = res.pipe(createDeflate() as any);

                decoder.setEncoding("utf-8").on("data", (c) => data += c).once("end", () => {
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

            if (body instanceof Error) return resolve(Error("Not found XML data!"));

            const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
            const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
            return resolve(filtered.filter((text) => text.trim() !== ""));
        })
    };

    /**
     * @description Проверяем ссылку на работоспособность
     * @public
     */
    public get status(): Promise<boolean> | false {
        return this.request.then((resource: IncomingMessage) => {
            return resource?.statusCode && resource.statusCode >= 200 && resource.statusCode < 400;
        });
    };
}


/**
 * @author SNIPPIK
 * @description WebSocket для node.js
 */
export class WebSocket extends TypedEmitter<WebSocketEvents> {
    private readonly socket: WS;
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

        if (ms > 0) this.KeepAlive.interval = setInterval(() => {
            if (this.KeepAlive.send !== 0 && this.KeepAlive.miss >= 3) this.destroy(0);

            this.KeepAlive.send = Date.now();
            this.KeepAlive.miss++;
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

        this.socket = Socket;
    };

    /**
     * @description Используется для перехвата сообщения от сервера
     * @param event - Данные для перехвата
     */
    private readonly onmessage = (event: WebSocketEvent) => {
        if (typeof event.data !== "string") return;

        try {
            const packet = JSON.parse(event.data);

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