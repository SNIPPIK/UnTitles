import {ActivityType} from "discord-api-types/v10"
import {Event} from "@handler/events";
import {Events} from "discord.js";
import {Assign} from "@utils";
import {env} from "@app";

/**
 * @author SNIPPIK
 * @description Класс события ClientReady
 * @class ClientReady
 * @event Events.ClientReady
 * @public
 */
class ClientReady extends Assign<Event<Events.ClientReady>> {
    public constructor() {
        super({
            name: Events.ClientReady,
            type: "client",
            once: false,
            execute: async (client) => {
                // Даем разрешение на запуск интервала
                if (client.shard?.ids[0] === 0 || true) {
                    // Время обновления статуса
                    const timeout = parseInt(env.get("client.presence.interval"));

                    // Интервал для обновления статуса
                    setInterval(async () => {
                        // Задаем статус боту
                        client.user.setPresence({
                            status: env.get("client.status", "online"),
                            activities: [
                                {
                                    name: env.get("client.presence.name", "I ❤️ UnTitles bot"),
                                    type: ActivityType[env.get("client.presence.type", "Watching")],
                                }
                            ] as ActivityOptions[],
                        });
                    }, timeout * 1e3);
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ClientReady});

/**
 * @author SNIPPIK
 * @description Параметры показа статуса
 * @interface ActivityOptions
 */
export interface ActivityOptions {
    name: string;
    state?: string;
    url?: string;
    type?: ActivityType;
    shardId?: number | readonly number[];
}