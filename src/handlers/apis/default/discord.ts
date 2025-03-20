import {Track} from "@service/player";
import {API, APISmall} from "@handler/apis";
import {Assign} from "@utils";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Assign<API> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: APISmall = {
        name: "DISCORD",
        color: 9807270,
        url: "discord.com",
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({ ...sAPI._platform,
            audio: true,
            auth: true,
            filter: /^(https?:\/\/)?(cdn\.)?( )?(discordapp\.com|discord\.gg)\/.+$/gi,

            requests: [

                /**
                 * @description Запрос данных о треке
                 * @type track
                 */
                {
                    name: "track",
                    filter: /attachments|ephemeral-attachments/,
                    execute: (attachment: any) => {
                        return new Promise<Track>((resolve) => {
                            const track = new Track({
                                id: null,
                                url: attachment.url,
                                title: attachment.name, artist: null,
                                image: {url: attachment.proxyURL},
                                time: {
                                    total: ((attachment.size / 1024) / 39.2).toFixed(0)
                                },
                                audio: attachment.url
                            }, sAPI._platform);

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
export default Object.values({ sAPI });