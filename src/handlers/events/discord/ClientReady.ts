import {ActivityType} from "discord-api-types/v10"
import {Event} from "@handler/events";
import {Assign, Logger} from "@utils";
import {Events} from "discord.js";


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
                const id = client.shard?.ids[0] ?? 0;

                Logger.log("LOG", `[Core/${id}] on ${Logger.color(32, `${client.guilds.cache.size} guilds`)}`);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ClientReady];

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