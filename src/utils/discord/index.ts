export * from "./Utils/EmbedBuilder";
export * from "./Utils/MessageUtils";
export * from "./Utils/Interact";

import type { Message, BaseInteraction} from "discord.js";


/**
 * @author SNIPPIK
 * @description Поддерживаемый тип сообщения
 */
export type ds_input = Message | BaseInteraction; //| CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;