import { config } from "seyfert";

/**
 * @author SNIPPIK
 * @description Конфиг для библиотеки seyfert
 */
export default config.bot({
    debug: process.env["NODE_ENV"] === "development",
    token: process.env["token.discord"],

    locations: {
        base: "build/src",
        components: "handlers/components",
        commands: "handlers/commands",
        events: "handlers/events"
    },

    intents: [
        "Guilds",
        "GuildMessages",
        "GuildVoiceStates"
    ]
});