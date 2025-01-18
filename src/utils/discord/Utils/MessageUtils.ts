import { InteractionCallbackResponse } from "discord.js";
import type {  Message} from "discord.js"

/**
 * @author SNIPPIK
 * @description Функции для БЕЗОПАСНОЙ работы с discord.js
 * @class MessageUtils
 */
export class MessageUtils {
    /**
     * @description Функция безопасного удаления сообщения
     * @param msg
     * @param time
     */
    public static delete(msg: InteractionCallbackResponse | Message, time: number =  10e3) {
        setTimeout(() => {
            if (msg instanceof InteractionCallbackResponse) {
                msg.resource.message.delete().catch(() => null);
                return;
            }

            msg.delete().catch(() => null);
        }, time);
    };
}