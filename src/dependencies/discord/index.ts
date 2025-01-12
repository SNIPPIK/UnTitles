import { Client as DS_Client, ShardingManager, WebhookClient, ShardingManagerOptions} from "discord.js";
import type { WebhookMessageCreateOptions } from "discord.js";
import {Logger} from "@lib/logger";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 * @class ShardManager
 * @public
 */
export class ShardManager extends ShardingManager {
    /**
     * @description Создаем класс и запускаем процесс деления бота на сервера
     * @param path    - Путь к файлу, для запуска осколка
     * @param options - Параметры запуска
     */
    public constructor(path: string, options: ShardingManagerOptions) {
        super(path, options);

        // Сообщаем о запуске ShardManager
        Logger.log("LOG", `[ShardManager/process] running...`);

        // Слушаем событие для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log("LOG",`[Shard ${shard.id}] added to manager`));
            shard.on("ready", () => Logger.log("LOG",`[Shard ${shard.id}] is connected to websocket`));
            shard.on("death", () => Logger.log("LOG",`[Shard ${shard.id}] is killed`));
        });

        // Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[ShardManager] ${err}`));
    };
}

/**
 * @author SNIPPIK
 * @description Класс осколка или же клиента кому как удобнее
 * @class Client
 * @public
 */
export class Client extends DS_Client {
    /**
     * @description Обращение клиента через webhook для отправки ошибок в канал
     * @readonly
     * @private
     */
    private readonly webhook = env.get("webhook.id") && env.get("webhook.token") ?
        new WebhookClient({id: env.get("webhook.id"), token: env.get("webhook.token")}) : null;

    /**
     * @description Получаем ID осколка
     * @return number
     * @public
     */
    public get ID() {
        if (this.shard?.ids[0] === undefined) return 0;
        return typeof this.shard?.ids[0] === "string" ? 0 : this.shard?.ids[0] ?? 0;
    };

    /**
     * @description Отправляем данные через систему Webhook
     * @param options - Данные для отправки
     * @public
     */
    public set sendWebhook(options: WebhookMessageCreateOptions) {
        if (this.webhook) this.webhook.send(options).catch(() => {
            Logger.log("WARN", "Fail to send webhook data for discord channel!");
        });
    };
}