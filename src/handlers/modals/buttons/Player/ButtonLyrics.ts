import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Assign, Logger} from "@utils";
import {Colors} from "discord.js";

class ButtonLyrics extends Assign<Button> {
    public constructor() {
        super({
            name: "lyrics",
            callback: (msg) => {
                const queue = msg.queue;
                const track = queue.tracks.track;

                // Получаем текст песни
                track.lyrics

                    // При успешном ответе
                    .then((item) => {
                        // Отправляем сообщение с текстом песни
                        new msg.builder().addEmbeds([
                            {
                                color: Colors.White,
                                thumbnail: track.image,
                                author: {
                                    name: track.name,
                                    url: track.url,
                                    iconURL: track.artist.image.url
                                },
                                description: `\`\`\`css\n${item !== undefined ? item : locale._(msg.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                timestamp: new Date()
                            }
                        ]).setTime(60e3).send = msg;
                    })

                    // При ошибке, чтобы процесс нельзя было сломать
                    .catch((error) => {
                        Logger.log("ERROR", error);

                        // Отправляем сообщение с текстом песни
                        new msg.builder().addEmbeds([
                            {
                                color: Colors.White,
                                thumbnail: track.image,
                                author: {
                                    name: track.name,
                                    url: track.url,
                                    iconURL: track.artist.image.url
                                },
                                description: `\`\`\`css\n${locale._(msg.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                timestamp: new Date()
                            }
                        ]).setTime(10e3).send = msg;
                    })
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ButtonLyrics});