import { ControllerTracks, ControllerVoice } from "#core/queue";
import { QueueMessage, QueueButtons } from "../modules/message";
import type { CommandInteraction } from "#structures/discord";
import { VoiceConnection } from "#core/voice";
import { AudioPlayer } from "#core/player";
import { Logger } from "#structures";
import type { Track } from "./track";
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
     * @private
     */
    private _timestamp: number = parseInt(Math.max(Date.now() / 1e3).toFixed(0));

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
     * @description Плеер для проигрывания музыки
     * @protected
     */
    protected _player: AudioPlayer;

    /**
     * @description Хранилище треков, с умной системой управления
     * @protected
     */
    protected _tracks: ControllerTracks<Track> = new ControllerTracks();

    /**
     * @description Голосовое подключение
     * @protected
     */
    protected _voice: ControllerVoice<VoiceConnection> = new ControllerVoice();

    /**
     * @description Время создания очереди
     * @public
     */
    public get timestamp() {
        return this._timestamp;
    };

    /**
     * @description Получаем доступ к трекам
     * @public
     */
    public get tracks() {
        return this._tracks;
    };

    /**
     * @description Записываем сообщение в базу для дальнейшего использования
     * @param message - Сохраняемое сообщение
     * @public
     */
    public set message(message) {
        this._cleanupOldMessage();
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
     * @description Выдаем плеер привязанный к очереди
     * @return AudioPlayer
     * @public
     */
    public set player(player) {
        const oldPlayer = this._player;

        // Задаем новый плеер
        this._player = player;

        // Если есть старый плеер
        if (oldPlayer) oldPlayer.destroy();
    };

    /**
     * @description Выдаем голосовой канал
     * @return VoiceChannel
     * @public
     */
    public get voice() {
        return this._voice;
    };

    /**
     * @description Записываем голосовой канал в базу для дальнейшего использования
     * @param voice - Сохраняемый голосовой канал
     * @public
     */
    public set voice(voice) {
        this._voice = voice;
    };

    /**
     * @description Создаем очередь для дальнейшей работы, все подключение находятся здесь
     * @param message - Опции для создания очереди
     * @constructor
     * @public
     */
    public constructor(message: CommandInteraction) {
        const queue_message = new QueueMessage(message);
        const ID = queue_message.guildID;

        // Добавляем очередь в список очередей
        db.queues.set(ID, this);

        // Создаем плеер
        this.player = new AudioPlayer(this._tracks, this._voice, ID);

        // Добавляем данные в класс
        this.message = queue_message;

        // Подключаемся к голосовому каналу
        this._player.voice.connection = db.voice.join({
            self_deaf: true,
            self_mute: false,
            guild_id: ID,
            channel_id: queue_message.voiceID
        }, db.adapter.voiceAdapterCreator(ID));

        // Создаем класс для отображения кнопок
        this._buttons = new QueueButtons(queue_message);

        Logger.log("LOG", `[Queue/${ID}] has create`);
    };

    /**
     * @description Удаление динамического сообщения из системы
     * @private
     */
    private _cleanupOldMessage = () => {
        // Если введено новое сообщение
        if (this._message && this._message.guild) {
            // Удаляем старое сообщение, если оно есть
            const message = db.queues.cycles.messages.find((msg) => {
                return msg.guildId === this._message.guildID;
            });

            if (message) db.queues.cycles.messages.delete(message);
        }
    };

    /**
     * @description Выдача компонентов сообщения, такие как кнопки и текст
     * @public
     */
    public get components() {
        const buttons = this._buttons.component(this._player);

        try {
            const {api, artist, name, image, user} = this._tracks.track;
            const position = this._tracks.position;

            return [{
                "type": 17, // Container
                "accent_color": api.color,
                "components": [
                    {
                        "type": 9,
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
                        "content": `-# ${user.username} ● ${getVolumeIndicator(this._player.audio.volume)} ${this._tracks.total > 1 ? `| ${position + 1}/${this._tracks.total} | ${this._tracks.time}` : ""}` + this._player.progress
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
     * @readonly
     * @public
     */
    public cleanup = () => {
        Logger.log("DEBUG", `[Queue/${this.message.guildID}] has cleanup`);

        // Останавливаем плеер
        if (this._player) this._player.cleanup();

        // Для удаления динамического сообщения
        this._cleanupOldMessage();
    };

    /**
     * @description Эта функция полностью удаляет очередь и все сопутствующие данные, используется в другом классе
     * @warn Автоматически удаляется через событие VoiceStateUpdate
     * @protected
     * @readonly
     */
    protected destroy = () => {
        Logger.log("LOG", `[Queue/${this.message.guildID}] has destroyed`);

        // Удаляем плеер
        if (this._player) this._player.destroy();
        this._tracks.clear();

        this._tracks = null;
        this._message = null;
        this._timestamp = null;
        this._voice = null;
        this._player = null;

        this._buttons.destroy();
        this._buttons = null;
    };
}

/**
 * @param volume - Уровень громкости (0–200)
 * @returns строка-индикатор громкости
 */
function getVolumeIndicator(volume: number): string {
    const clamped = Math.max(0, Math.min(volume, 200));
    return `${clamped}%`.padStart(4, " ");
}