import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    CacheType,
    ButtonInteraction, Message
} from "discord.js";
import { ShardingManager } from "discord.js";
import { Logger } from "#structures";
import {DiscordClient} from "#structures/discord/Client";

export * from "./Client";

/**
 * @description Тип входящих данных для команд
 * @type CommandInteraction
 * @public
 */
export type CommandInteraction = ChatInputCommandInteraction<CacheType>;

/**
 * @description Тип входящих данных для дополнения к команде
 * @type CompeteInteraction
 * @public
 */
export type CompeteInteraction = AutocompleteInteraction<CacheType>;

/**
 * @description Тип входящих данных для кнопок
 * @type buttonInteraction
 * @public
 */
export type buttonInteraction = ButtonInteraction<CacheType>;

/**
 * @description Тип входящих данных для циклической системы
 * @type buttonInteraction
 * @public
 */
export type CycleInteraction = Message<true>;

/**
 * @author SNIPPIK
 * @description Все цвета для embed сообщений
 * @enum Colors
 */
export enum Colors {
    White = 16777215,
    Aqua = 1752220,
    DarkAqua = 1146986,
    Green = 5763719,
    DarkGreen = 2067276,
    Blue = 3447003,
    DarkBlue = 2123412,
    Purple = 10181046,
    DarkPurple = 7419530,
    LuminousVividPink = 15277667,
    DarkVividPink = 11342935,
    Gold = 15844367,
    DarkGold = 12745742,
    Orange = 15105570,
    DarkOrange = 11027200,
    Red = 15548997,
    DarkRed = 10038562,
    Grey = 9807270,
    DarkGrey = 9936031,
    DarkerGrey = 8359053,
    LightGrey = 12370112,
    Navy = 3426654,
    DarkNavy = 2899536,
    Yellow = 16776960
}

/**
 * @description Изменяем параметры discord.js
 * @module discord.js
 */
declare module "discord.js" {
    //@ts-ignore
    export interface ChatInputCommandInteraction {
        member: GuildMember;
    }

    //@ts-ignore
    export interface ButtonInteraction {
        member: GuildMember;
    }

    export interface GuildMemberManager {
        client: DiscordClient;
    }
}

/**
 * @author SNIPPIK
 * @description Класс менеджера осколков
 * @class ShardManager
 * @extends ShardingManager
 * @public
 */
export class ShardManager extends ShardingManager {
    /**
     * @description Создание менеджера осколков
     * @param file - путь до файла запуска осколка
     * @param token - токен бота
     * @constructor
     * @public
     */
    public constructor(file: string, token: string) {
        super(file, {
            execArgv: ["-r", "tsconfig-paths/register", "--expose-gc", "--optimize_for_size"],
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

            // Запускаем Garbage Collector
            setImmediate(() => {
                if (global.gc) global.gc();
            });
        });
        this.setMaxListeners(1);

        // Создаем дубликат
        this.spawn({amount: "auto", delay: -1}).catch((err: Error) => Logger.log("ERROR", `[Manager] ${err}`));
    };
}