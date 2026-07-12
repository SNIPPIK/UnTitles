import type { CompeteInteraction } from "#structures/discord/index.js";
import filters from "#core/player/filters.json" with { type: 'json' };
import type { LocalizationMap } from "discord-api-types/v10";
import type { RestClientSide } from "#handler/rest/index.js";
import type { AudioFilter } from "#core/player/index.js";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с командами
 * @class Commands
 * @public
 */
export class Commands {
    /**
     * @description Создаем список фильтров для UI discord
     * @public
     */
    public get filters_choices() {
        const temples: Choice[] = [];

        // Если фильтров слишком много
        if (filters.length > 25) return temples;

        // Перебираем фильтр
        for (const filter of filters as AudioFilter[]) {
            // Проверяем кол-во символов на допустимость discord (100 шт.)
            for (const [key, value] of Object.entries(filter.locale)) {
                if (value.startsWith("[")) continue;

                // Добавляем диапазон аргументов
                if (filter.args) filter.locale[key] = `<${filter.args[0]}-${filter.args[1]}> - ${filter.locale[key]}`;

                // Удаляем лишний размер описания
                filter.locale[key] = value.length > 75 ? `[${filter.name}] - ${filter.locale[key].substring(0, 75)}...` : `[${filter.name}] - ${filter.locale[key]}`;
            }

            // Создаем список для показа фильтров в командах
            temples.push({
                name: filter.locale[Object.keys(filter.locale)[0]],
                nameLocalizations: filter.locale,
                value: filter.name
            });
        }

        return temples;
    };

    /**
     * @description Отправка данных в зависимости от текста пользователя
     * @param message - Сообщение
     * @param platform - Платформа
     * @param search - Текст или ссылка пользователя
     * @public
     */
    public playAutocomplete = async (message: CompeteInteraction, platform: RestClientSide.Request, search: string) => {
        // Если платформа заблокирована
        if (platform?.block || !platform?.auth) {
            return message.respond([
                {
                    name: locale._(message.locale, "api.platform.block"),
                    value: "|BLOCK_PLATFORM|"
                }
            ])
        }

        // Получаем функцию запроса данных с платформы
        const api = platform.request(search, { audio: false });

        if (!api.type) {
            return message.respond([
                {
                    name: locale._(message.locale, "api.request.fail"),
                    value: "|CriticalError|"
                }
            ])
        }

        try {
            // Получаем данные в системе rest/API
            const rest = await api.request();
            const items: { value: string; name: string }[] = [];

            // Если получена ошибка или нет данных
            if (rest instanceof Error || !rest) {
                return message.respond([
                    {
                        name: locale._(message.locale, "api.error", [`${rest}`]),
                        value: "|CriticalError|"
                    }
                ])
            }

            // Обработка массива данных
            if (Array.isArray(rest)) {
                items.push(...rest.map((track) => {
                    return {
                        name: `🎵 (${track.time?.split}) | ${track.artist.title?.slice(0, 20)} - ${track.name?.slice(0, 60)}`,
                        value: track.url,
                    }
                }));
            }

            // Показываем плейлист
            else if ("items" in rest) items.push({
                name: `${db.emoji.queue} [${rest.items.length}] - ${rest.title?.slice(0, 70)}`,
                value: rest.url
            });

            // Показываем трек
            else {
                items.push({
                    name: `🎵 (${rest.time?.split}) | ${rest.artist.title?.slice(0, 20)} - ${rest.name?.slice(0, 60)}`,
                    value: rest.url
                });
            }

            // Отправка ответа
            return message.respond(items);
        } catch (err) {
            console.error(err);
            return null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для выбора (choice) в опциях типа String, Integer, Number.
 * @public
 */
export interface Choice {
    /** Отображаемое имя выбора. */
    name: string;

    /** Значение, отправляемое при выборе. */
    value: string;

    /** Локализованные имена выбора. */
    nameLocalizations?: LocalizationMap;
}