import {Colors,EmbedData} from "discord.js";
import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Assign} from "@utils";

class ButtonQueue extends Assign<Button> {
    public constructor() {
        super({
            name: "queue",
            callback: (msg) => {
                const queue = msg.queue;
                const page = parseInt((queue.tracks.position / 5).toFixed(0));
                const pages = queue.tracks.array(5, true) as string[];
                const embed: EmbedData = {
                    color: Colors.Green,
                    author: {
                        name: `${locale._(msg.locale, "queue")} - ${msg.guild.name}`,
                        iconURL: queue.tracks.track.artist.image.url
                    },
                    thumbnail: {
                        url: msg.guild.iconURL()
                    },
                    fields: [
                        {
                            name: locale._(msg.locale, "player.current.playing"),
                            value: `\`\`${queue.tracks.position + 1}\`\` - ${queue.tracks.track.name_replace}`
                        },
                        pages.length > 0 ? {name: locale._(msg.locale, "queue"), value: pages[page]} : null
                    ],
                    footer: {
                    text: locale._(msg.locale, "player.button.queue.footer", [queue.tracks.track.user.displayName, page + 1, pages.length, queue.tracks.total, queue.tracks.time]),
                        iconURL: queue.tracks.track.user.avatar
                    },
                    timestamp: queue.timestamp
                };

                new msg.builder().addEmbeds([embed])
                    .setMenu({type: "table", pages, page})
                    .setTime(60e3)
                    .setCallback((message, pages: string[], page: number) => {
                        return message.edit({
                            embeds: [
                                {
                                    ...embed as any,
                                    color: Colors.Green,
                                    fields: [
                                        embed.fields[0],
                                        {
                                            name: locale._(msg.locale, "queue"),
                                            value: pages[page]
                                        }
                                    ],
                                    footer: {
                                        ...embed.footer,
                                        text: locale._(msg.locale, "player.button.queue.footer", [msg.author.username, page + 1, pages.length, queue.tracks.total, queue.tracks.time])
                                    }
                                }
                            ]
                        });
                    }).send = msg;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ButtonQueue});