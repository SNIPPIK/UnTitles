import { Client, Options, Partials } from "discord.js";
import { ActivityType } from "discord-api-types/v10";
import { VoiceAdapters } from "#core/voice/adapter";
import { version } from "package.json";
import { Logger } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс клиента
 * @class DiscordClient
 * @extends Client
 */
export class DiscordClient extends Client {
    /**
     * @description Номер осколка
     * @returns number
     * @public
     */
    public get shardID(): number {
        return this.shard?.ids[0] ?? 0;
    };

    /**
     * @description Создание стандартного осколка
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Данный раздел не трогать, иначе вы нарушите лицензию BSD-3
            presence: {
                afk: false,
                status: "online",
                activities: [{name: " 🌟 Startup...", type: 4}]
            },

            // Права бота
            intents: [
                // Доступ к серверам
                "Guilds",

                // Отправление сообщений
                "GuildMessages",
                "DirectMessages",

                // Нужен для голосовой системы
                "GuildVoiceStates",
            ],

            // Позволяет обрабатывать частичные данные
            partials: [
                Partials.Channel,
                Partials.GuildMember,
                Partials.SoundboardSound,
                Partials.Message,
                Partials.Reaction,
                Partials.User,
                Partials.GuildScheduledEvent,
                Partials.ThreadMember,
            ],

            // Задаем параметры кеша
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
                GuildBanManager: 0,
                GuildForumThreadManager: 0,
                AutoModerationRuleManager: 0,
                DMMessageManager: 0,
                GuildInviteManager: 0,
                GuildEmojiManager: 0,
                GuildStickerManager: 0,
                ThreadManager: 0,
                ThreadMemberManager: 0,
            })
        });
        this.setMaxListeners(10);

        // Запускаем статусы после инициализации клиента
        this.once("ready", this.IntervalStatus);
    };

    /**
     * @description Функция создания и управления статусом
     * @returns void
     * @readonly
     * @private
     */
    private readonly IntervalStatus = (): void => {
        // Время обновления статуса
        const timeout = parseInt(env.get("client.presence.interval", "120"));
        const arrayUpdate = parseInt(env.get("client.presence.array.update", "3600")) * 1e3;
        const clientID = this.shardID;

        let array = this.parseStatuses();
        let size = array.length - 1;
        let i = 0, lastDate = Date.now() + arrayUpdate ;

        // Если нет статусов
        if (!array.length) return;
        else {
            Logger.log("LOG", `[Core/${clientID}] Success loading custom ${Logger.color(34, `${array.length} statuses`)}`);
        }

        // Интервал для обновления статуса
        setInterval(async () => {
            // Обновляем статусы
            if (lastDate < Date.now()) {
                // Обновляем статусы
                array = this.parseStatuses();

                // Обновляем время для следующего обновления
                lastDate = Date.now() + arrayUpdate;
            }

            // Запрещаем выходить за диапазон допустимого значения
            if (i > size) i = 0;
            const activity = array[i];

            // Задаем статус боту
            this.user.setPresence({
                status: env.get("client.status", "online"),
                activities: [activity] as ActivityOptions[],
                shardId: clientID
            });

            i++;
        }, timeout * 1e3);
    };

    /**
     * @description Функция подготавливающая статусы
     * @returns ActivityOptions[]
     * @readonly
     * @private
     */
    private readonly parseStatuses = (): ActivityOptions[] => {
        const statuses: ActivityOptions[] = [];
        const guilds = this.guilds.cache.size;
        const users = this.users.cache.size;

        // Получаем пользовательские статусы
        try {
            const presence = (JSON.parse(`[${env.get("client.presence.array")}]`) as ActivityOptions[]);
            const envPresents = presence.map((status) => {
                const edited = status.name
                    .replace(/{shard}/g, `${this.shardID + 1}`)
                    .replace(/{queues}|{players}/g, `${db.queues.size}`)
                    .replace(/{version}/g, `${version}`)
                    .replace(/{guilds}/g, `${guilds}`)
                    .replace(/{users}/g, `${users}`)

                return {
                    name: edited,
                    type: ActivityType[status.type] as any,
                    shardId: this.shardID
                }
            });

            // Добавляем пользовательские статусы
            statuses.push(...envPresents);
        } catch (e) {
            Logger.log("ERROR", `[Core/${this.shardID}] Failed to parse env statuses. ${e}`);
        }

        return statuses;
    };
}

/**
 * @author SNIPPIK
 * @description Класс реализации адаптера
 * @class DJSVoice
 * @extends VoiceAdapters
 */
export class DJSVoice extends VoiceAdapters {
    public constructor(private client: DiscordClient) {
        super();

        //@ts-ignore
        client.ws.on("VOICE_SERVER_UPDATE", (data) => {
            this.onVoiceServer(data);
        });

        //@ts-ignore
        client.ws.on("VOICE_STATE_UPDATE", (data) => {
            this.onVoiceStateUpdate(data);
        });
    };

    /**
     * @description Указываем данные для отправки данных через ws
     * @param data
     * @public
     */
    protected ws_send = (data: unknown) => {
        const id = this.client.shardID;
        this.client.ws.shards.get(id).send(data);
    };
}

/**
 * @author SNIPPIK
 * @description Параметры показа статуса
 * @interface ActivityOptions
 */
interface ActivityOptions {
    name: string;
    state?: string;
    url?: string;
    type?: ActivityType;
    shardId?: number | readonly number[];
}