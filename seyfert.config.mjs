import { config } from "seyfert";

/**
 * @author SNIPPIK
 * @description Конфиг для библиотеки seyfert
 */
export default config.bot({
    debug: false,
    // Токен бота
    token: process.env["token.discord"],

    locations: {
        base: "src",
        components: "handlers/components",
        commands: "handlers/commands",
        events: "handlers/events"
    },

    intents: [
        "Guilds",
        "GuildMessages",
        "GuildVoiceStates",
        "DirectMessages"
    ]
});