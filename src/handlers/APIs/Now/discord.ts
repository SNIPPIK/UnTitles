import {API, Constructor} from "@handler";
import {Track} from "@lib/player/track";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
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
                            callback: (attachment: any) => {
                                return new Promise<Track>((resolve) => {
                                    const track = new Track({
                                        id: null,
                                        url: attachment.url,
                                        title: attachment.name, artist: null,
                                        image: {url: attachment.proxyURL},
                                        time: {
                                            total: ((attachment.size / 1024) / 39.2).toFixed(0) as any  //((attachment.size / 1024) / 16.5).toFixed(0)
                                        },
                                        audio: attachment.url
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
export default Object.values({ sAPI });