import { type AudioFilter, type AudioPlayerEvents, ControllerFilters } from "#core/player";
import { BufferedAudioResource, OPUS_FRAME_SIZE, PipeAudioResource, SILENT_FRAME } from "#core/audio";
import { ControllerTracks, ControllerVoice, RepeatType, Track } from "#core/queue";
import { PlayerProgress } from "../modules/progress";
import { Logger, TypedEmitter } from "#structures";
import type { VoiceConnection } from "#core/voice";
import { PlayerAudio } from "../modules/audio";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Создаем класс для вычисления progress bar
 * @class PlayerProgress
 * @private
 */
const Progress = new PlayerProgress();

/**
 * @author SNIPPIK
 * @description Безопасное время для буферизации трека
 * @const PLAYER_BUFFERED_TIME
 * @public
 */
export const PLAYER_BUFFERED_TIME = 500;

/**
 * @author SNIPPIK
 * @description Безопасное время между отправкой аудио пакетов
 * @const PLAYER_PAUSE_OFFSET
 * @private
 */
const PLAYER_PAUSE_OFFSET = 3000;

/**
 * @author SNIPPIK
 * @description Безопасное время между аудио потоками
 * @const PLAYER_TIMEOUT_OFFSET
 * @private
 */
const PLAYER_TIMEOUT_OFFSET = 2000;

/**
 * @author SNIPPIK
 * @description Поддерживающиеся потоковые аудио стримы
 * @type AudioPlayerAudio
 * @private
 */
type AudioPlayerAudio = BufferedAudioResource | PipeAudioResource;

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания аудио
 * @class AudioPlayer
 * @extends TypedEmitter
 * @public
 *
 * # Особенности
 * - Плеер не даст загрузить новый трек если прошлый не загружен! Через 10 сек можно будет загрузить новый!
 * - Поддерживает hot swap, не ломает jitter buffer (AudioPlayerTimeout)
 * - Умеет накладывать аудио на аудио, через ffmpeg
 * - Высокая надежность, практически невозможно сломать
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    public _stepCounter: number = 1; // Требуется для подстройки под голосовое соединение
    public _counter: number = 0; // Требуется для подстройки под голосовое соединение

    /**
     * @description Текущий статус плеера, при создании он должен быть в ожидании
     * @private
     */
    protected _status: keyof AudioPlayerEvents = "player/wait";

    /**
     * @description Класс для управления временем плеера
     * @protected
     */
    protected _timer = new AudioPlayerTimeout();

    /**
     * @description Хранилище аудио фильтров
     * @readonly
     * @private
     */
    protected _filters = new ControllerFilters<AudioFilter>();

    /**
     * @description Управление потоковым вещанием
     * @readonly
     * @private
     */
    protected _audio = new PlayerAudio<AudioPlayerAudio>();

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
        if (status !== this._status) {
            // Запускаем событие
            this.emit(status, this);
        }

        // Записываем статус
        this._status = status;
    };

    /**
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const { api, time } = this._tracks.track;
        const current = this._audio.current?.duration ?? 0;

        // Создаем прогресс бар
        const bar =  Progress.bar({ platform: api.name, duration: { current, total: time.total } });

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };

    /**
     * @description Задержка плеера между отправкой аудио пакетов
     * @public
     */
    public get latency() {
        return this._stepCounter * OPUS_FRAME_SIZE;
    };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Если текущий статус не позволяет проигрывать музыку
        if (this._status === "player/wait" || this._status === "player/pause") return false;

        // Если голосовое состояние не позволяет отправлять пакеты
        else if (!this._voice.connection?.isReadyToSend) return false;

        // Если поток не читается, переходим в состояние ожидания
        const currentAudio = this._audio.current;
        if (!currentAudio && currentAudio.packets > 0 || !currentAudio.readable) {
            this.status = "player/wait";
            this.cycle = false;
            return false;
        }

        /*
        // Если есть аудио, подгружаем новое под конец текущего
        else if (this._audio.current && this._audio.current instanceof BufferedAudioResource && this._audio.current?.readable) {
            // Кол-во аудио пакетов у аудио
            const packets = this._audio.current?.packets;

            // До конца текущего аудио включаем следующий трек
            if (packets === 300 && !this.audio.preloaded) {
                // Если есть треки в очереди
                if (this.tracks.size > 0 || this.tracks.repeat === RepeatType.Songs) {
                    setImmediate(() => {
                        this.play(0, (packets * OPUS_FRAME_SIZE), this.tracks.position + 1).catch(console.error);
                    });
                }

                // Если включен повтор 1 трека
                else if (this.tracks.repeat === RepeatType.Song) {
                    setImmediate(() => {
                        this.play(0, (packets * OPUS_FRAME_SIZE), this.tracks.position).catch(console.error);
                    });
                }
            }
        }*/

        return true;
    };

    /**
     * @description Включение/Отключение плеера в цикла
     * @private
     */
    private set cycle(isActive: boolean) {
        // Подключаем плеер к циклу
        if (isActive) {
            // Если нет плеера в цикле
            if (!db.queues.cycles.players.has(this)) {
                db.queues.cycles.players.add(this);

                Logger.log("DEBUG", `[AudioPlayer/${this.id}] pushed in cycle`);
            }
        }

        // Отключаем плеер от цикла
        else if (!isActive) {
            // Если есть плеер в цикле
            if (db.queues.cycles.players.has(this)) {
                db.queues.cycles.players.delete(this);

                Logger.log("DEBUG", `[AudioPlayer/${this.id}] removed from cycle`);
            }
        }
    };

    /**
     * @description Задаем параметры плеера перед началом работы
     * @param _tracks - Ссылка на треки из очереди
     * @param _voice - Ссылка на класс голосового подключения
     * @param id - ID сервера для аутентификации плеера
     * @constructor
     * @public
     */
    public constructor(
        /** Ссылка на класс с треками */
        protected _tracks: ControllerTracks<Track>,

        /** Ссылка на класс с голосовым подключением */
        protected _voice: ControllerVoice<VoiceConnection>,

        /** Уникальный id плеера */
        public id: string,
    ) {
        super();

        // Используем arrow function чтобы не потерять контекст и обработать ошибку
        setImmediate(() => this.play().catch(err => this.emit("player/error", this, err)));

        /**
         * @description Событие смены позиции плеера
         * @private
         */
        this.on("player/wait", async (player) => {
            const { tracks } = player;
            const repeat = tracks.repeat;
            const current = tracks.position;

            // Если включен повтор трека сменить позицию нельзя
            if (repeat === RepeatType.Song) tracks.position = current;

            // Если включен бесконечный поток
            else if (repeat === RepeatType.AutoPlay) {
                // Если последняя позиция
                if (current === tracks.total - 1) {
                    try {
                        const related = await db.api.fetchRelatedTracks(tracks.track);

                        // Если получена ошибка
                        if (related instanceof Error) Logger.log("ERROR", related);

                        // Если нет похожих треков
                        else if (!related.length) player.emit("player/error", player, "Autoplay System: failed get related tracks");

                        // Добавляем треки
                        else {
                            const user = tracks.track.user;

                            related.forEach((song) => {
                                song.user = user;
                                tracks.push(song);
                            });
                        }
                    } catch (err) {
                        Logger.log("ERROR", err as Error);
                    }
                }

                // Меняем позицию трека в списке
                tracks.position = player.tracks.position + 1;
            }

            // Если включен повтор треков или его вовсе нет
            else {
                // Меняем позицию трека в списке
                tracks.position = tracks.position + 1;

                // Если повтор выключен
                if (repeat === RepeatType.None) {
                    // Если очередь началась заново
                    if (current + 1 === tracks.total && tracks.position === 0) {
                        return db.queues.get(player.id)?.cleanup();
                    }
                }
            }

            // Через время запускаем трек, что-бы не нарушать работу VoiceSocket
            // Что будет если нарушить работу VoiceSocket, пинг >=1000
            return player.play(0, PLAYER_TIMEOUT_OFFSET);
        });

        /**
         * @description Событие получения ошибки плеера
         * @private
         */
        this.on("player/error", (player, error, skip) => {
            const queue = db.queues.get(player.id);
            const current = player.tracks.position;

            // Позиция трека для сообщения
            const position = skip?.position ? skip?.position : current;

            // Выводим сообщение об ошибке
            db.events.emitter.emit("message/error", queue, error, position);

            // Если надо пропустить трек
            if (skip) {
                player.tracks.remove(skip.position);

                // Если надо пропустить текущую позицию
                if (skip.position === current) {
                    // Если плеер играет, то не пропускаем
                    if (player?.audio && player?.audio?.current?.packets > 0) return;
                    player.emit("player/wait", player);
                }

                // Если следующих треков нет
                else if (player.tracks.size === 0) return queue.cleanup();
            }
        });
    };

    /**
     * @description Запуск чтения потока
     * @param path - Путь до файла или ссылка на аудио
     * @param time - Длительность трека
     * @param seek - Время пропуска, трек начнется с указанного времени
     * @protected
     */
    protected _readStream = (path: string, time: number = 0, seek: number = 0): AudioPlayerAudio | null => {
        // Если другой аудио поток загружается, то запрещаем включение
        if (this._audio.preloaded) return null;

        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has read stream ${path}`);
        const stream = this._audio.current;

        // Выбираем и создаем класс для предоставления аудио потока
        return this._audio.preload = new (time > PLAYER_BUFFERED_TIME || time === 0 ? PipeAudioResource : BufferedAudioResource)(
            // Если начался новый трек
            stream && stream.packets === 0 ?
                {
                    seek,
                    filters: this._filters.filters,
                    volume: this._audio.volume,
                    inputs: [
                        path
                    ],
                    crossfade: {
                        duration: time
                    }
                } :

            // Если произошла смена аудио потока
                {
                    seek,
                    filters: this._filters.filters,
                    volume: this._audio.volume,
                    old_seek: stream ? stream.duration : 0,
                    old_filters: stream ? stream.options.filters : null,
                    inputs: [
                        stream ? stream.options.inputs.pop() : null,
                        path
                    ],
                    crossfade: {
                        duration: stream ? (stream.packets * OPUS_FRAME_SIZE) / 1e3 : time
                    }
                }
        );
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param timeout - Время через которое надо включить трек
     * @param position - Позиция нового трека
     * @public
     */
    public play = async (seek: number = 0, timeout: number = 0, position: number = null): Promise<void> => {
        let track: Track, index: number;

        // Если указана позиция
        if (position) {
            track = this._tracks.get(position);
            index = position;
        }

        // Если не указана позиция
        else {
            track = this._tracks.track;
            index = this._tracks.position;
        }

        // Если нет такого трека или статуса
        if (!track || this._status === null) return;

        try {
            const resource = await track?.resource;

            // Если получена ошибка вместо исходника
            if (resource instanceof Error) {
                this.emit("player/error", this, `${resource}`, { skip: true, position: index });
                return;
            }

            // Создаем аудио поток
            const stream = this._readStream(resource, track.time.total, seek);

            // Если нельзя создать аудио поток, поскольку создается другой
            if (!stream) return;

            // Подключаем события для отслеживания работы потока (временные)
            (stream as BufferedAudioResource)
                // Если чтение возможно
                .once("readable", () => {
                    // Время паузы плеера
                    const pauseTimeout = Math.max(this._timer.timeout - Date.now(), timeout, 0);

                    // Если включить трек сейчас не выйдет
                    if (pauseTimeout > 0) this._timer.timer = setTimeout(() => this._onPlayerReadable(index, seek), pauseTimeout);
                    else this._onPlayerReadable(index, seek);
                    return null;
                })

                // Если была получена ошибка при чтении
                .once("error", async (error: Error) => {
                    // Отправляем данные событию для отображения ошибки
                    this.emit("player/error", this, `${error}`, { skip: true, position: index });
                });
        } catch (error) {
            this.emit("player/error", this, `${error}`, { skip: true, position: index });

            // Сообщаем об ошибке
            Logger.log("ERROR", `[Player/${this.id}] ${error}`);
        }
    };

    /**
     * @description Приостанавливает воспроизведение плеера
     * @returns void
     * @public
     */
    public pause = (): void => {
        // Проверяем, что плеер действительно играет
        if (this._status !== "player/playing") return;

        // Переключаем статус на паузу
        this.status = "player/pause";

        // Отправляем silent frame в голосовое соединение для паузы звука
        this._voice.connection.packet = SILENT_FRAME;

        // Устанавливаем время паузы
        this._timer.timeout = Date.now();

        // Отключаем плеер от цикла
        this.cycle = false;
    };

    /**
     * @description Возобновляет воспроизведение плеера
     * @returns void
     * @public
     */
    public resume = (): void => {
        // Проверяем, что плеер в состоянии паузы
        if (this._status !== "player/pause") return;

        const pauseTime = Math.max(this._timer.timeout - Date.now(), 0);

        // Если можно начать проигрывание трека
        if (!pauseTime) {
            // Для возобновления отправляем silent frame, чтобы обновить состояние пакета
            this._voice.connection.packet = SILENT_FRAME;

            // Переключаем статус обратно в "playing"
            this.status = "player/playing";

            // Удаляем время проигрывания
            this._timer.timeout = null;

            // Подключаем плеер к циклу
            this.cycle = true;
            return;
        }

        // Возобновляем через время
        this._timer.timer = setTimeout(this.resume, pauseTime);
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @returns Promise<void> | void
     * @public
     */
    public stop = (): Promise<void> | void => {
        if (this._status === "player/wait") return;

        // Отправляем silent frame в голосовое соединение для паузы звука
        this._voice.connection.packet = SILENT_FRAME;

        this.status = "player/wait";
    };

    /**
     * @param index - Номер нового трека
     * @param seek - Время перехода к позиции аудио трека
     * @returns void
     * @private
     */
    private _onPlayerReadable = (index: number, seek: number) => {
        // Переводим плеер в состояние чтения аудио
        this.status = "player/playing";

        // Передаем плеер в цикл
        this.cycle = true;

        // Меняем позицию если удачно
        this._tracks.position = index;

        // Если трек включен в 1 раз
        if (seek === 0) {
            // Отправляем пустышку для смягчения если нет аудио
            if (!this._audio.current) this._voice.connection.packet = SILENT_FRAME;

            const queue = db.queues.get(this.id);
            if (queue) db.events.emitter.emit("message/playing", queue); // Отправляем сообщение, если можно
        }
    }

    /**
     * @description Эта функция частично удаляет плеер и некоторые сопутствующие данные
     * @returns void
     * @public
     */
    public cleanup = () => {
        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has cleanup`);

        // Отключаем фильтры при очистке
        if (this._filters.size > 0) this._filters.clear();

        // Отключаем плеер от цикла
        this.cycle = false;

        // Удаляем текущий поток, поскольку он больше не нужен
        this._audio.destroy();

        // Отправляем пустышку
        this._voice.connection.packet = SILENT_FRAME;

        // Ставим timeout для проигрывания
        this._timer.timeout = Date.now();

        // Переводим плеер в режим ожидания
        this._status = "player/wait";
    };

    /**
     * @description Эта функция полностью удаляет плеер и все сопутствующие данные
     * @returns void
     * @public
     */
    public destroy = () => {
        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has destroyed`);
        super.destroy();

        this.id = null;
        this._audio = null;
        this._filters = null;
        this._status = null;
        this._timer.destroy();
        this._timer = null;
    };
}

/**
 * @author SNIPPIK
 * @description Класс для ограничения временных разрывов плеера, предотвращает разрыв jitter buffer
 * @class AudioPlayerTimeout
 * @private
 */
class AudioPlayerTimeout {
    /**
     * @description Время когда плеер поставили на паузу
     * @protected
     */
    protected _pauseTimestamp: number = null;

    /**
     * @description Последний сохраненный таймер
     * @protected
     */
    protected _pauseTimeout: NodeJS.Timeout | null = null;

    /**
     * @description Последнее заданное время
     * @returns number
     * @public
     */
    public get timeout() {
        return this._pauseTimestamp;
    };

    /**
     * @description Последнее заданное время
     * @public
     */
    public set timeout(time) {
        this._pauseTimestamp = time + PLAYER_PAUSE_OFFSET;
    };

    /**
     * @description Устанавливаем таймер повтора
     * @param timer - Таймер, не обязательный!
     * @public
     */
    public set timer(timer: NodeJS.Timeout | null) {
        if (this._pauseTimeout) clearTimeout(this._pauseTimeout);

        // Задаем таймер
        this._pauseTimeout = timer;
    };

    /**
     * @description Удаляем не нужные данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this._pauseTimestamp = null;
        this.timer = null;
    };
}