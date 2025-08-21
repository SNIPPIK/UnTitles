import { Assign, Logger } from "#structures";
import { Event } from "#handler/events";
import { Events } from "discord.js";

/**
 * @author SNIPPIK
 * @description Класс события ClientReady
 * @class ClientReady
 * @extends Assign
 * @event Events.ClientReady
 * @public
 */
class ClientReady extends Assign<Event<Events.ClientReady>> {
    public constructor() {
        super({
            name: Events.ClientReady,
            type: "client",
            once: false,
            execute: (client) => {
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