import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { sdb } from "#worker/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой Apple Music, динамический плагин
 * # Пока не готов для использования
 * # Types
 * - Track -
 * - Playlist -
 * - Search -
 * @Specification Rest Apple Music API
 */

/**
 * @author SNIPPIK
 * @description Apple Music API
 */
@DeclareRest({
    name: "APPLE_MUSIC",
    color: 0xfa2c56,
    url: "music.apple.com",
    audio: false,
    auth: true,
    filter: /^(https?:\/\/)?(music\.apple\.com|itunes\.apple\.com)/i
})
@OptionsRest({
    api: "https://api.music.apple.com/v1",
    token: null,
    time: 0
})
class RestAppleMusicAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        // Track
        {
            name: "track",
            filter: /\/(song|music-video)\/[0-9]+/i,
            execute: async (url) => {
                const id = url.match(/\/(song|music-video)\/([0-9]+)/i)?.[2];
                if (!id) return locale.err("api.request.id.track");

                const cache = sdb.meta_saver?.get?.(`${this.url}/${id}`);
                if (cache) return cache;

                const api = await this.API(`catalog/${this.region}/songs/${id}`);
                if (api instanceof Error) return api;

                const trackData = api.data[0];
                const track = this.track(trackData);

                setImmediate(() => sdb.meta_saver?.set(track, this.url));
                return track;
            }
        },

        // Album
        {
            name: "album",
            filter: /\/album\/[0-9a-z-]+\/[0-9]+/i,
            execute: async (url, { limit = 100 }) => {
                const id = url.match(/\/album\/[^\/]+\/([0-9]+)/i)?.[1];
                if (!id) return locale.err("api.request.id.album");

                const api = await this.API(`catalog/${this.region}/albums/${id}?include=tracks&limit=${limit}`);
                if (api instanceof Error) return api;

                const album = api.data[0];
                const tracks = album.relationships.tracks.data.map(t => this.track(t));

                return {
                    id: album.id,
                    url: album.attributes.url,
                    title: album.attributes.name,
                    image: album.attributes.artwork.url.replace("{w}x{h}", "1200x1200"),
                    items: tracks,
                    artist: { title: album.attributes.artistName, url: null }
                };
            }
        },

        // Playlist
        {
            name: "playlist",
            filter: /\/playlist\/pl\.[0-9a-z]+/i,
            execute: async (url, { limit = 100 }) => {
                const id = url.match(/pl\.([0-9a-z]+)/i)?.[1];
                if (!id) return locale.err("api.request.id.playlist");

                const api = await this.API(`catalog/${this.region}/playlists/pl.${id}?include=tracks&limit=${limit}`);
                if (api instanceof Error) return api;

                const playlist = api.data[0];
                const tracks = playlist.relationships.tracks.data.map(t => this.track(t));

                return {
                    url: playlist.attributes.url,
                    title: playlist.attributes.name,
                    image: playlist.attributes.artwork?.url.replace("{w}x{h}", "1200x1200") || null,
                    items: tracks
                };
            }
        },

        // Search
        {
            name: "search",
            execute: async (query, { limit = 25 }) => {
                const api = await this.API(`catalog/${this.region}/search?term=${encodeURIComponent(query)}&types=songs,albums&limit=${limit}`);
                if (api instanceof Error) return api;

                return api.results.songs?.data.map(t => this.track(t)) || [];
            }
        }
    ];

    // Регион по умолчанию (можно переопределять в настройках)
    private get region() {
        return "us";
    }

    // Авторизация через MusicKit Developer Token (JWT)
    protected async authorization(): Promise<Error | string> {
        if (!this.auth) return new Error("Apple Music: developer token not set");

        // Токен уже в env — просто кладём его
        this.options.token = this.auth;
        // Apple токены живут 6 месяцев — ставим условно "вечное" время
        this.options.time = Date.now() + 180 * 24 * 60 * 60 * 1000;

        return super.authorization();
    }

    // Основной запрос
    protected API = (path: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            if (!this.options.token) await this.authorization();

            new httpsClient({
                url: `${this.options.api}/${path}`,
                headers: {
                    "Authorization": `Bearer ${this.options.token}`,
                    "Music-User-Token": ""
                },
                agent: this.agent
            }).toJson
                .then(api => {
                    if (!api || api instanceof Error) return resolve(locale.err("api.request.fail"));
                    if (api.errors) return resolve(locale.err("api.request.fail.msg", [api.errors[0].title]));
                    resolve(api);
                })
                .catch(err => resolve(new Error(`[AppleMusic]: ${err}`)));
        });
    };

    // Единый сборщик трека
    protected track = (data: any, fallbackImages?: any[]) => {
        const artwork = data.attributes.artwork;
        const imageUrl = artwork
            ? artwork.url.replace("{w}x{h}", "1200x1200")
            : fallbackImages?.[0]?.url || null;

        return {
            id: data.id,
            title: data.attributes.name,
            url: data.attributes.url,
            artist: {
                title: data.attributes.artistName,
                url: data.attributes.artistUrl || null
            },
            time: { total: Math.round(data.attributes.durationInMillis / 1000).toString() },
            image: imageUrl,
            audio: null,
            platform: "APPLE_MUSIC" as const
        };
    };
}

export default [RestAppleMusicAPI];