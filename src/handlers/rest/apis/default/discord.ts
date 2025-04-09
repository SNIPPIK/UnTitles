import {RestAPI, RestAPIBase} from "@handler/rest/apis";
import {Track} from "@service/player";
import {Assign} from "@utils";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestDiscordAPI
 * @public
 */
class RestDiscordAPI extends Assign<RestAPI> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestAPIBase = {
        name: "DISCORD",
        color: 9807270,
        url: "discord.com",
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor RestDiscordAPI
     * @public
     */
    public constructor() {
        super({ ...RestDiscordAPI._platform,
            audio: true,
            auth: true,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi,

            requests: [

                /**
                 * @description Запрос данных о треке
                 * @type "track"
                 */
                {
                    name: "track",
                    filter: /attachments|ephemeral-attachments/,
                    execute: (attachment: any) => {
                        return new Promise<Track>((resolve) => {
                            const size = attachment.size / 1024;

                            const track = new Track({
                                id: null,
                                url: attachment.url,
                                title: attachment.name, artist: null,
                                image: {url: attachment.proxyURL},
                                time: {
                                    total: (size / 13.2).toFixed(0)
                                },
                                audio: attachment.proxyURL ?? attachment.url
                            }, RestDiscordAPI._platform);

                            return resolve(track);
                        });
                    }
                }
            ]
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ RestApiDiscord: RestDiscordAPI });