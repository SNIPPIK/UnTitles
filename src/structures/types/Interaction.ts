import { CommandContext, WebhookMessage, Message, AutocompleteInteraction } from "seyfert";

/**
 * @author SNIPPIK
 * @description Тип сообщения для команд
 * @type CommandInteraction
 */
export type CommandInteraction = CommandContext;

/**
 * @description Тип входящих данных для дополнения к команде
 * @type CompeteInteraction
 * @public
 */
export type CompeteInteraction = AutocompleteInteraction;

/**
 * @description Тип входящих данных для кнопок
 * @type buttonInteraction
 * @public
 */
export type buttonInteraction = CommandContext;

/**
 * @description Тип входящих данных для циклической системы
 * @type buttonInteraction
 * @public
 */
export type SelectMenuInteract = CommandContext;

/**
 * @description Тип входящих данных для циклической системы
 * @type buttonInteraction
 * @public
 */
export type CycleInteraction = (WebhookMessage | Message) & { editedTimestamp?: string };

/**
 * @description Тип входящих данных для циклической системы
 * @type MessageComponent
 * @public
 */
export type MessageComponent = any;