import {Message, InteractionCallbackResponse,BaseInteraction, ComponentData, ActionRowBuilder, EmbedData, MessageFlags} from "discord.js";
import {ActivityType} from "discord-api-types/v10"
import {SupportButtons} from "@handler/modals";

/**
 * @author SNIPPIK
 * @description Поддерживаемый тип сообщения
 * @type ds_interact
 */
export type ds_interact = Message | BaseInteraction | InteractionCallbackResponse; //| CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

/**
 * @author SNIPPIK
 * @description Внутренний тип сообщений
 * @type interact
 */
export type interact = Message | BaseInteraction;


/**
 * @author SNIPPIK
 * @description Параметры показа статуса
 * @interface ActivityOptions
 */
export interface ActivityOptions {
    name: string;
    state?: string;
    url?: string;
    type?: ActivityType;
    shardId?: number | readonly number[];
}


/**
 * @author SNIPPIK
 * @description Параметры для отправки сообщения
 * @interface MessageSendOptions
 */
export interface MessageSendOptions {
    components?: (ComponentData | ActionRowBuilder<any> | MessageComponents)[];
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