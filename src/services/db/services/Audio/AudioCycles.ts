import {AudioPlayer} from "@lib/player";
import {Interact} from "@util/discord";
import {Cycle} from "@util/tools";
import {db} from "@service/db";

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @private
 */
export class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление плеерами
     * @readonly
     * @private
     */
    private readonly _audioPlayers = new class extends Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayer",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player): void => {
                    if (player.voice.connection?.state?.status !== "ready" || player?.status === "player/pause") return;
                    else {
                        const packet = player.audio.current.packet;

                        if (!packet) player.stop();
                        else player.voice.send = packet;
                    }
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Здесь происходит управление сообщениями и их обновлениями
     * @readonly
     * @private
     */
    private readonly _messages = new class extends Cycle<Interact> {
        public constructor() {
            super({
                name: "Message",
                duration: 30e3,
                filter: (message) => !!message.editable,
                execute: (message) => {
                    const {guild} = message;
                    const queue = db.audio.queue.get(guild.id);

                    if (!queue || !queue.player) return this.remove(message);
                    else if (!queue.player.playing || !message.editable) return;

                    // Обновляем сообщение о текущем треке
                    db.audio.queue.events.emit("message/playing", queue, message);
                },
                custom: {
                    remove: (item) => { item.delete = 200; },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        // Удаляем прошлое сообщение
                        if (old) this.remove(old);
                    }
                },
            });
        };
    };

    /**
     * @description Выдаем базу циклов для работы плеера
     * @public
     */
    public get players() { return this._audioPlayers; };

    /**
     * @description Выдаем базу циклов сообщений для обновления сообщения
     * @public
     */
    public get messages() { return this._messages; };
}