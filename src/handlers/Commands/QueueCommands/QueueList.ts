import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @class QueueListCommand
 * @command queue
 * @description Управление очередью
 */
class QueueListCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("queue")
                .setDescription("Управление очередью!")
                .setDescriptionLocale({
                    "en-US": "Setting music queue!"
                })
                .addSubCommands([
                    {
                        name: "total",
                        description: "Полный список треков!",
                        descriptionLocalizations: {
                            "en-US": "All tracks list!"
                        },
                        type: ApplicationCommandOptionType["User"],
                        required: true
                    }
                ])
                .json,
            execute: ({type}) => {

                // Все треки в очереди
                if (type === "total") {

                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({QueueListCommand});