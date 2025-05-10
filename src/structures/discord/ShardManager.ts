import {ShardingManager} from "discord.js";
import {Logger} from "@utils";

/**
 * @author SNIPPIK
 * @description Класс менеджера осколков
 * @class ShardManager
 */
export class ShardManager extends ShardingManager {
    public constructor(file: string, token: string) {
        super(file, {
            execArgv: ["-r", "tsconfig-paths/register"],
            token: token,
            mode: "process",
            respawn: true,
            totalShards: "auto",
            shardList: "auto"
        });

        // Слушаем событие для создания осколка
        this.on("shardCreate", async (shard) => {
            shard.setMaxListeners(3);
            shard.on("spawn", () => Logger.log("LOG", `[Manager/${shard.id}] shard ${Logger.color(36, `added to manager`)}`));
            shard.on("ready", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(36, `ready`)}`));
            shard.on("death", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(31, `killed`)}`));
        });
        this.setMaxListeners(1);

        // Создаем дубликат
        this.spawn({amount: "auto", delay: -1}).catch((err: Error) => Logger.log("ERROR", `[Manager] ${err}`));
    };
}