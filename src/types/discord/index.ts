import {Message, BaseInteraction, ComponentData, ActionRowBuilder, EmbedData, MessageFlags} from "discord.js";

/**
 * @author SNIPPIK
 * @description Поддерживаемый тип сообщения
 */
export type ds_input = Message | BaseInteraction; //| CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

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
        custom_id: string;
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