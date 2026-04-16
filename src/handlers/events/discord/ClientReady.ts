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
        Logger.log("LOG", `[Core/${client["shardID"]}] on ${Logger.color(32, `${client.guilds.cache.size} guilds`)}`);
        client["startIntervalStatuses"]();
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ClientReady];