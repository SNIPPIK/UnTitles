import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { Events } from "discord.js";
import { Logger } from "#structures";

/**
 * @author SNIPPIK
 * @description Класс события ClientReady
 * @class ClientReady
 * @extends Event
 * @event Events.ClientReady
 * @public
 */
@EventOn()
@DeclareEvent({
    name: Events.ClientReady,
    type: "client"
})
class ClientReady extends Event<Events.ClientReady> {
    run: SupportEventCallback<Events.ClientReady> = async (client) => {
        const id = client.shard?.["ids"][0] ?? 0;
        Logger.log("LOG", `[Core/${id}] on ${Logger.color(32, `${client.guilds.cache.size} guilds`)}`);
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ClientReady];