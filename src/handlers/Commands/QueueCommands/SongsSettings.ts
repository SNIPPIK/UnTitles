import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @class SkipTracksCommand
 * @command skip
 * @description Пропуск треков до указанного трека!
 */
class SkipTracksCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("skip")
                .setDescription("Пропуск треков до указанного трека!")
                .setDescriptionLocale({
                    "en-US": "Skip tracks to the specified track!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Номер трека!",
                        descriptionLocalizations: {
                            "en-US": "Number track in queue"
                        },
                        type: ApplicationCommandOptionType["Number"],
                        required: true
                    }
                ])
                .json,
            execute: ({}) => {
            }
        });
    };
}

/**
 * @class RemoveTrackCommand
 * @command remove
 * @description Удаление трека из очереди
 */
class RemoveTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("remove")
                .setDescription("Удаление трека из очереди, без возможности восстановить!")
                .setDescriptionLocale({
                    "en-US": "Deleting a track from the queue, without the possibility of recovery!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Номер трека!",
                        descriptionLocalizations: {
                            "en-US": "Number track in queue"
                        },
                        type: ApplicationCommandOptionType["Number"],
                        required: true
                    }
                ])
                .json,
            execute: ({}) => {
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({SkipTracksCommand, RemoveTrackCommand});