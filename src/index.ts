import { db } from "@lib/db";
import { Client } from "@lib/discord";
import { env } from "env";

const client = new Client();

client.once("ready", () => {
  db.initialize = client;
});

client.login(env.get("token.discord"));
