import {API, Constructor} from "@handler";
import {Track} from "@lib/player/queue";
import {Attachment} from "discord.js";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 */
class sAPI extends Constructor.Assign<API.request> {
    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({
            name: "DISCORD",
            audio: true,
            auth: true,

            color: 9807270,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi,
            url: "discord.com",

            requests: [
                /**
                 * @description Запрос данных о треке
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /attachments|ephemeral-attachments/,
                            //@ts-ignore
                            callback: (attachment: Attachment) => {
                                return new Promise<Track>((resolve) => {
                                    const track = new Track({
                                        url: attachment.url,
                                        title: attachment.name, artist: null,
                                        image: {url: attachment.proxyURL},
                                        time: {
                                            total: ((attachment.size / 1024) / 39.2).toFixed(0) as any  //((attachment.size / 1024) / 16.5).toFixed(0)
                                        },
                                        audio: {
                                            type: "url",
                                            url: attachment.url
                                        }
                                    });

                                    return resolve(track);
                                });
                            }
                        });
                    };
                }
            ]
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({cAPI: sAPI});