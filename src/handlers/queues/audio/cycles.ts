import {Interact, MessageUtils} from "@utils";
import {AudioPlayer} from "@service/player";
import {Cycle} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class Cycles
 */
export class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление циклом для плееров
     * @readonly
     * @public
     */
    public readonly players = new AudioPlayers();

    /**
     * @author SNIPPIK
     * @description Здесь происходит управление циклом, сообщения и обновление сообщений
     * @readonly
     * @public
     */
    public readonly messages = new Messages();
}

/**
 * @author SNIPPIK
 * @description Цикл для работы плеера, необходим для отправки пакетов
 * @class AudioPlayers
 */
class AudioPlayers extends Cycle<AudioPlayer> {
    public constructor() {
        super({
            name: "AudioPlayers",
            duration: 20,
            filter: (item) => item.playing,
            execute: (player) => {
                // Отправляем пакет
                player.voice.send = player.audio.current.packet;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
 * @class Messages
 */
class Messages extends Cycle<Interact> {
    public constructor() {
        super({
            name: "Messages",
            duration: 20e3,
            custom: {
                remove: (item) => { MessageUtils.deleteMessage(item, 200) },
                push: (item) => {
                    const old = this.array.find(msg => msg.guild.id === item.guild.id);

                    // Удаляем прошлое сообщение
                    if (old) this.remove(old);
                }
            },
            filter: (message) => message.editable,
            execute: (message) => {
                const queue = message.queue;

                // Если есть поток в плеере
                if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                    // Обновляем сообщение о текущем треке
                    db.events.emitter.emit("message/playing", queue, message);
                    return;
                }
            }
        });
    };
}