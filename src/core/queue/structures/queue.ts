import { ControllerTracks, ControllerVoice, Track } from "#core/queue/index.js";
import { QueueButtons, QueueMessage } from "../modules/message.js";
import { CommandInteraction}  from "#structures/discord/index.js";
import { SpeakerType } from "#core/voice/structures/Speaker.js";
import { VoiceConnection } from "#core/voice/index.js";
import { AudioPlayer } from "#core/player/index.js";
import { Logger } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @class Queue
 * @public
 */
export class Queue {
    /** Текущий экземпляр плеера */
    protected _player: AudioPlayer;

    /** Сообщение пользователя */
    protected _message: QueueMessage<CommandInteraction>;

    /** Создаем класс для отображения фильтров */
    protected _buttons: QueueButtons;

    /** Время создания очереди */
    public timestamp: number = parseInt(Math.max(Date.now() / 1e3).toFixed(0));

    /** Хранилище треков, с умной системой управления */
    public tracks = new ControllerTracks<Track>();

    /** Голосовое подключение */
    public voice = new ControllerVoice<VoiceConnection>();

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message) {
        this._message?.delete?.();
        this._message = message;
    };

    /**
     * @description Выдаем сообщение
     * @return Client.message
     * @public
     */
    public get message() {
        // Если сообщение с сервера уже не доступно
        if (!this._message) return null;
        return this._message;
    };

    /**
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public get player() {
        // Если плеер уже не доступен
        if (!this._player) return null;
        return this._player;
    };

    /**
     * @description Задаем плеер
     * @param player - плеер
     * @public
     */
    public set player(player) {
        const oldPlayer = this._player;

        // Если есть старый плеер
        if (oldPlayer) oldPlayer.destroy();

        // Задаем новый плеер
        this._player = player;
    };

    /**
     * @description Подключаемся к голосовому каналу и задаем подключение
     * @param msg - Сообщение от пользователя
     * @private
     */
    public set joinVoice(msg: QueueMessage<CommandInteraction>) {
        const { guild_id, voice_id } = msg;

        // Подключаемся к голосовому каналу
        this.voice.connection = db.voice.join({
            guild_id,
            channel_id: voice_id,
            self_deaf: true,
            self_mute: false,
            self_speaker: SpeakerType.enable
        }, db.adapter.voiceAdapterCreator(guild_id));
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @constructor
     * @public
     */
    public constructor(message: CommandInteraction) {
        const queue_message = new QueueMessage(message);
        const { guild_id } = queue_message;

        // Подключаемся к гс
        this.joinVoice = queue_message;

        // Задаем плеер
        this.player = new AudioPlayer(this.tracks, this.voice, guild_id);

        // Добавляем данные в класс
        this.message = queue_message;

        // Создаем класс для отображения кнопок
        this._buttons = new QueueButtons(queue_message);

        Logger.log("LOG", `[Queue/${guild_id}] has create`);
    };

    /**
     * @description Выдача компонентов сообщения, такие как кнопки и текст
     * @returns ComponentV2
     * @public
     */
    public get components() {
        // Если класс кнопок (компонентов был уничтожен)
        if (!this._buttons) {
            Logger.log("ERROR", "[Queue/MessageV2]: Fail init buttons class");
            return null;
        }

        const player = this._player, tracks = this.tracks;
        const buttons = this._buttons?.component(player);

        try {
            const { api, artist, name, image, user, url } = tracks.track;

            return [{
                "type": 17, // Container
                "accent_color": api.color,
                "components": [
                    {
                        "type": 9, // Block
                        "components": [
                            {
                                "type": 10,
                                "content": `## ${db.emoji.disk} [${artist.title}](${artist.url})`
                            },
                            {
                                "type": 10,
                                "content": `\`\`\`${name}\`\`\`[${("‾").repeat(name.length)}](${url})`
                            }
                        ],
                        "accessory": {
                            "type": 11,
                            //"description": name, // Подсказка
                            "media": {
                                "url": image.url,
                            }
                        }
                    },
                    {
                        "type": 10, // Text
                        "content": `> -# \`${db.emoji.user} ${user.username}\`  |  \`${player.audio.volumeIndicator}\` ${tracks.footer} |  \`${db.emoji.buffer} ${player.latency}ms | ${db.emoji.lost} ${player.voice.connection.udp.lost}\`` + player.progress
                    },
                    ...buttons
                ]
            }];
        } catch (error) {
            Logger.log("ERROR", error as Error);
        }

        return null;
    };

    /**
     * @description Эта функция частично удаляет очередь
     * @warn Автоматически выполняется при удалении через db
     * @returns void
     * @public
     */
    public cleanup = () => {
        Logger.log("DEBUG", `[Queue/${this.message.guild_id}] has cleanup`);
        if (db.queues.cycles.players.has(this._player)) db.events.emitter.emit("queue/cleanup", this);

        // Останавливаем плеер
        this._player.cleanup();

        // Для удаления динамического сообщения
        this._message.delete();

        // Удаляем статус гс канала
        db.adapter.status(this.message.voice_id, null).catch(() => {
            return null;
        });
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @warn Автоматически удаляется через событие VoiceStateUpdate
     * @returns void
     * @public
     */
    public destroy = () => {
        Logger.log("LOG", `[Queue/${this.message.guild_id}] has destroyed`);
        db.events.emitter.emit("queue/destroy", this);

        this._message = null;
        this.timestamp = null;

        this._buttons.destroy();
        this._buttons = null;

        // Удаляем плеер
        this._player.destroy();
        this._player = null;
    };
}