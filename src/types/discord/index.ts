import {Message, InteractionCallbackResponse,BaseInteraction, ComponentData, ActionRowBuilder, EmbedData, MessageFlags} from "discord.js";
import {ActivityType} from "discord-api-types/v10"
import {Interact} from "@utils";

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
 * @description Доступные кнопки
 * @type SupportButtons
 */
export type SupportButtons = "resume_pause" | "shuffle" | "replay" | "repeat" | "lyrics" | "queue" | "skip" | "stop" | "back" | "filters" | MenuButtons;

/**
 * @author SNIPPIK
 * @description Имена кнопок в меню взаимодействия
 * @type MenuButtons
 */
export type MenuButtons = "menu_back" | "menu_select" | "menu_cancel" | "menu_next";

/**
 * @author SNIPPIK
 * @description Что хранит в себе объект кнопки
 * @interface ButtonCallback
 */
export type ButtonCallback = (msg: Interact) => void;



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