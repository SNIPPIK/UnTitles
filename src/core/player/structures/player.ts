import { ControllerTracks, ControllerVoice, RepeatType, Track } from "#core/queue/index.js";
import { AudioResource, SILENT_FRAME, OPUS_FRAME_SIZE } from "#core/audio/index.js";
import { type AudioFilter, ControllerFilters } from "#core/player/index.js";
import { AudioPlayerEvents } from "#handler/events/index.js";
import { PlayerProgress } from "../controllers/progress.js";
import type { VoiceConnection } from "#core/voice/index.js";
import { PlayerAudio } from "../structures/audio.js";
import { Logger, TypedEmitter } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Глобальный экземпляр для вычисления прогресс-бара.
 * @remarks
 * Вынесен для переиспользования, чтобы не создавать объект при каждом запросе.
 * @private
 */
const Progress = new PlayerProgress();

/**
 * @author SNIPPIK
 * @description Безопасное время (мс) между отправкой аудио пакетов при возобновлении после паузы.
 * @remarks
 * Используется для защиты от переполнения jitter-буфера. При паузе плеер продолжает отправлять
 * SILENT_FRAME, но фактическое воспроизведение останавливается. Возобновление происходит только
 * после истечения этого интервала, чтобы избежать резкого наплыва пакетов.
 * @const
 * @private
 */
const PLAYER_PAUSE_OFFSET = 3000;

/**
 * @author SNIPPIK
 * @description Безопасное время (мс) между завершением одного трека и началом следующего.
 * @remarks
 * Необходимо для корректного закрытия текущего аудиопотока и освобождения ресурсов перед
 * запуском следующего. Без этого VoiceSocket может получить переполнение буфера (пинг >1000).
 * @const
 * @private
 */
const PLAYER_TIMEOUT_OFFSET = 3000;

/**
 * @author SNIPPIK
 * @description Основной класс аудио плеера, управляющий воспроизведением очереди треков.
 * @extends TypedEmitter<AudioPlayerEvents>
 * @public
 *
 * # Особенности
 * - Предотвращает загрузку нового трека, пока предыдущий не завершён (через 10 сек можно загрузить новый).
 * - Поддерживает «горячую» замену треков (hot swap) без сбоев jitter buffer (использует AudioPlayerTimeout).
 * - Умеет накладывать аудио фильтры через FFmpeg (громкость, эквалайзер и т.д.).
 * - Высокая надёжность, практически невозможно сломать благодаря встроенным тайм-аутам и защитным механизмам.
 *
 * @example
 * ```ts
 * const player = new AudioPlayer(tracks, voice, guildId);
 * player.on('player/playing', () => console.log('Now playing'));
 * player.play();
 * ```
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    /** Количество пакетов, ожидающих отправки в UDP-буфере (для мониторинга загрузки) */
    public _buffered: number | null = 1;

    /** Текущее состояние плеера */
    protected _status: AudioPlayerState | null = AudioPlayerState.idle;

    /** Менеджер тайм-аутов для безопасной паузы/возобновления */
    protected _timer: AudioPlayerTimeout | null = new AudioPlayerTimeout();

    /** Хранилище активных аудио фильтров (громкость, эквалайзер и т.п.) */
    protected _filters: ControllerFilters<AudioFilter> | null = new ControllerFilters<AudioFilter>();

    /** Управление текущим аудиопотоком (чтение, буферизация, пред загрузка) */
    protected _audio: PlayerAudio<AudioResource> | null = new PlayerAudio();

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
    public set status(status: AudioPlayerState) {
        // Если был введен новый статус
        if (status !== this._status) {
            // Записываем статус
            this._status = status;

            // Запускаем событие
            this.emit(status, this);

            // Если пришло событие ожидания
            if (status === AudioPlayerState.idle) this._PlayerNextTrack();
        }
    };

    /**
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const { api, time } = this._tracks.track;
        const current = (this._audio.current?.duration || 0);

        // Создаем прогресс бар
        const bar =  Progress.bar({
                platform: api.name,
                duration: {
                    current: current,
                    total: time.total
                }
            }
        );

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };

    /**
     * @description Буфер плеера, кол-во времени пакетов в буфере udp подключения
     * @public
     */
    public get latency() {
        return this._buffered * OPUS_FRAME_SIZE;
    };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Наличие аудио-ресурса и статуса
        return this._status === "player/playing" && !!this._audio.current;
    };

    /**
     * @description Включение/Отключение плеера в цикла
     * @public
     */
    public set cycle(isActive: boolean) {
        // Подключаем плеер к циклу
        if (isActive) {
            // Если нет плеера в цикле
            if (!db.queues.cycles.players.has(this)) {
                // Отправляем пустышку
                if (this._voice.connection.ready) this._voice.connection.packet(SILENT_FRAME);

                // Добавляем плеер в цикл
                db.queues.cycles.players.add(this);
                this.emit("player/log", `[AudioPlayer/${this.id}] pushed in cycle`)
            }
        }

        // Отключаем плеер от цикла
        else if (!isActive) {
            // Если есть плеер в цикле
            if (db.queues.cycles.players.has(this)) {
                // Удаляем плеер из цикла
                db.queues.cycles.players.delete(this);

                // Отправляем пустышку
                if (this._voice.connection.ready) this._voice.connection.packet(SILENT_FRAME);
                this.emit("player/log", `[AudioPlayer/${this.id}] removed from cycle`)
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
                // Если надо пропустить текущую позицию
                if (skip.position === current) {
                    // Если плеер играет, то не пропускаем
                    if (player?.audio && player?.audio?.current?.packets > 0) return;
                    player.emit("player/wait", player);
                }

                // Если следующих треков нет
                else if (player.tracks.size === 0) return queue.cleanup();
                player.tracks.remove(skip.position);
            }
        });

        /**
         * @description Выводим данные плеера
         * @private
         */
        this.on("player/log", (status) => {
            Logger.log("LOG", status);
        });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param timeout - Время через которое надо включить трек
     * @param position - Позиция нового трека
     * @public
     */
    public play = async (seek: number = 0, timeout: number = 500, position: number = null): Promise<void> => {
        let track: Track, index: number;

        // Если позиция явно указана
        if (typeof position === "number") {
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
            // Получаем путь до аудио файла
            const resource = await track?.resource;

            // Если получена ошибка вместо исходника
            if (resource instanceof Error) {
                this.emit("player/error", this, `${resource}`, { skip: true, position: index });
                return;
            }

            // Если другой аудио поток загружается, то запрещаем включение
            if (this._audio.preloaded) return null;

            this.emit("player/log", `[AudioPlayer/${this.id}|${this._filters?.size}] has read ${!track.isLive ? "buffered" : "piped"} stream ${resource}`);

            // Выбираем тип аудио
            const stream = this._audio.preload = new AudioResource(
                {
                    seek,
                    filters: this._filters.filters,
                    volume: this._audio.volume,
                    swapped: this._audio.current?.packets > 0,
                    track
                }
            );

            // Подключаем события для отслеживания работы потока (временные)
            (stream as AudioResource)
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
                .once("error", (error: Error) => {
                    // Отправляем данные событию для отображения ошибки
                    this.emit("player/error", this, `${error}`, { skip: true, position: index });
                })

                // Если аудио поток был закрыт
                .once("close", (status) => {
                    // Отправляем данные событию
                    this.emit("player/log", status);
                });
        } catch (error) {
            this.emit("player/error", this, `${error}`, { skip: true, position: index });

            // Сообщаем об ошибке
            this.emit("player/log", `[Player/${this.id}] ${error}`);
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
        this.status = AudioPlayerState.pause;

        // Устанавливаем время паузы
        this._timer.timeout = Date.now();

        // Отключаем плеер от цикла
        this.cycle = false;

        // Логируем
        this.emit("player/log", `[AudioPlayer/${this.id}] paused`);
    };

    /**
     * @description Возобновляет воспроизведение плеера
     * @returns void
     * @public
     */
    public resume = (): void => {
        if (this._status !== AudioPlayerState.pause) return;

        // Сколько осталось ждать до безопасного возобновления
        const remaining = this._timer.getRemaining();

        if (remaining === 0) {
            // Можно сразу возобновлять
            this.status = AudioPlayerState.playing;
            this._timer.timeout = null; // очищаем
            this.cycle = true;

            this.emit("player/log", `[AudioPlayer/${this.id}] resumed immediately`);
            return;
        }

        // Иначе ставим таймер на оставшееся время
        this._timer.timer = setTimeout(() => {
            // Если плеер ещё в паузе
            if (this._status === AudioPlayerState.pause) {
                this.status = AudioPlayerState.playing;
                this._timer.timeout = null;
                this.cycle = true;

                this.emit("player/log", `[AudioPlayer/${this.id}] resumed after delay`);
            }
        }, remaining);
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @returns Promise<void> | void
     * @public
     */
    public stop = (): Promise<void> | void => {
        if (this._status === AudioPlayerState.idle) return;
        this.status = AudioPlayerState.idle;
    };

    /**
     * @description Включение следующего трека
     * @private
     */
    private readonly _PlayerNextTrack = (): void => {
        const tracks = this.tracks;

        const repeat = tracks.repeat;
        const current = tracks.position;

        // Если включен повтор трека сменить позицию нельзя
        if (repeat === RepeatType.Song) tracks.position = current;

        // Если включен бесконечный поток
        else if (repeat === RepeatType.AutoPlay) {
            // Если последняя позиция
            if (current === tracks.total - 1) {
                try {
                    db.api.fetchRelatedTracks(tracks.track).then((related) => {
                        // Если получена ошибка
                        if (related instanceof Error) {
                            this.emit("player/log", related)
                        }

                        // Если нет похожих треков
                        else if (!related.length) this.emit("player/error", this, "Autoplay System: failed get related tracks");

                        // Добавляем треки
                        else {
                            const user = tracks.track.user;

                            related.forEach((song) => {
                                tracks.push(song, user);
                            });
                        }
                    }).catch((err) => {
                        this.emit("player/log", err as Error)
                    })
                } catch (err) {
                    this.emit("player/log", err as Error)
                }
            }

            // Меняем позицию трека в списке
            tracks.position = tracks.position + 1;
        }

        // Если включен повтор треков или его вовсе нет
        else {
            // Меняем позицию трека в списке
            tracks.position = tracks.position + 1;

            // Если повтор выключен
            if (repeat === RepeatType.None) {
                // Если очередь началась заново
                if (current + 1 === tracks.total && tracks.position === 0) {
                    return db.queues.get(this.id)?.cleanup();
                }
            }
        }

        // Через время запускаем трек, что-бы не нарушать работу VoiceSocket
        // Что будет если нарушить работу VoiceSocket, пинг >=1000
        this.play(0, PLAYER_TIMEOUT_OFFSET).catch((err) => this.emit("player/error", this, err));
        return;
    };

    /**
     * @param index - Номер нового трека
     * @param seek - Время перехода к позиции аудио трека
     * @returns void
     * @private
     */
    private readonly _onPlayerReadable = (index: number, seek: number) => {
        // Если трек включен в 1 раз
        if (seek === 0) {
            const queue = db.queues.get(this.id);
            if (queue) db.events.emitter.emit("message/playing", queue) // Отправляем сообщение, если можно
        }

        // Переводим плеер в состояние чтения аудио
        this.status = AudioPlayerState.playing;

        // Передаем плеер в цикл
        this.cycle = true;

        // Меняем позицию если удачно
        this._tracks.position = index;
    };

    /**
     * @description Эта функция частично удаляет плеер и некоторые сопутствующие данные
     * @returns void
     * @public
     */
    public cleanup = () => {
        this.emit("player/log", `[AudioPlayer/${this.id}] has cleanup`);

        // Отключаем фильтры при очистке
        if (this._filters.size > 0) this._filters.clear();

        // Отключаем плеер от цикла
        this.cycle = false;

        // Удаляем текущий поток, поскольку он больше не нужен
        this._audio.destroy();

        // Ставим timeout для проигрывания
        this._timer.timeout = Date.now();

        // Переводим плеер в режим ожидания
        this._status = AudioPlayerState.idle;
    };

    /**
     * @description Эта функция полностью удаляет плеер и все сопутствующие данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this.emit("player/log", `[AudioPlayer/${this.id}] has destroyed`);
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
 * @description Возможные состояния плеера.
 * @public
 */
export enum AudioPlayerState {
    /** Ожидание, нет активного трека */
    idle = "player/wait",

    /** Воспроизведение аудио */
    playing = "player/playing",

    /** Трек завершён (используется для автоматического переключения) */
    ended = "player/ended",

    /** Статус пауза плеера */
    pause = "player/pause",

    /** Статус ошибки плеера */
    error = "player/error",
}

/**
 * @author SNIPPIK
 * @description Управление безопасными паузами и таймингом плеера.
 * @remarks
 * Гарантирует, что после паузы или ошибки будет выдержана необходимая задержка перед возобновлением,
 * чтобы не нарушить работу jitter buffer и VoiceSocket.
 * @private
 */
class AudioPlayerTimeout {
    /** Время (мс), после которого разрешено возобновление (включает PLAYER_PAUSE_OFFSET) */
    protected _resumeAllowedAt: number = null;

    /** Ссылка на активный таймер (для отмены) */
    private _resumeTimer: NodeJS.Timeout | null = null;

    /**
     * @description Возвращает время, когда будет разрешено возобновление, или null.
     * @public
     */
    public get timeout(): number | null {
        return this._resumeAllowedAt;
    };

    /**
     * @description Устанавливает время разрешения возобновления с учётом PLAYER_PAUSE_OFFSET.
     * @param time - Базовое время (обычно момент паузы), если null – сброс.
     * @public
     */
    public set timeout(time: number | null) {
        this._resumeAllowedAt = time !== null ? time + PLAYER_PAUSE_OFFSET : null;
    };

    /**
     * @description Устанавливает или заменяет таймер возобновления.
     * @param timer - Таймер, может быть null (сбрасывает).
     * @public
     */
    public set timer(timer: NodeJS.Timeout | null) {
        if (this._resumeTimer) clearTimeout(this._resumeTimer);
        this._resumeTimer = timer;
    };

    /**
     * @description Возвращает оставшееся время до разрешения возобновления (в мс).
     * @returns 0, если возобновление разрешено сейчас.
     * @public
     */
    public getRemaining(): number {
        if (!this._resumeAllowedAt) return 0;
        return Math.max(this._resumeAllowedAt - Date.now(), 0);
    };

    /**
     * @description Очищает таймер и сбрасывает состояние.
     * @public
     */
    public destroy() {
        if (this._resumeTimer) {
            clearTimeout(this._resumeTimer);
            this._resumeTimer = null;
        }
        this._resumeAllowedAt = null;
    };
}