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
        const rss           = toMB(mem.rss);
        const heapUsed      = toMB(mem.heapUsed);
        const heapTotal     = toMB(mem.heapTotal);
        const external      = toMB(mem.external);
        const arrayBuffers  = toMB(mem.arrayBuffers);
        const rust          = toMB((mem.rss - mem.heapTotal - mem.external - mem.arrayBuffers - mem.heapUsed) / 2);

        // ── Формируем embed с секциями ──────────────────────────────
        const embed = {
            color: Colors.White,
            title: `📊 ${ctx.client.me.username} Status`,
            fields: [
                {
                    name: "🧩 Runtime",
                    value: [
                        `Shard: **${ctx.shardId}**`,
                        `Uptime: **${Math.floor(process.uptime())}s**`,
                        `Node.js: **${process.version}**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "💾 Memory",
                    value: [
                        `RSS: **${rss} MB**`,
                        `Heap: **${heapUsed} / ${heapTotal} MB**`,
                        `External: **${external} MB**`,
                        `ArrayBuffers: **${arrayBuffers} MB**`,
                        `Native (Rust): **≈ ${rust} MB**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "🎵 Audio",
                    value: [
                        `Queues: **${db.queues.size}**`,
                        `Players: **${db.queues.size}**`,
                        `Voice Sessions: **${db.voice.size}**`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: "🌐 REST",
                    value: [
                        `APIs: **${db.api.array.length}**`,
                        `Workers: **1**`,
                    ].join('\n'),
                    inline: true,
                },
            ],
            image: {
                url: db.images.banner, // Баннер (если есть)
            },
            timestamp: new Date().toISOString(),
        };

        // ── Отправляем эфемерный ответ ──────────────────────────────
        return ctx.write({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    };
}