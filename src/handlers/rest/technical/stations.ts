import { APIPlatformType, DeclareRest, RestServerSide } from "#handler/rest/index.js";
import RadioList from "#core/player/stations.json" with { type: 'json' };

/**
 * @author SNIPPIK
 * @description Взаимодействие с технической платформой, динамический плагин
 */

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestRadioAPI
 * @public
 */
@DeclareRest({
    name: "RADIO",
    color: 1752220,
    audio: true,
    auth: true,
    type: APIPlatformType.technical
})
class RestRadioAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Получение любой информации в 1 типе
         * @type "all"
         */
        {
            name: "all",
            execute: async (search) => {
                const radio = RadioList.filter((d) => d.name.toLowerCase().match(search.toLowerCase()));
                return radio.map(this.track);
            }
        },
    ];

    /**
     * @description Создаем фальшивый трек
     * @param data - Данные о станции
     * @protected
     */
    protected track = (data: any) => {
        return {
            title: data.name,
            url: data.url,
            artist: {
                title: "Radio " + data.name,
                url: data.url
            },
            image: null,
            time: {
                total: "Live"
            },
            audio: data.url
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ RestRadioAPI ];