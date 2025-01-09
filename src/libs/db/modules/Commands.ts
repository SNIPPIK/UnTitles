import {SlashComponent} from "@lib/discord/tools/SlashBuilder";
import filters from "@lib/db/json/filters.json";
import {AudioFilter} from "@lib/player";
import {Handler} from "@lib/handler";
import {Client} from "@lib/discord";
import {Logger} from "@lib/logger";
import {locale} from "@lib/locale";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Класс хранящий в себе управление командами
 * @class dbl_commands
 * @public
 */
export class dbl_commands<T extends Handler.Command<"get">> extends Array<T> {
    /**
     * @description Доп команды, бывают команды, которые могут содержать несколько доп команд
     * @public
     */
    public subCommands = 0;

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): T => {
        for (const cmd of this) {
            // Если указанное имя совпало с именем команды
            if (cmd.builder.name === names) return cmd;

            // Проверяем имена если это список
            else if (names instanceof Array) {
                // Проверяем все указанные имена команды
                for (const name of names) {
                    // Если нашлась подходящая
                    if (cmd.builder.name === name || cmd.builder.name === name) return cmd;
                }
            }
        }

        return null;
    };

    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() { return this.filter((command) => command.owner === true); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.filter((command) => command.owner !== true); };

    /**
     * @description Создаем список фильтров для дискорд
     * @public
     */
    public get filters_options() {
        const temples: SlashComponent["choices"] = [];

        // Если фильтров слишком много
        if (filters.length > 25) return temples;

        // Перебираем фильтр
        for (const filter of filters as AudioFilter[]) {
            // Проверяем кол-во символов на допустимость discord (100 шт.)
            for (const [key, value] of Object.entries(filter.locale)) {
                if (value.startsWith("[")) continue;

                // Добавляем диапазон аргументов
                if (filter.args) filter.locale[key] = `<${filter.args[0]}-${filter.args[1]}> - ${filter.locale[key]}`;

                // Удаляем лишний размер описания
                filter.locale[key] = value.length > 75 ? `[${filter.name}] - ${filter.locale[key].substring(0, 75)}...` : `[${filter.name}] - ${filter.locale[key]}`;
            }

            // Создаем список для показа фильтров в командах
            temples.push({
                name: filter.locale[locale.language],
                nameLocalizations: filter.locale,
                value: filter.name
            });
        }

        return temples;
    };

    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Client} Класс клиента
     * @return Promise<true>
     * @public
     */
    public register = (client: Client): Promise<boolean> => {
        const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);

        return new Promise<true>((resolve) => {
            // Загрузка глобальных команд
            client.application.commands.set(this.map((command) => command.builder) as any)
                .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.public.length}] has load public commands`))
                .catch(console.error);

            // Загрузка приватных команд
            if (guild) guild.commands.set(this.owner.map((command) => command.builder) as any)
                .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.owner.length}] has load private commands`))
                .catch(console.error);

            return resolve(true);
        });
    };
}