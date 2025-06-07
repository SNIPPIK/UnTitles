import { Assign, Logger } from "#structures";
import { Event } from "#handler/events";
import { Events } from "discord.js";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс события GuildCreate
 * @class GuildCreate
 * @extends Assign
 * @event Events.GuildCreate
 * @public
 */
class GuildCreate extends Assign<Event<Events.GuildCreate>> {
    public constructor() {
        super({
            name: Events.GuildCreate,
            type: "client",
            once: false,
            execute: async (guild) => {
                const id = guild.client.shard?.ids[0] ?? 0;
                Logger.log("LOG", `[Core/${id}] has ${Logger.color(32, `added a new guild ${guild.id}`)}`);
            }
        });
    };
}


/**
 * @author SNIPPIK
 * @description Класс события GuildDelete
 * @class GuildDelete
 * @extends Assign
 * @event Events.GuildDelete
 * @public
 */
class GuildRemove extends Assign<Event<Events.GuildDelete>> {
    public constructor() {
        super({
            name: Events.GuildDelete,
            type: "client",
            once: false,
            execute: async (guild) => {
                const id = guild.client.shard?.ids[0] ?? 0;
                Logger.log("LOG", `[Core/${id}] has ${Logger.color(31, `remove a guild ${guild.id}`)}`);

                // Если бота отключили при включенной музыке
                const queue = db.queues.get(guild.id);
                if (queue) db.queues.remove(guild.id);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [GuildCreate, GuildRemove];