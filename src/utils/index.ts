export * from "./discord/MessageUtils";

export * from "./tools/Collection";
export * from "./tools/Assign";
export * from "./tools/Cycle";

export * from "./logger";
export * from "./emitter";


/**
 * @description Все prototype объектов
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
    // Array
    {
        type: Array.prototype, name: "ArraySort",
        value: function (number = 5, callback: (value: number, index: number) => void, joined = "\"\\n\\n\"") {
            const pages: string[] = [];
            let page: string = '';

            for (let i = 0; i < this["length"]; i += number) {
                page = this["slice"](i, i + number).map((value: number, index: number) => callback(value, index)).join(joined);
                if (page !== '') pages.push(page);
            }

            return pages;
        }
    },

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
            const days = Math.floor((this as any) / (60 * 60 * 24)).toSplit() as number;
            const hours = Math.floor(((this as any) % (60 * 60 * 24)) / (60 * 60)).toSplit() as number;
            const minutes = Math.floor(((this as any) % (60 * 60)) / 60).toSplit() as number;
            const seconds = Math.floor((this as any) % 60).toSplit() as number;

            return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
        }
    },
    {
        type: Number.prototype, name: "toSplit",
        value: function () {
            const fixed = parseInt(this as any);
            return (fixed < 10) ? ("0" + fixed) : fixed;
        }
    },
    {
        type: Number.prototype, name: "random",
        value: function (min = 0) {
            return Math.floor(Math.random() * ((this as any) - min) + min);
        }
    },
    {
        type: Number.prototype,
        name: "bytes",
        value: function() {
            const sizes = ["Bytes", "KB", "MB", "GB"];
            const i = Math.floor(Math.log((this as any)) / Math.log(1024));
            return `${((this as any) / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
        }
    }
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
    interface json {
        [key: string]: any
    }
    interface Array<T> {
        /**
         * @prototype Array
         * @description Превращаем Array в Array<Array>
         * @param number {number} Сколько блоков будет в Array
         * @param callback {Function} Как фильтровать
         * @param joined {string} Что добавить в конце
         */
        ArraySort(number: number, callback: (value: T, index?: number) => string, joined?: string): string[];
    }
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
         * @description превращаем число в байты
         * @return string
         */
        bytes(): string;

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

        /**
         * @prototype Number
         * @description Получаем случайное число
         * @param min {number} Мин число
         */
        random(min?: number): number;
    }
}

// For discord.js
import {SupportButtons} from "@handler/modals";
import {MessageFlags} from "discord.js";
declare module "discord.js" {
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
     * @description
     */
    interface InteractOptions {
        _group?: string;
        _subcommand?: string;
        _hoistedOptions: CommandInteractionOption[];
        getAttachment?: (name: string) => Attachment;
    }
}