import {Handler} from "@lib/handler";
import {Client} from "@lib/discord";
import {Logger} from "@lib/logger";

export class Database_Commands<T extends Handler.Command> extends Array<T> {
    public subCommands = 0;

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): T => {
        // Перебираем весь список команд, этот метод быстрее чем filter или find на 2 ms
        for (const cmd of this) {

            // Если указанное имя совпало с именем команды
            if (cmd.data.name === names) return cmd;

            // Проверяем имена если это список
            else if (names instanceof Array) {
                // Проверяем все указанные имена команды
                for (const name of names) {
                    // Если нашлась подходящая
                    if (cmd.data.name === name || cmd.data.name === name) return cmd;
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
    public get owner() { return this.filter((command) => command.owner); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.filter((command) => !command.owner); };

    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Client} Класс клиента
     * @return Promise<true>
     * @public
     */
    public register = (client: Client): Promise<boolean> => {
        return new Promise<true>((resolve) => {

            // Загрузка глобальных команд
            client.application.commands.set(this.map((command) => command.data) as any)
                .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.public.length}] has load public commands`))
                .catch(console.error);

            return resolve(true);
        });
    };
}