import { Client as DS_Client, WebhookClient} from "discord.js";
import type { WebhookMessageCreateOptions } from "discord.js";
import {Logger} from "@service/logger";
import {env} from "@env";

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
            Logger.log("WARN", "Fail to send webhook data in discord channel!");
        });
    };
}