import { BufferedAudioResource, PipeAudioResource, SILENT_FRAME } from "#core/audio";
import { ControllerTracks, ControllerVoice, RepeatType, Track } from "#core/queue";
import { AudioFilter, AudioPlayerEvents, ControllerFilters } from "#core/player";
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
 * @description Безопасное время между аудио потоками
 * @const PLAYER_PAUSE_OFFSET
 * @private
 */
const PLAYER_PAUSE_OFFSET = 2500;

/**
 * @author SNIPPIK
 * @description Поддерживающиеся потоковые аудио стримы
 * @type AudioPlayerAudio
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
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
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
        const {api, time} = this._tracks.track;
        let current = this._audio?.current?.duration;

        // Скорее всего трек играет следующий трек
        if (time.total > 0 && current > time.total || !this.playing) current = 0;

        // Создаем прогресс бар
        const bar =  Progress.bar({ platform: api.name, duration: { current, total: time.total } });

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
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
        else if (!this._voice.connection && !this._voice.connection?.ready) return false;

        // Если поток не читается, переходим в состояние ожидания
        else if (!this._audio.current && !this._audio.current.packets || !this._audio.current?.readable) {
            this.status = "player/wait";
            this.disableCycle();
            return false;
        }

        return true;
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
        /**
         * @description Уникальный идентификатор сервера, для привязки плеера к серверу
         * @protected
         * @abstract
         */
        protected _tracks: ControllerTracks<Track>,
        protected _voice: ControllerVoice<VoiceConnection>,
        protected id?: string,
    ) {
        super();

        // Запускаем проигрывание аудио после создания плеера
        setImmediate(this.play);

        /**
         * @description Событие смены позиции плеера
         * @private
         */
        this.on("player/wait", async (player) => {
            const repeat = player.tracks.repeat;
            const current = player.tracks.position;

            // Если включен повтор трека сменить позицию нельзя
            if (repeat === RepeatType.Song) player.tracks.position = current;

            // Если включен бесконечный поток
            else if (repeat === RepeatType.AutoPlay) {
                // Если последняя позиция
                if (current === player.tracks.total - 1) {
                    try {
                        const tracks = await db.api.fetchRelatedTracks(player.tracks.track);

                        // Если получена ошибка
                        if (tracks instanceof Error) Logger.log("ERROR", tracks);

                        // Если нет похожих треков
                        else if (!tracks.length) this.emit("player/error", player, "Autoplay System: failed get related tracks");

                        // Добавляем треки
                        else {
                            tracks.forEach((song) => {
                                song.user = player.tracks.get(player.tracks.total - 1).user;
                                player.tracks.push(song);
                            });
                        }
                    } catch (err) {
                        Logger.log("ERROR", err as Error);
                    }
                }

                // Меняем позицию трека в списке
                player.tracks.position = player.tracks.position + 1;
            }

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
            return player.play(0, PLAYER_PAUSE_OFFSET);
        });

        /**
         * @description Событие получения ошибки плеера
         * @private
         */
        this.on("player/error", (player, error, skip) => {
            const queue = db.queues.get(player.id);
            const current = player.tracks.position;

            // Если надо пропустить трек
            if (skip) {
                // Если надо пропустить текущую позицию
                if (skip.position === current) {
                    // Если плеер играет, то не пропускаем
                    if (player?.audio && player?.audio?.current?.packets > 0) return;
                    this.emit("player/wait", player);
                }

                // Если следующих треков нет
                else if (player.tracks.size === 0) return queue.cleanup();

                player.tracks.remove(skip.position);
            }

            // Позиция трека для сообщения
            const position = skip?.position !== undefined ? skip?.position : current;

            // Выводим сообщение об ошибке
            db.events.emitter.emit("message/error", queue, error, position);
        });
    };

    /**
     * @description Включение плеера в цикл
     * @private
     */
    private enableCycle = () => {
        // Если нет плеера в цикле
        if (!db.queues.cycles.players.has(this)) {
            db.queues.cycles.players.add(this);

            Logger.log("DEBUG", `[AudioPlayer/${this.id}] pushed in cycle`);
        }
    };

    /**
     * @description Отключение плеера от цикла
     * @private
     */
    private disableCycle = () => {
        // Если есть плеер в цикле
        if (db.queues.cycles.players.has(this)) {
            db.queues.cycles.players.delete(this);

            Logger.log("DEBUG", `[AudioPlayer/${this.id}] removed from cycle`);
        }
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param timeout - Время через которое надо включить трек
     * @param position - Позиция нового трека
     * @public
     */
    public play = async (seek: number = 0, timeout: number = 0, position: number = null): Promise<void> => {
        const index = typeof position === "number" ? position : this._tracks.indexOf(this._tracks.track);

        // Получаем трек следуя позиции
        const track = this._tracks.get(index);

        // Если нет такого трека или статуса
        if (!track || this._status === null) return;

        try {
            const resource = await this._preloadTrack(index);

            // Если получена ошибка вместо исходника
            if (!resource || resource instanceof Error) {
                this.emit("player/error", this, `${resource}`, { skip: true, position: index });
                return;
            }

            // Создаем аудио поток
            const stream = this._readStream(resource, track.time.total, seek);

            // Если нельзя создать аудио поток, поскольку создается другой
            if (!stream) return;

            // Действия при готовности
            const handleReady = () => {
                // Производим явную синхронизацию времени
                if (this._audio.current) stream.seek = this._audio.current.duration;

                // Переводим плеер в состояние чтения аудио
                this.status = "player/playing";

                // Меняем позицию если удачно
                this._tracks.position = index;

                // Если трек включен в 1 раз
                if (seek === 0) {
                    const queue = db.queues.get(this.id);
                    db.events.emitter.emit("message/playing", queue); // Отправляем сообщение, если можно
                }

                // Заставляем плеер запускаться самостоятельно
                setImmediate(this.enableCycle);
            };

            // Подключаем события для отслеживания работы потока (временные)
            (stream as BufferedAudioResource)

                // Если чтение возможно
                .once("readable", () => {
                    const pauseTimeout = this._timer.timeout;

                    // Если включить трек сейчас не выйдет
                    if (pauseTimeout > Date.now() || timeout) {
                        this._timer.timer = setTimeout(handleReady, timeout ? timeout : pauseTimeout - Date.now());
                        return;
                    }

                    return handleReady();
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
        this.disableCycle();
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
            this.enableCycle();
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
        this.status = "player/wait";

        // Отправляем silent frame в голосовое соединение для паузы звука
        this._voice.connection.packet = SILENT_FRAME;
    };

    /**
     * @description Запуск чтения потока
     * @param path - Путь до файла или ссылка на аудио
     * @param time - Длительность трека
     * @param seek - Время пропуска, трек начнется с указанного времени
     */
    protected _readStream = (path: string, time: number = 0, seek: number = 0) => {
        Logger.log("DEBUG", `[AudioPlayer/${this.id}] has read stream ${path}`);

        // Если другой аудио поток загружается, то запрещаем включение
        if (this._audio.preloaded) return null;

        // Выбираем и создаем класс для предоставления аудио потока
        return this._audio.preload = new (time > PLAYER_BUFFERED_TIME || time === 0 ? PipeAudioResource : BufferedAudioResource)(
            {
                path,
                options: {
                    seek,
                    filters: this._filters.toString(time, this._audio.volume, this._audio.current && this._audio.current?.packets > 0)
                }
            }
        );
    };

    /**
     * @description Пред загрузка трека, если конечно это возможно
     * @param position - Позиция трека
     */
    protected _preloadTrack = async (position: number): Promise<false | string | Error> => {
        const track = this._tracks.get(position);

        // Если нет трека в очереди
        if (!track) return false;

        // Получаем данные
        const path = await track?.resource;

        // Если получена ошибка вместо исходника
        if (path instanceof Error) return path;

        // Если нет исходника
        else if (!path) return new Error("AudioError\n - Do not getting audio link!");

        // Если получить трек удалось
        return path;
    };

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
        this.disableCycle();

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
 * @description Под класс для ограничения времени плеера, для стабильной работы Jitter Buffer
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
     * @public
     */
    public destroy = () => {
        this._pauseTimestamp = null;

        if (this._pauseTimeout) clearTimeout(this._pauseTimeout);
        this._pauseTimeout = null;
    };
}