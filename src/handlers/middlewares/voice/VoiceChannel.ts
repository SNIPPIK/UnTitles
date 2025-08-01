import { CommandInteraction, Colors } from "#structures/discord";
import { QueueMessage } from "#core/queue/structures/message";
import { middleware } from "#handler/middlewares";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Middleware для проверки подключения к голосовому каналу пользователя
 * @usage Для команд, где требуется голосовой канал
 * @class VoiceChannel
 * @extends Assign
 */
class VoiceChannel extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "voice",
            callback: async (ctx) => {
                const VoiceChannel = ctx.member.voice.channel;

                // Если нет голосового подключения
                if (!VoiceChannel) {
                    await ctx.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(ctx.locale, "middlewares.voice.need", [ctx.member]),
                                color: Colors.Yellow
                            }
                        ],
                    })
                    return false;
                }

                return true;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Middleware для проверки подключения к другому голосовому каналу
 * @usage Для команд, где требуется проверка на одинаковые каналы
 * @class OtherVoiceChannel
 * @extends Assign
 */
class OtherVoiceChannel extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "another_voice",
            callback: async (ctx) => {
                const VoiceChannelMe = ctx.guild?.members?.me?.voice?.channel;
                const VoiceChannel = ctx.member?.voice?.channel;

                // Если бот в голосовом канале и пользователь
                if (VoiceChannelMe && VoiceChannel) {
                    // Если пользователь и бот в разных голосовых каналах
                    if (VoiceChannelMe.id !== VoiceChannel.id) {
                        const queue = db.queues.get(ctx.guildId);

                        // Если нет музыкальной очереди
                        if (!queue) {
                            const connection = db.voice.get(ctx.guildId);

                            // Отключаемся от голосового канала
                            if (connection) connection.disconnect;
                        }

                        // Если есть музыкальная очередь
                        else {
                            const users = VoiceChannelMe.members.filter((user) => !user.user.bot);

                            // Если нет пользователей в голосовом канале очереди
                            if (users.size === 0) {
                                queue.message = new QueueMessage(ctx);
                                queue.voice.connection.swapChannel = VoiceChannel.id;

                                // Сообщаем о подключении к другому каналу
                                ctx.channel.send({
                                    embeds: [
                                        {
                                            description: locale._(ctx.locale, "middlewares.voice.new", [VoiceChannel]),
                                            color: Colors.Yellow
                                        }
                                    ]
                                }).then((msg) => setTimeout(() => msg.delete().catch(() => null), 5e3));
                                return true;
                            }

                            else {
                                await ctx.reply({
                                    flags: "Ephemeral",
                                    embeds: [
                                        {
                                            description: locale._(ctx.locale, "middlewares.voice.alt", [VoiceChannelMe]),
                                            color: Colors.Yellow
                                        }
                                    ]
                                });
                                return false;
                            }
                        }
                    }
                }

                return true;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [VoiceChannel, OtherVoiceChannel];