import { Component, DeclareComponent } from "#handler/components/index.js";
import { Middlewares } from "#handler/commands/index.js";
import { Colors } from "#structures/discord/index.js";
import { locale } from "#structures";

/**
 * @description Кнопка back, отвечает за возврат к прошлому треку
 * @class ButtonBack
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "like"
})
@Middlewares(["queue"])
class ButtonLike extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {

        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.like"),
                    color: Colors.White
                }
            ]
        })
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonLike];