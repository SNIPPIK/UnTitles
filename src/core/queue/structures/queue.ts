import { ControllerTracks, ControllerVoice, Track } from "#core/queue";
import { QueueMessage, QueueButtons } from "../modules/message";
import { CommandInteraction } from "#structures/discord";
import { VoiceConnection } from "#core/voice";
import { AudioPlayer } from "#core/player";
import { Logger } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для управления и хранения плеера
 * @class ControllerPlayer
 * @private
 */
class ControllerPlayer<T extends AudioPlayer> {
    /**
     * @description Текущий экземпляр плеера
     * @protected
     */
    protected _player: T;

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
     * @description Создаем класс для управления плеером и составными для проигрывания
     * @constructor
     * @public
     */
    public constructor({guild_id, channel_id}: initPlayerOptions) {
        const oldPlayer = this._player;

        // Если есть старый плеер
        if (oldPlayer) oldPlayer.destroy();

        // Задаем новый плеер
        this._player = new AudioPlayer(this.tracks, this.voice, guild_id) as T;

        // Подключаемся к голосовому каналу
        this.voice.connection = db.voice.join({
            guild_id, channel_id,
            self_deaf: true,
            self_mute: false
        }, db.adapter.voiceAdapterCreator(guild_id));
    }

    /**
     * @description Удаляем данные плеера и подмодулей
     * @public
     */
    public destroy() {
        // Удаляем плеер
        this._player.destroy();
        this.tracks.clear();

        this.tracks = null;
        this.voice = null;
        this._player = null;
    };
}

/**
 * @author SNIPPIK
 * @description Класс очереди для управления всей системой, бесконтрольное использование ведет к поломке всего процесса!!!
 * @class Queue
 * @public
 */
export class Queue extends ControllerPlayer<AudioPlayer> {
    /**
     * @description Время создания очереди
     * @public
     */
    public timestamp: number = parseInt(Math.max(Date.now() / 1e3).toFixed(0));

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
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @constructor
     * @public
     */
    public constructor(message: CommandInteraction) {
        const queue_message = new QueueMessage(message);
        const ID = queue_message.guild_id;

        // Задаем плеер
        super({
            guild_id: ID,
            channel_id: queue_message.voice_id
        });

        // Добавляем очередь в список очередей
        db.queues.set(ID, this);

        // Добавляем данные в класс
        this.message = queue_message;

        // Создаем класс для отображения кнопок
        this._buttons = new QueueButtons(queue_message);

        Logger.log("LOG", `[Queue/${ID}] has create`);
    };

    /**
     * @description Выдача компонентов сообщения, такие как кнопки и текст
     * @returns ComponentV2
     * @public
     */
    public get components() {
        // Если класс кнопок (компонентов был уничтожен)
        if (!this._buttons) return null;

        const player = this._player, tracks = this.tracks;
        const buttons = this._buttons?.component(player);

        try {
            const {api, artist, name, image, user} = tracks.track;
            const textTracks = tracks.total > 1 ? `| ${tracks.position + 1}/${tracks.total} | ${tracks.time}` : "";
            const latency = `${player.latency}/${player.voice.connection.latency} ms`

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
                                "content": `\`\`\`${name}\`\`\``
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
                        "content": `-# ${user.username} ● ${getVolumeIndicator(player.audio.volume)} ${textTracks} | ${latency}` + player.progress
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
     * @public
     */
    public cleanup = () => {
        Logger.log("DEBUG", `[Queue/${this.message.guild_id}] has cleanup`);

        // Останавливаем плеер
        this._player.cleanup();

        // Для удаления динамического сообщения
        this._message.delete();
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @warn Автоматически удаляется через событие VoiceStateUpdate
     * @returns void
     * @protected
     */
    public destroy = () => {
        Logger.log("LOG", `[Queue/${this.message.guild_id}] has destroyed`);

        this._message = null;
        this.timestamp = null;

        this._buttons.destroy();
        this._buttons = null;

        super.destroy();
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
    return `${clamped}%`.padStart(4, " ");
}

/**
 * @author SNIPPIK
 * @description Данные для запуска плеера
 * @interface initPlayerOptions
 * @private
 */
interface initPlayerOptions {
    guild_id: string;
    channel_id: string;
}