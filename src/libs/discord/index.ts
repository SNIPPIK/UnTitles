import { Client as dClient, Partials, IntentsBitField } from "discord.js";

/**
 * @author SNIPPIK
 * @description Базовый класс для взаимодействия с discord
 * @class Client
 */
export class Client extends dClient {
  /**
   * @description Задаем параметры для класса
   * @public
   */
  public constructor() {
    super({
      allowedMentions: {
        parse: ["roles", "users"],
        repliedUser: true,
      },
      intents: [
        IntentsBitField.Flags["GuildEmojisAndStickers"],
        IntentsBitField.Flags["GuildIntegrations"],
        IntentsBitField.Flags["GuildVoiceStates"],
        IntentsBitField.Flags["Guilds"],
      ],
      partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
      ],
      shardCount: 1e3,
      shards: "auto",
    });
  }
}
