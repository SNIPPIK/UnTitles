import {
    Command,
    type CommandContext,
    createNumberOption,
    Declare,
    Locales,
    Middlewares,
    Options,
    SubCommand
} from 'seyfert';
import {ComponentType, MessageFlags} from 'seyfert/lib/types';
import {Colors} from '#structures/discord';
import {locale} from '#structures';
import {db} from '#app/db';

/**
 * Подкоманда: список треков
 */
@Declare({
    name: 'list',
    description: 'View tracks in the current queue!',
    integrationTypes: ['GuildInstall'],
    botPermissions: ['SendMessages', 'ViewChannel']
})
@Locales({
    name: [['ru', 'список']],
    description: [['ru', 'Просмотр треков в текущей очереди!']]
})
@Options({
    value: createNumberOption({
        required: true,
        description: 'Specify the track position to get +-10 tracks. When selected, the selected one will be shown',
        name_localizations: { ru: 'число' },
        description_localizations: {
            ru: 'Укажите позицию трека для получения +-10 треков. При выборе будет показан выбранный'
        },
        autocomplete: async (ctx) => {
            const queue = db.queues.get(ctx.guildId);
            const { tracks } = queue;
            const { position } = tracks;

            // Определяем центральную позицию для отображения
            let center: number;
            const input = ctx.getInput();
            if (input === '') {
                center = position; // ничего не введено – показываем вокруг текущего трека
            } else {
                const num = Number(input);
                center = input === '0' ? 1 : isNaN(num) ? position : num - 1;
            }

            // Получаем треки до и после центра
            const before = tracks.array(-10, center);
            const after = tracks.array(10, center);

            const choices = [...before, ...after].map((track, i) => {
                const value = center - before.length + i;
                const isCurrent = value === position;
                const Selected = center === value;

                let emoji = '🎶';
                if (isCurrent && !Selected) emoji = '▶️';
                else if (Selected && !isCurrent) emoji = '➡️';
                else if (Selected && isCurrent) emoji = '➡ 🎵️';

                return {
                    name: `${value + 1}. ${emoji} (${track.time.split}) | ${track.artist.title.slice(0, 35)} - ${track.name.slice(0, 75)}`,
                    value
                };
            });

            await ctx.respond(choices);
        }
    })
})
class QueueListCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const queue = db.queues.get(ctx.guildId);
        const value = ctx.options["value"] as number;

        const track = queue.tracks.get(value);
        if (!track) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, 'command.queue.track.notfound', [queue.tracks.total]),
                        color: Colors.White
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        const { artist, url, name, image, api, ID, time, user } = track;

        return ctx.write({
            components: [
                {
                    type: ComponentType.Container,
                    "accent_color": api.color,
                    components: [
                        {
                            "type": 9,
                            "components": [
                                {
                                    "type": 10,
                                    "content": `## ${db.images.disk_emoji} **[${artist.title}](${artist.url})**`
                                },
                                {
                                    "type": 10,
                                    "content": `### **[${name}](${url})**\n> ${ID}\n> ${time.split}`
                                }
                            ],
                            "accessory": {
                                "type": 11,
                                "media": {
                                    "url": image.url
                                }
                            }
                        },
                        {
                            "type": 14, // Separator
                            "divider": true,
                            "spacing": 1
                        },
                        {
                            "type": 10,
                            "content": `-# ${user.username} ● ${time.split} | 🎵 ${api.name.toLowerCase()}`
                        }
                    ]
                }
            ],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
        });
    }
}

/**
 * Подкоманда: удаление очереди
 */
@Declare({
    name: 'destroy',
    description: 'Queue deletion! No way to return tracks, player, queue!',
    integrationTypes: ['GuildInstall'],
    botPermissions: ['SendMessages', 'ViewChannel']
})
@Locales({
    name: [['ru', 'удаление']],
    description: [['ru', 'Удаление очереди! Без возможности вернуть треки, плеер, очередь!']]
})
class QueueDestroyCommand extends SubCommand {
    async run(ctx: CommandContext) {
        db.queues.remove(ctx.guildId);
        db.voice.remove(ctx.guildId);

        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, 'command.queue.destroy'),
                    color: Colors.White
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}

/**
 * Родительская команда /queue
 */
@Declare({
    name: 'queue',
    description: 'Advanced control of music inclusion!',
    integrationTypes: ['GuildInstall'],
    botPermissions: ['SendMessages', 'ViewChannel']
})
@Locales({
    name: [['ru', 'очередь']],
    description: [['ru', 'Расширенное управление включение музыки!']]
})
@Options([QueueListCommand, QueueDestroyCommand])
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice", "checkQueue"])
export default class QueueCommand extends Command {}