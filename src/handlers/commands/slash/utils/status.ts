import { Command, CommandContext, Declare, Middlewares, Locales } from "seyfert";
import { Colors } from "#structures/discord/index.js";
import { MessageFlags } from "discord-api-types/v10";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Сообщение с данными бота
 * @class StatusCommand
 * @extends Command
 * @public
 */
@Declare({
    name: "status",
    description: "Current statistics for the shard in use!",
    integrationTypes: ["GuildInstall", "UserInstall"], // Доступно в гильдиях и ЛС
    contexts: [0], // Только в гильдии (0 = Guild) — как в оригинале
    botPermissions: ["SendMessages", "EmbedLinks"],
})
@Locales({
    name: [
        ["ru", "статус"],
        ["en-US", "status"]
    ],
    description: [
        ["ru", "Текущая статистика используемого осколка!"],
        ["en-US", "Current statistics for the shard in use!"]
    ]
})
@Middlewares(["checkCooldown"])
export default class StatusCommand extends Command {
    run = (ctx: CommandContext)=> {
        // ── Утилита для перевода байтов в мегабайты ─────────────────
        const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

        // ── Данные о памяти ─────────────────────────────────────────
        const mem = process.memoryUsage();
        const total         = toMB(mem.rss + Math.abs(mem.heapUsed - mem.heapTotal));
        const rss           = toMB(mem.rss);
        const heapUsed      = toMB(mem.heapUsed);
        const heapTotal     = toMB(mem.heapTotal);
        const external      = toMB(mem.external);
        const arrayBuffers  = toMB(mem.arrayBuffers);

        // ── Формируем embed с секциями ──────────────────────────────
        const embed = {
            color: Colors.White,
            title: `📊 ${ctx.client.me.username} Status`,
            image: { url: db.images.banner },
            fields: [
                {
                    name: "🧩 Runtime",
                    value: [
                        `Shard: **${ctx.shardId}**`,
                        `Uptime: **${Math.floor(process.uptime())} sec**`,
                        `Node.js: **${process.version}**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "💾 Memory",
                    value: [
                        `Outside:       **${total} MB**`,
                        `RSS\\Rust:     **${rss} MB**`,
                        `Heap:          **${heapUsed} / ${heapTotal} MB**`,
                        `External:      **${external} MB**`,
                        `ArrayBuffers:  **${arrayBuffers} MB**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "🎵 Audio",
                    value: [
                        `Queues:         **${db.queues.size}**`,
                        `Players:        **${db.queues.cycles.players.size}**`,
                        `Messages:       **${db.queues.cycles.messages.size}**`,
                        `Voice Sessions: **${db.voice.size}**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "🌐 REST",
                    value: [
                        `APIs:          **${db.api.array.length}**`,
                        `APIs/Audio:    **${db.api.array_audio.length}**`,
                        `APIs/Auth:     **${db.api.array_auth.length}**`,
                        `APIs/Related:  **${db.api.array_related.length}**`,
                        `Requests:      **${db.api.pending.size}**`,
                    ].join('\n'),
                    inline: true,
                },
            ],
            timestamp: new Date().toISOString(),
        };

        // ── Отправляем эфемерный ответ ──────────────────────────────
        return ctx.write({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    };
}