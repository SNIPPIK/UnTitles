import { Client, LimitedCollection } from "seyfert";
import { middlewares } from "#handler/middlewares";
import { ActivityType } from "seyfert/lib/types";
import { Logger } from "#structures";
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
                defaults: {
                    onBeforeOptions: (ctx) => {
                        Logger.log("DEBUG", `[${ctx.author.name}] run autocomplete ${ctx.fullCommandName}`);
                    },
                    onAfterRun: (ctx) => {
                        Logger.log("DEBUG", `[${ctx.author.name}] run command ${ctx.fullCommandName}`);
                    },
                    onMiddlewaresError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Command | Middleware Error\n` +
                            `┌ Reason:  ${ctx.fullCommandName}\n` +
                            `└ Stack:   ${error}`
                        );
                    },

                    onRunError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Command | Run Error\n` +
                            `┌ Reason:  ${ctx.fullCommandName}\n` +
                            `└ Stack:   ${error instanceof Error ? error.stack : error}`
                        );
                    },

                    onInternalError: (_, ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Command | Internal Error\n` +
                            `┌ Reason:  ${ctx.name} - ${ctx.description}\n` +
                            `└ Stack:   ${error instanceof Error ? error.stack : error}`
                        );
                    },

                    onOptionsError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Command | Options Error\n` +
                            `┌ Reason:  ${ctx.options}\n` +
                            `└ Stack:   ${error instanceof Error ? error.stack : error}`
                        );
                    }
                }
            },

            /**
             * @description Хуки для компонентов
             */
            components: {
                defaults: {
                    onAfterRun: (ctx) => {
                      Logger.log("DEBUG", `[${ctx.author.name}] run component ${ctx.customId}`);
                    },

                    onMiddlewaresError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Components | Middleware Error\n` +
                            `┌ Reason:  ${ctx.customId}\n` +
                            `└ Stack:   ${error}`
                        );
                    },

                    onInternalError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Components | Internal Error\n` +
                            `┌ Reason:  ${ctx.options}\n` +
                            `└ Stack:   ${error instanceof Error ? error.stack : error}`
                        );
                    },

                    onRunError: (ctx, error) => {
                        Logger.log(
                            "ERROR",
                            `Components | Run Error\n` +
                            `┌ Reason:  ${ctx.customId}\n` +
                            `└ Stack:   ${error instanceof Error ? error.stack : error}`
                        );
                    }
                }
            },

            globalMiddlewares: ["checkCooldown"],
            allowedMentions: {
                replied_user: false,
                parse: ["roles"],
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
                disabledCache: {
                    bans: true,
                    emojis: true,
                    stickers: true,
                    roles: true,
                    presences: true,
                    messages: true,
                    stageInstances: true,
                    overwrites: true
                },
            },
        });
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
                // Проверяем, пора ли перепарсить массив статусов
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
                    activities: [activity] as any[]
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
    private parseStatuses = () => {
        const statuses: ActivityOptions[] = [];
        const guilds = this.cache.guilds!.count();
        const users = this.cache.users!.count();

        // Получаем пользовательские статусы
        try {
            const envPresents = (JSON.parse(`[${env.get("client.presence.array")}]`) as ActivityOptions[]).map((status) => {
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
}