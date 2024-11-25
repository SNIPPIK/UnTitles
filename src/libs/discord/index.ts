import { Client as DS_Client, IntentsBitField, Partials, ShardingManager, WebhookClient} from "discord.js";
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
     * @param path
     */
    public constructor(path: string) {
        super(path, {
            token: env.get("token.discord"), mode: "worker",
            totalShards: env.get("shard.total"),
            execArgv: ["-r", "tsconfig-paths/register"],
            respawn: true
        });

        // Сообщаем о запуске ShardManager
        Logger.log("LOG", `[ShardManager/worker] running...`);

        // Слушаем ивент для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log("LOG",`[Shard ${shard.id}] added to manager`));
            shard.on("ready", () => Logger.log("LOG",`[Shard ${shard.id}] is running`));
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
    private readonly webhook = env.get("webhook.id") && env.get("webhook.token") ?
        new WebhookClient({id: env.get("webhook.id"), token: env.get("webhook.token")}) : null;

    /**
     * @description Создаем класс и задаем параметры боту
     * @public
     */
    public constructor() {
        super({
            // Какие данные не надо кешировать (для экономии памяти)
            allowedMentions: {
                parse: ["roles", "users"],
                repliedUser: true,
            },

            // Права бота
            intents: [
                IntentsBitField.Flags["GuildEmojisAndStickers"],
                IntentsBitField.Flags["GuildIntegrations"],
                IntentsBitField.Flags["GuildVoiceStates"],
                IntentsBitField.Flags["Guilds"]
            ],

            // Данные которые обязательно надо кешировать
            partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],

            // Кол-во сервером на осколок
            shardCount: parseInt(env.get("shard.server")) || 1e3,

            // Кол-во осколков
            shards: "auto"
        });
    };

    /**
     * @description Получаем ID осколка
     * @return number
     * @public
     */
    public get ID() { return typeof this.shard?.ids[0] === "string" ? 0 : this.shard?.ids[0] ?? 0; };

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