import {Client, GatewayActivityUpdateData, LimitedCollection, LimitedMemoryAdapter} from "seyfert";
import { middlewares } from "#handler/middlewares/index.js";
import { ActivityType } from "seyfert/lib/types/index.js";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Реализация клиента discord
 * @class DiscordClient
 * @extends Client
 * @public
 */
export class DiscordClient extends Client {
    /**
     * @description Коллекция для cooldown
     * @readonly
     * @public
     */
    public readonly cooldowns: LimitedCollection<string, number> = new LimitedCollection();

    /**
     * @description Создание класса клиента
     * @public
     */
    public constructor() {
        super({
            /**
             * @description Хуки для команд
             */
            commands: {
                // Для команд через префикс
                /*prefix: (msg) => {
                    // here you can handle whatever prefixes you want depending on the message data.
                    return ['!', '?', '.', `${msg.client.me.id}`];
                },*/
                deferReplyResponse: () => ({
                    content: `${db.emoji.loading} **${this.me.username}** lost context`,
                })
            },
            globalMiddlewares: ["checkCooldown"],
            allowedMentions: {
                replied_user: false,
                parse: ["roles"]
            }
        });

        // Отключаем кеширование данных
        this.setServices({
            middlewares: middlewares,
            langs: {
                aliases: {
                    "en-US": ["en-GB"],
                    "es-419": ["es-ES"],
                }
            },

            cache: {
                adapter: new LimitedMemoryAdapter({
                    presence: {
                        expire: 1e3 * 60,
                        limit: 5,
                    },
                    message: {
                        expire: (1e3 * 60) * 2,
                        limit: 10,
                    }
                }),
                disabledCache: {
                    bans: true,
                    emojis: true,
                    stickers: true,
                    roles: true,
                    presences: true,
                    stageInstances: true,
                }
            }
        });

        if (this.cache.messages) this.cache.messages.filter = (message) => message.author.id === this.botId;
    };

    /**
     * @description Функция создания и управления статусом через рекурсивный setTimeout
     * @readonly
     * @private
     */
    public startIntervalStatuses = () => queueMicrotask(() => {
        // Конфигурация из ENV
        const timeoutMs = parseInt(env.get("client.presence.interval", "120")) * 1e3;
        const arrayUpdateMs = parseInt(env.get("client.presence.array.update", "3600")) * 1e3;
        const botStatus = env.get("client.status", "online") as any;

        let array = this.parseStatuses();
        let i = 0;
        let lastUpdateDate = Date.now();

        // Если статусов нет — выходим
        if (!array.length) return;

        // Рекурсивная функция обновления
        const updatePresence = () => {
            try {
                // Проверяем, пора ли парсить массив статусов
                if (Date.now() - lastUpdateDate > arrayUpdateMs) {
                    array = this.parseStatuses();
                    lastUpdateDate = Date.now();
                }

                // Сброс индекса, если вышли за пределы массива
                if (i >= array.length) i = 0;

                const activity = array[i];

                // Установка присутствия в Seyfert
                this.gateway.setPresence({
                    afk: false,
                    since: Date.now(),
                    status: botStatus,
                    activities: [activity]
                });

                i++;
            } catch (error) {
                console.error("[PresenceUpdate]: Failed to set presence:", error);
            } finally {
                // Планируем следующий запуск в любом случае
                setTimeout(updatePresence, timeoutMs);
            }
        };

        // Запускаем первую итерацию
        updatePresence();
    });

    /**
     * @description Функция подготавливающая статусы
     * @readonly
     * @private
     */
    private parseStatuses = (): GatewayActivityUpdateData[] => {
        const statuses: GatewayActivityUpdateData[] = [];
        const guilds = this.cache.guilds!.count();
        const users = this.cache.users!.count();

        // Получаем пользовательские статусы
        try {
            const envPresents = (JSON.parse(`[${env.get("client.presence.array")}]`) as GatewayActivityUpdateData[]).map((status) => {
                const edited = status.name
                    .replace(/{shard}/g, `${this.gateway.size}`)
                    .replace(/{queues}|{players}/g, `${db.queues.size}`)
                    .replace(/{version}/g, `0.5.0 Seyfert`)
                    .replace(/{guilds}/g, `${guilds}`)
                    .replace(/{users}/g, `${users}`)

                return {
                    name: edited,
                    type: ActivityType[status.type] as any
                }
            });

            // Добавляем пользовательские статусы
            statuses.push(...envPresents);
        } catch (e) {
            this.logger.error(`[Client/Status] Failed to parse env statuses. ${e}`);
        }

        return statuses;
    };
}