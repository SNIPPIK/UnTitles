import { ShardingManager, ShardingManagerOptions} from "discord.js";
import {Logger} from "@service//logger";

/**
 * @author SNIPPIK
 * @description ShardManager, используется для большего кол-ва серверов, все крупные боты это используют
 * @class ShardManager
 * @public
 */
export class ShardManager extends ShardingManager {
    /**
     * @description Создаем класс и запускаем процесс деления бота на сервера
     * @param path    - Путь к файлу, для запуска осколка
     * @param options - Параметры запуска
     */
    public constructor(path: string, options: ShardingManagerOptions) {
        super(path, options);

        // Сообщаем о запуске ShardManager
        Logger.log("LOG", `[ShardManager/process] running...`);

        // Слушаем событие для создания осколка
        this.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log("LOG",`[Shard ${shard.id}] added to manager`));
            shard.on("ready", () => Logger.log("LOG",`[Shard ${shard.id}] is connected to websocket`));
            shard.on("death", () => Logger.log("LOG",`[Shard ${shard.id}] is killed`));
        });

        // Создаем дубликат
        this.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[ShardManager] ${err}`));
    };
}