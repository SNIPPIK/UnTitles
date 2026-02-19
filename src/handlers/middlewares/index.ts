import { QueueMessage } from "#core/queue/modules/message";
import { EmbedColors } from "seyfert/lib/common/index.js";
import { MessageFlags } from "seyfert/lib/types/index.js";
import { Colors } from "#structures/discord";
import { createMiddleware } from "seyfert";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Проверяем на наличие в базе с cooldown
 */
const checkCooldown = createMiddleware<void>(async ({ context, next, pass }) => {
    // This will make someone happy.
    if (context.isComponent()) return next();

    const { client, command } = context;
    const { cooldowns } = client;

    if (!command) return pass();

    // Если не автор
    else if (!db.owner.ids.includes(context.author.id)) {
        const cooldown = 3e3;
        const timeNow = Date.now();

        const data = cooldowns.get(context.author.id);
        if (data && timeNow < data) {
            await context.write({
                flags: MessageFlags.Ephemeral,
                embeds: [
                    {
                        description: locale._(context.interaction.locale, "interaction.cooldown"),
                        color: EmbedColors.Red
                    },
                ],
            });

            return pass();
        }

        cooldowns.set(context.author.id, timeNow + cooldown, cooldown);
    }

    return next();
});

/**
 * @description Проверяем клиента на наличие подключения к голосовому каналу
 */
const clientVoiceChannel = createMiddleware<void>(async ({ context, pass, next }) => {
    const me = await context.me();

    const state = context.client.cache.voiceStates!.get(context.author.id, context.guildId!);
    if (!state) {
        console.log("WTF 0_o")
        return pass();
    }

    const bot = context.client.cache.voiceStates!.get(me.id, context.guildId!);

    if (bot && bot.channelId !== state.channelId) {
        await context.editOrReply({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(context.interaction.locale, "middlewares.voice.alt", [context.channel("cache")]),
                    color: EmbedColors.Red,
                }
            ],
        });

        return pass();
    }

    return next();
});

/**
 * @description Проверяем пользователя на наличие голосового канала
 */
const userVoiceChannel = createMiddleware<void>(async ({ context, pass, next }) => {
    const state = context.client.cache.voiceStates!.get(context.author.id, context.guildId!);
    const channel = await state?.channel().catch(() => null);

    if (!channel?.is(["GuildVoice", "GuildStageVoice"])) {
        await context.editOrReply({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(context.interaction.locale, "middlewares.voice.need", [context.author]),
                    color: EmbedColors.Red,
                },
            ]
        });

        return pass();
    }

    return next();
});


/**
 * @description Проверяем на наличие очереди
 */
const checkQueue = createMiddleware<void>(async ({ context, pass, next }) => {
    const queue = db.queues.get(context.interaction.guildId);

    // Если нет очереди
    if (!queue) {
        await context.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(context.interaction.locale, "middlewares.player.queue.need", [context.member]),
                    color: Colors.Yellow
                }
            ]
        });
        return pass();
    }

    return next();
});

/**
 * @author SNIPPIK
 * @description Middleware для проверки проигрывания трека в плеере
 * @class PlayerNotPlaying
 * @extends Assign
 */
const checkPlayerIsPlaying = createMiddleware<void>(async ({ context, pass, next }) => {
    const queue = db.queues.get(context.interaction.guildId);

    // Если музыку нельзя пропустить из-за плеера
    if ((!queue || !queue?.player?.playing) && db.voice.get(context.interaction.guildId)) {
        await context.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(context.interaction.locale, "middlewares.player.not.playing"),
                    color: Colors.DarkRed
                }
            ],
        });
        return pass();
    }

    return next();
});

/**
 * @author SNIPPIK
 * @description Middleware для проверки загружается ли поток в плеере
 * @class PlayerWait
 * @extends Assign
 */
const checkPlayerWaitStream = createMiddleware<void>(async ({ context, pass, next }) => {
    const queue = db.queues.get(context.interaction.guildId);

    // Если музыку нельзя пропустить из-за плеера
    if (queue && queue.player.audio.preloaded) {
        await context.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(context.interaction.locale, "middlewares.player.wait"),
                    color: Colors.DarkRed
                }
            ],
        });
        return pass();
    }

    return next();
});


/**
 * @author SNIPPIK
 * @description Middleware для проверки подключения к другому голосовому каналу
 * @usage Для команд, где требуется проверка на одинаковые каналы
 * @class OtherVoiceChannel
 * @extends Assign
 */
const checkAnotherVoice = createMiddleware<void>(async ({ context, pass, next }) => {
    const VoiceChannel = context.member?.voice("cache")?.channel("cache");
    const state = context.client.cache.voiceStates!.get(context.author.id, context.interaction.guildId);
    const VoiceChannelMe = state?.channel("cache");

    // Если бот в голосовом канале и пользователь
    if (VoiceChannelMe && VoiceChannel) {
        // Если пользователь и бот в разных голосовых каналах
        if (VoiceChannelMe.id !== VoiceChannel.id) {
            const queue = db.queues.get(context.interaction.guildId);

            // Если нет музыкальной очереди
            if (!queue) {
                const connection = db.voice.get(context.interaction.guildId);

                // Отключаемся от голосового канала
                if (connection) connection.disconnect;
            }

            // Если есть музыкальная очередь
            else {
                const users = (await VoiceChannelMe.members()).filter((user) => !user.user.bot);

                // Если нет пользователей в голосовом канале очереди
                if (users.length === 0) {
                    queue.message = new QueueMessage(context as any);
                    queue.voice.connection.channel = VoiceChannel.id;

                    // Сообщаем о подключении к другому каналу
                    await context.write({
                        flags: MessageFlags.Ephemeral,
                        embeds: [
                            {
                                description: locale._(context.interaction.locale, "middlewares.voice.new", [VoiceChannel]),
                                color: Colors.Yellow
                            }
                        ]
                    });
                    return next();
                }

                else {
                    await context.write({
                        flags: MessageFlags.Ephemeral,
                        embeds: [
                            {
                                description: locale._(context.interaction.locale, "middlewares.voice.alt", [VoiceChannelMe]),
                                color: Colors.Yellow
                            }
                        ]
                    });
                    return pass();
                }
            }
        }
    }

    return next();
});

/**
 * @
 */
export const middlewares = {
    checkCooldown, checkQueue, userVoiceChannel, clientVoiceChannel, checkPlayerIsPlaying, checkPlayerWaitStream, checkAnotherVoice
};