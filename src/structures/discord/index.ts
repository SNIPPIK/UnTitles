import {ParseMiddlewares, CommandContext, WebhookMessage, Message} from "seyfert";
import { middlewares } from "#handler/middlewares";
import { AudioPlayerEvents } from "#core/player";
import { QueueEvents } from "#core/queue";
import { DiscordClient } from "./index.client";

export * from "./index.client";

/**
 * @author SNIPPIK
 * @description Тип сообщения для команд
 * @type CommandInteraction
 */
export type CommandInteraction = CommandContext;

/**
 * @author SNIPPIK
 * @description Тип сообщения для обновления сообщения
 * @type CycleInteraction
 */
export type CycleInteraction = (WebhookMessage | Message) & { editedTimestamp: number };

/**
 * @description Тип входящих данных для циклической системы
 * @type MessageComponent
 * @public
 */
export type MessageComponent = any;

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
 * @author SNIPPIK
 * @description Редактируем параметры seyfert
 */
declare module "seyfert" {
    interface UsingClient extends DiscordClient { }
    interface CustomEvents extends AudioPlayerEvents, QueueEvents { }

    // Регистрируем middlewares в системе seyfert
    interface RegisteredMiddlewares extends ParseMiddlewares<typeof middlewares> {}
}