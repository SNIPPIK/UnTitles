import { DiscordGatewayAdapterCreator, VoiceAdapters } from "#core/voice/adapter";
import { Client, LimitedCollection } from "seyfert";
import { middlewares } from "#handler/middlewares";
import { ActivityType } from "seyfert/lib/types";
import { version } from "package.json";
import { env } from "#app/env";
import { db } from "#app/db";
import {Logger} from "#structures";

/**
 * @author SNIPPIK
 * @description Класс адаптера
 * @class SeyfertVoice
 * @extends VoiceAdapters
 */
export class SeyfertVoice<T extends DiscordClient> extends VoiceAdapters<DiscordClient> {
    public constructor(client: T) {
        super(client);
    };

    /**
     * @description Указываем как создавать адаптер
     * @param guild_id - ID сервера для которого надо создать адаптер
     * @public
     */
    public voiceAdapterCreator = (guild_id: string): DiscordGatewayAdapterCreator => {
        // Если нет ID осколка
        const id = this.client.gateway.calculateShardId(guild_id);

        return methods => {
            this.adapters.set(guild_id, methods);

            return {
                sendPayload: (data) => {
                    this.client.gateway.send(id, data);
                    return true;
                },
                destroy: () => {
                    this.adapters.delete(guild_id);
                }
            };
        };
    };

    /**
     * @description Реализация смены статуса голосового канала
     * @param channelId - ID голосового канала
     * @param status - Название заголовка
     * @public
     */
    public status = (channelId: string, status?: string) => {
        return this.client.rest.request("PUT", `/channels/${channelId}/voice-status`, {
            body: {
                status: status
            }
        });
    };
}

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
     * @description Функция создания и управления статусом
     * @readonly
     * @private
     */
    public startIntervalStatuses = () => {
        // Время обновления статуса
        const timeout = parseInt(env.get("client.presence.interval", "120"));
        const arrayUpdate = parseInt(env.get("client.presence.array.update", "3600")) * 1e3;

        let array = this.parseStatuses();
        let size = array.length - 1;
        let i = 0, lastDate = Date.now() + arrayUpdate ;

        // Если нет статусов
        if (!array.length) return;

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
            this.gateway.setPresence({
                afk: false,
                since: Date.now(),
                status: env.get("client.status", "online") as any,
                activities: [activity] as any[]
            });

            i++;
        }, timeout * 1e3);
    };

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
                    .replace(/{version}/g, `${version}`)
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