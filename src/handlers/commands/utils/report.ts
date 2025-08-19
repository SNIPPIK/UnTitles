import { Declare, Command, CommandContext, Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Получение embed сообщения с данными для общения с разработчиком
 * @class ReportCommand
 * @extends Command
 * @public
 *
 *
 * @license BSD-3-Clause + custom restriction | Эта команда защищена лицензией проекта, изменение или удаление строго запрещено!!!
 */
@Declare({
    names: {
        "en-US": "report",
        "ru": "репорт"
    },
    descriptions: {
        "en-US": "If you have anything to report to the developer!",
        "ru": "Если есть что сообщить разработчику!"
    },
    integration_types: ["GUILD_INSTALL", "USER_INSTALL"],
    contexts: ["GUILD"]
})
@Middlewares(["cooldown"])
class ReportCommand extends Command {
    async run({ctx}: CommandContext<any>) {
        const lang = ctx.locale;

        // Отправляем сообщение в текстовый канал
        const msg= await ctx.reply({
            flags: "IsComponentsV2",
            components: [
                {
                    "type": 17, // Container
                    "accent_color": Colors.White,
                    "components": [
                        {
                            "type": 12, // Media
                            items: [
                                {
                                    "media": {
                                        "url": db.images.banner
                                    }
                                }
                            ]
                        },
                        {
                            "type": 10, // Text
                            "content": `# ${locale._(lang, "report")} - ${ctx.guild.name}`
                        },
                        {
                            "type": 10, // Text
                            "content": `### Форма для отправки чего либо\n- Вы можете сообщить о проблеме или идее через форму!`
                        },
                        // Кнопки
                        {
                            type: 1,
                            components: [
                                {
                                    "type": 2,
                                    "label": locale._(lang, "creator"),
                                    "style": 5,
                                    "url": `https://github.com/SNIPPIK`
                                },
                                {
                                    "type": 2,
                                    "label": "GitHub Project",
                                    "style": 5,
                                    "url": `https://github.com/SNIPPIK/UnTitles`
                                },
                                {
                                    "type": 2,
                                    "label": locale._(lang, "report"),
                                    "style": 5,
                                    "url": lang === "ru" ? "https://docs.google.com/forms/d/e/1FAIpQLSeItAWfJ9OjJmBWLhmPMSTAA-CL_Pc_Hu4tD74fxELrxNAzHA/viewform?usp=dialog" : "https://docs.google.com/forms/d/e/1FAIpQLScrk3ueLrK8JFlKXAi6h7NJIh7IFA46nLUevt-jr1XmYj9H2Q/viewform?usp=dialog"
                                },
                            ]
                        },
                    ]
                }
            ]
        });

        // Таймер для удаления сообщения
        setTimeout(() => msg.delete().catch(() => null), 20e3);
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ ReportCommand ];