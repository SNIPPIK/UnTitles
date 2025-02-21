import {Message, InteractionCallbackResponse,BaseInteraction, ComponentData, ActionRowBuilder, EmbedData, MessageFlags} from "discord.js";
import {SupportButtons} from "@handler/queues";

/**
 * @author SNIPPIK
 * @description Поддерживаемый тип сообщения
 * @type ds_interact
 */
export type ds_interact = Message | BaseInteraction | InteractionCallbackResponse; //| CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

/**
 * @author SNIPPIK
 * @description Внутренний тип сообщений
 */
export type interact = Message | BaseInteraction;

/**
 * @author SNIPPIK
 * @description Параметры для отправки сообщения
 * @interface MessageSendOptions
 */
export interface MessageSendOptions {
    components?: (ComponentData | ActionRowBuilder | MessageComponents)[];
    embeds?: EmbedData[];
    flags?: MessageFlags;
    context?: string;
    withResponse?: boolean;
}

/**
 * @author SNIPPIK
 * @description Компоненты кнопок в json объекте
 * @interface MessageComponents
 */
export interface MessageComponents {
    type: 1 | 2;
    components: {
        type: 1 | 2;
        emoji?: {
            id?:   string;
            name?: string;
        };
        custom_id: SupportButtons;
        style: 1 | 2 | 3 | 4;
        disabled?: boolean;
    }[]
}

/**
 * @author SNIPPIK
 * @description Компонент одной кнопки
 * @type MessageComponent
 */
export type MessageComponent = MessageComponents["components"][number];