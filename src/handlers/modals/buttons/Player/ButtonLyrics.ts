import {locale} from "#service/locale";
import {Button} from "#handler/modals";
import {Assign, Logger} from "#utils";
import {Colors} from "discord.js";
import {db} from "#app/db";

class ButtonLyrics extends Assign<Button> {
    public constructor() {
        super({
            name: "lyrics",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);
                const track = queue.tracks.track;

                // Получаем текст песни
                track.lyrics

                    // При успешном ответе
                    .then((item) => {
                        // Отправляем сообщение с текстом песни
                        return message.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    color: Colors.White,
                                    thumbnail: track.image,
                                    author: {
                                        name: track.name,
                                        url: track.url,
                                        icon_url: track.artist.image.url
                                    },
                                    description: `\`\`\`css\n${item !== undefined ? item : locale._(message.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                    timestamp: new Date() as any
                                }
                            ]
                        });
                    })

                    // При ошибке, чтобы процесс нельзя было сломать
                    .catch((error) => {
                        Logger.log("ERROR", error);

                        // Отправляем сообщение с текстом песни
                        return message.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    color: Colors.White,
                                    thumbnail: track.image,
                                    author: {
                                        name: track.name,
                                        url: track.url,
                                        icon_url: track.artist.image.url
                                    },
                                    description: `\`\`\`css\n${locale._(message.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                    timestamp: new Date() as any
                                }
                            ]
                        });
                    })
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonLyrics];