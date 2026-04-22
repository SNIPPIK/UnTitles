import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { DiscordClient } from "#structures/discord";
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
        const bot: DiscordClient = client as any;

        Logger.log("LOG", `[Core/${bot.shardID}] on ${Logger.color(32, `${client.guilds.cache.size} guilds`)}`);
        bot.startIntervalStatuses();
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ClientReady];