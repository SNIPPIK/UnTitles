import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    CacheType,
    ButtonInteraction, Message
} from "discord.js";

export * from "./logger";
export * from "./emitter";
export * from "./tools/Assign";
export * from "./tools/Collection";
export * from "./tools/SetArray";
export * from "./tools/Cycle";

export * from "./discord/Client";
export * from "./discord/modules/VoiceManager";
export * from "./discord/ShardManager";

export type CommandInteraction = ChatInputCommandInteraction<CacheType>;
export type CompeteInteraction = AutocompleteInteraction<CacheType>;
export type buttonInteraction = ButtonInteraction<CacheType>;
export type CycleInteraction = Message<true>;


/**
 * @description Изменяем параметры discord.js
 */
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


/**
 * @description Все prototype объектов
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    // String
    {
        type: String.prototype, name: "duration",
        value: function () {
            const time = this?.["split"](":").map(Number) ?? [parseInt(this as any)];
            return time.length === 1 ? time[0] : time.reduce((acc: number, val: number) => acc * 60 + val);
        }
    },

    // Number
    {
        type: Number.prototype, name: "duration",
        value: function () {
            const t = Number(this), f = (n: number) => (n < 10 ? "0" : "") + n,
                days = ~~(t / 86400),
                hours = ~~(t % 86400 / 3600),
                min = ~~(t % 3600 / 60),
                sec = ~~(t % 60);

            return [days && days, (days || hours) && f(hours), f(min), f(sec)].filter(Boolean).join(":");
        }
    },
    {
        type: Number.prototype, name: "toSplit",
        value: function () {
            const fixed = parseInt(this as any);
            return (fixed < 10) ? ("0" + fixed) : fixed;
        }
    },
];

/**
 * @description Задаем функции для их использования в проекте
 */
for (const {type, name, value} of prototypes) {
    Object.defineProperty(type, name, {value});
}

/**
 * @description Декларируем для TS
 * @global
 */
declare global {
    /**
     * @description Любое значение в json
     */
    interface json { [key: string]: any }
    interface String {
        /**
         * @prototype String
         * @description Превращаем 00:00 в число
         * @return number
         */
        duration(): number;
    }
    interface Number {
        /**
         * @prototype Number
         * @description Превращаем число в 00:00
         * @return string
         */
        duration(): string;

        /**
         * @prototype Number
         * @description Добавляем 0 к числу. Пример: 01:10
         * @return string | number
         */
        toSplit(): string | number;
    }
}