import { AudioPlayerEvents, PlayerTracks, PlayerAudioFilters, PLAYER_BUFFERED_TIME } from "#service/player";
import { BufferedAudioResource, PipeAudioResource, SILENT_FRAME } from "#service/voice";
import { Logger, TypedEmitter } from "#structures";
import { db } from "#app/db";

// Local modules
import { PlayerProgress } from "../modules/progress";
import { PlayerVoice } from "../modules/voice";
import { PlayerAudio } from "../modules/audio";
import { RepeatType } from "#service/player";

/**
 * @author SNIPPIK
 * @description Создаем класс для вычисления progress bar
 * @class PlayerProgress
 * @private
 */
const Progress = new PlayerProgress();




/**
 * @author SNIPPIK
 * @description Базовый плеер, хранит в себе все данные плеера
 * @class BasePlayer
 * @protected
 */
abstract class BasePlayer extends TypedEmitter<AudioPlayerEvents> {
    /**
     * @description Текущий статус плеера, при создании он должен быть в ожидании
     * @private
     */
    protected _status: keyof AudioPlayerEvents = "player/wait";

    /**
     * @description Хранилище треков
     * @readonly
     * @private
     */
    protected readonly _tracks = new PlayerTracks();

    /**
     * @description Хранилище аудио фильтров
     * @readonly
     * @private
     */
    protected readonly _filters = new PlayerAudioFilters();

    /**
     * @description Управление голосовыми состояниями
     * @readonly
     * @private
     */
    protected readonly _voice = new PlayerVoice();

    /**
     * @description Управление потоковым вещанием
     * @readonly
     * @private
     */
    protected readonly _audio = new PlayerAudio<AudioPlayerStream>();

    /**
     * @description Параметр отвечающий за загрузку потока
     * @help Если поток загружается или ждет начала, то новый загрузить не получится
     */
    public waitStream = false;
}

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки на серверах
 * @class AudioPlayer
 * @public
 */
export class AudioPlayer extends BasePlayer {
    /**
     * @description Делаем tracks параметр публичным для использования вне класса
     * @public
     */
    public get tracks() {
        return this._tracks;
    };

    /**
     * @description Делаем filters параметр публичным для использования вне класса
     * @public
     */
    public get filters() {
        return this._filters;
    };

    /**
     * @description Делаем voice параметр публичным для использования вне класса
     * @public
     */
    public get voice() {
        return this._voice;
    };

    /**
     * @description Делаем stream параметр публичным для использования вне класса
     * @public
     */
    public get audio() {
        return this._audio;
    };

    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @public
     */
    public set status(status: keyof AudioPlayerEvents) {
        // Если был введен новый статус
        if (status !== this.status) {
            // Запускаем событие
            this.emit(status, this);
        }

        // Записываем статус
        this._status = status;
    };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Если текущий статус не позволяет проигрывать музыку
        if (this.status === "player/wait" || this.status === "player/pause") return false;

        // Если голосовое состояние не позволяет отправлять пакеты
        else if (!this.voice.connection && !this.voice.connection.ready) return false;

        // Если поток не читается, переходим в состояние ожидания
        else if (!this.audio.current || !this.audio.current?.readable) {
            this.audio.current = null;
            this.status = "player/wait";
            return false;
        }

        return true;
    };

    /**
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const {api, time} = this.tracks.track;
        let current = this.audio?.current?.duration;

        // Скорее всего трек играет следующий трек
        if (time.total > 0 && current > time.total || !this.playing) current = 0;

        // Создаем прогресс бар
        const bar =  Progress.bar({ platform: api.name, duration: { current, total: time.total } });

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };

    /**
     * @description Задаем параметры плеера перед началом работы
     * @param id - ID сервера для аутентификации плеера
     */
    public constructor(public id: string) {
        super();

        // Добавляем плеер в базу для отправки пакетов
        db.queues.cycles.players.add(this);

        /**
         * @description Событие смены позиции плеера
         * @private
         */
        this.on("player/wait", async (player) => {
            const repeat = player.tracks.repeat;
            const current = player.tracks.position;

            // Если включен повтор трека сменить позицию нельзя
            if (repeat === RepeatType.Song) player.tracks.position = current;

            // Если включен повтор треков или его вовсе нет
            else {
                // Меняем позицию трека в списке
                player.tracks.position = player.tracks.position + 1;

                // Если повтор выключен
                if (repeat === RepeatType.None) {

                    // Если очередь началась заново
                    if (current + 1 === player.tracks.total && player.tracks.position === 0) {
                        const queue = db.queues.get(player.id);

                        return queue.cleanup();
                    }
                }
            }

            // Через время запускаем трек, что-бы не нарушать работу VoiceSocket
            // Что будет если нарушить работу VoiceSocket, пинг >=1000
            return player.play(0, 2e3);
        });

        /**
         * @description Событие получения ошибки плеера
         * @private
         */
        this.on("player/error", (player, error, skip) => {
            const queue = db.queues.get(player.id);
            const current = player.tracks.position;

            // Заставляем плеер пропустить этот трек
            if (skip) {
                setImmediate(() => {
                    player.tracks.remove(skip.position);

                    if (player.tracks.size === 0) queue.cleanup();
                    else {
                        // Переключаем позицию назад, плеер сам переключит на следующий трек
                        player.tracks.position = current + 1;

                        if (skip.position === current) player.emit("player/wait", player);
                    }
                });
            }

            // Выводим сообщение об ошибке
            db.events.emitter.emit("message/error", queue, error);
        });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param timeout - Время через которое надо включить трек
     * @param position - Позиция нового трека
     * @public
     */
    public play = async (seek: number = 0, timeout: number = null, position: number = null): Promise<void> => {
        const track = this._tracks?.track;

        // Если больше нет треков
        if (!track) return;

        // Позиция трека
        const positionIndex = position || this.tracks.indexOf(track);

        try {
            const resource = await this._preloadTrack(positionIndex);

            // Если получена ошибка вместо исходника
            if (resource instanceof Error || !resource) return;

            if (timeout) setTimeout(() => this._readStream(resource, track.time.total, seek), timeout);
            else return this._readStream(resource, track.time.total, seek);
        } catch (err) {
            this.emit("player/error", this, `${err}`, { skip: true, position: positionIndex });

            // Сообщаем об ошибке
            Logger.log("ERROR", `[Player/${this.id}] ${err}`);
        }
    };

    /**
     * @description Приостанавливает воспроизведение плеера
     * @public
     */
    public pause(): void {
        // Проверяем, что плеер действительно играет
        if (this.status !== "player/playing") return;

        // Переключаем статус на паузу
        this.status = "player/pause";

        // Отправляем silent frame в голосовое соединение для паузы звука
        this.voice.connection.packet = SILENT_FRAME;
    }

    /**
     * @description Возобновляет воспроизведение плеера
     * @public
     */
    public resume(): void {
        // Проверяем, что плеер в состоянии паузы
        if (this.status !== "player/pause") return;

        // Для возобновления отправляем silent frame, чтобы обновить состояние пакета
        this.voice.connection.packet = SILENT_FRAME;

        // Переключаем статус обратно в "playing"
        this.status = "player/playing";
    }

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @param position - Позиция нового трека
     * @public
     */
    public stop = (position?: number): Promise<void> | void => {
        // Если есть позиция трека, для плавного перехода
        if (typeof position === "number") {
            const duration = this.tracks.track.time.total - db.queues.options.optimization;

            // Если можно сделать плавный переход
            if (this.audio.current && duration > this.audio.current.duration) {
                this.tracks.position = position;
                return this.play(0, position);
            }
        }

        if (this.status === "player/wait") return;
        this.status = "player/wait";

        // Отправляем silent frame в голосовое соединение для паузы звука
        this.voice.connection.packet = SILENT_FRAME;
    };

    /**
     * @description Запуск чтения потока
     * @param path - Путь до файла или ссылка на аудио
     * @param time - Длительность трека
     * @param seek - Время пропуска, трек начнется с указанного времени
     */
    private _readStream = (path: string, time: number = 0, seek: number = 0) => {
        Logger.log("DEBUG", `[Player/${this.id}] has read stream`);

        // Если аудио уже загружается
        if (this.waitStream) return;
        this.waitStream = true;

        const options = { seek, filters: this._filters.compress(time) };

        // Создаем класс для управления потоком
        const stream = new (time > PLAYER_BUFFERED_TIME || time === 0 ? PipeAudioResource : BufferedAudioResource)({path, options});

        // Если стрим можно прочитать
        if (stream.readable) {
            this._audio.current = stream;
            this.status = "player/playing";
            this.waitStream = false;

            if (seek === 0) {
                const queue = db.queues.get(this.id);

                // Отправляем сообщение, если можно
                db.events.emitter.emit("message/playing", queue);
            }
        }

        else {
            // Подключаем события для отслеживания работы потока (временные)
            (stream as BufferedAudioResource)
                // Если возникнет ошибка во время загрузки потока
                .once("error", (error) => {
                    // Уничтожаем поток
                    stream.destroy();

                    this.waitStream = false;
                    // Отправляем данные событию для отображения ошибки
                    throw error;
                })
                // Если уже можно читать поток
                .once("readable", () => {
                    this.waitStream = false;
                    this._audio.current = stream;
                    this.status = "player/playing";

                    if (seek === 0) {
                        const queue = db.queues.get(this.id);

                        // Отправляем сообщение, если можно
                        db.events.emitter.emit("message/playing", queue);
                    }
                });
        }
    };

    /**
     * @description Пред загрузка трека, если конечно это возможно
     * @param position - Позиция трека
     */
    protected _preloadTrack = async (position: number): Promise<false | string | Error> => {
        Logger.log("DEBUG", `[Player/${this.id}] has preload track`);

        const track = this.tracks.get(position);

        // Если нет трека в очереди
        if (!track) return false;

        // Получаем данные
        const path = await track?.resource;

        // Если получена ошибка вместо исходника
        if (path instanceof Error) {
            this.emit("player/error", this, `Critical error in track.resource!\n\n${path.name}\n- ${path.message}`, { skip: true, position });
            return Error(`Critical error in track.resource!\n\n${path.name}\n- ${path.message}`);
        }

        // Если нет исходника
        else if (!path) {
            this.emit("player/error", this, "Fail to get audio link", { skip: true, position });
            return new Error("Fail to get audio link");
        }

        Logger.log("DEBUG", `[Player/${this.id}] has preload track: success`);

        // Если получить трек удалось
        return path;
    };

    /**
     * @description Эта функция частично удаляет плеер и некоторые сопутствующие данные
     * @readonly
     * @protected
     */
    public cleanup = () => {
        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has cleanup`);

        // Отключаем фильтры при очистке
        if (this.filters.enabled.length > 0) this.filters.enabled.splice(0, this.filters.enabled.length);

        // Отключаем от цикла плеер
        db.queues.cycles.players.delete(this);

        // Удаляем текущий поток, поскольку он больше не нужен
        this.audio.current = null;

        // Отправляем пустышку
        this.voice.connection.packet = SILENT_FRAME;

        // Переводим плеер в режим ожидания
        this._status = "player/wait";
    };

    /**
     * @description Эта функция полностью удаляет плеер и все сопутствующие данные
     * @readonly
     * @protected
     */
    public destroy = () => {
        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has destroyed`);
        this.removeAllListeners();
    };
}




/**
 * @author SNIPPIK
 * @description Поддерживающиеся потоковые аудио стримы
 * @type AudioPlayerStream
 */
type AudioPlayerStream = BufferedAudioResource | PipeAudioResource;