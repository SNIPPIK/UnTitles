import { ControllerTracks, ControllerVoice, Track } from "#core/queue";
import { QueueButtons, QueueMessage } from "../modules/message";
import { SpeakerType } from "#core/voice/modules/Speaker";
import { CommandInteraction}  from "#structures/discord";
import { VoiceConnection } from "#core/voice";
import { AudioPlayer } from "#core/player";
import { Logger } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @class Queue
 * @public
 */
export class Queue {
    /**
     * @description Время создания очереди
     * @public
     */
    public timestamp: number = parseInt(Math.max(Date.now() / 1e3).toFixed(0));

    /**
     * @description Текущий экземпляр плеера
     * @protected
     */
    protected _player: AudioPlayer;

    /**
     * @description Хранилище треков, с умной системой управления
     * @public
     */
    public tracks = new ControllerTracks<Track>();

    /**
     * @description Голосовое подключение
     * @public
     */
    public voice = new ControllerVoice<VoiceConnection>();

    /**
     * @description Сообщение пользователя
     * @protected
     */
    protected _message: QueueMessage<CommandInteraction>;

    /**
     * @description Создаем класс для отображения фильтров
     * @protected
     */
    protected _buttons: QueueButtons;

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
            self_speaker: SpeakerType.priority
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
            const vol = player.audio.volume;

            return [{
                "type": 17, // Container
                "accent_color": api.color,
                "components": [
                    {
                        "type": 9, // Block
                        "components": [
                            {
                                "type": 10,
                                "content": `## ${db.images.disk_emoji} [${artist.title}](${artist.url})`
                            },
                            {
                                "type": 10,
                                "content": `\`\`\`${name}\`\`\`[${("‾").repeat(name.length)}](${url})`
                            }
                        ],
                        "accessory": {
                            "type": 11,
                            "media": {
                                "url": image.url
                            }
                        }
                    },
                    {
                        "type": 14, // Separator
                        "divider": true,
                        "spacing": 1
                    },
                    {
                        "type": 10, // Text
                        "content": `> -# \`👤 ${user.username}\`  |  \`${getVolumeIndicator(vol)}\` ${tracks.footer} |  \`🌐 ${player.voice.connection.latency}ms\`` + player.progress
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

        // Останавливаем плеер
        this._player.cleanup();

        // Для удаления динамического сообщения
        this._message.delete();

        // Удаляем статус гс канала
        db.adapter.status(this.message.voice_id, null);
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @warn Автоматически удаляется через событие VoiceStateUpdate
     * @returns void
     * @public
     */
    public destroy = () => {
        Logger.log("LOG", `[Queue/${this.message.guild_id}] has destroyed`);

        this._message = null;
        this.timestamp = null;

        this._buttons.destroy();
        this._buttons = null;

        // Удаляем плеер
        this._player.destroy();
    };
}

/**
 * @description Генератор громкости плеера
 * @param volume - Уровень громкости (0–200)
 * @returns string
 * @private
 */
function getVolumeIndicator(volume: number): string {
    const clamped = Math.max(0, Math.min(volume, 200));
    let text = "";

    if (clamped < 30) text+= "🔈";
    else if (clamped >= 30 && clamped < 70) text+= "🔉";
    else if (clamped >= 70 && clamped < 150) text+= "🔊";
    else if (clamped >= 150) text+= "📢";

    return text + ` ${clamped}%`;
}