export {Client} from "./Client";
export {Interact} from "./Utils/Interact";
export {ShardManager} from "./ShardManager"

export {EmbedBuilder, MessageSendOptions, MessageComponent} from "./Utils/EmbedBuilder";
export {MessageUtils, IGNORED_ERRORS} from "./Utils/MessageUtils";
export {InteractionUtils} from "./Utils/InteractionUtils";

import type { Message, BaseInteraction} from "discord.js"

/**
 * @author SNIPPIK
 * @description Поддерживаемый тип сообщения
 */
export type ds_input = Message | BaseInteraction; //| CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;