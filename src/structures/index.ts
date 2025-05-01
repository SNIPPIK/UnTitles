import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    CacheType,
    ButtonInteraction, Message
} from "discord.js";

export * from "./discord/Client";
export * from "./discord/modules/VoiceManager";
export * from "./discord/ShardManager";


export type CommandInteraction = ChatInputCommandInteraction<CacheType>;
export type CompeteInteraction = AutocompleteInteraction<CacheType>;
export type buttonInteraction = ButtonInteraction<CacheType>;
export type CycleInteraction = Message<true>;


declare module "discord.js" {
    //@ts-ignore
    export interface ChatInputCommandInteraction {
        member: GuildMember;
    }

    //@ts-ignore
    export interface ButtonInteraction {
        member: GuildMember;
    }
}