import {AudioPlayerEvents, PlayerTracks, PlayerAudioFilters} from "@service/player";
import {AudioResource, SILENT_FRAME} from "@service/voice";
import {Logger, TypedEmitter} from "@utils";
import {db} from "@app";

// Local modules
import {PlayerProgress} from "../modules/progress";
import {PlayerVoice} from "../modules/voice";
import {PlayerAudio} from "../modules/audio";

/**
 * @author SNIPPIK
 * @description Создаем класс для вычисления progress bar
 * @class PlayerProgress
 * @private
 */
const Progress = new PlayerProgress();

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки на серверах
 * @class AudioPlayer
 * @public
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    /**
     * @description Текущий статус плеера, при создании он должен быть в ожидании
     * @private
     */
    private _status: keyof AudioPlayerEvents = "player/wait";

    /**
     * @description Плеер привязан к queue, и это его идентификатор
     * @readonly
     * @public
     */
    public readonly id: string;

    /**
     * @description Хранилище треков
     * @readonly
     * @private
     */
    private readonly _tracks: PlayerTracks = new PlayerTracks();

    /**
     * @description Хранилище аудио фильтров
     * @readonly
     * @private
     */
    private readonly _filters: PlayerAudioFilters = new PlayerAudioFilters();

    /**
     * @description Управление голосовыми состояниями
     * @readonly
     * @private
     */
    private readonly _voice: PlayerVoice = new PlayerVoice();

    /**
     * @description Управление потоковым вещанием
     * @readonly
     * @private
     */
    private readonly _audio: PlayerAudio = new PlayerAudio();

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
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Если текущий статус не позволяет проигрывать музыку
        if (this.status === "player/wait" || this?.status === "player/pause") return false;

        // Если голосовое состояние не позволяет отправлять пакеты
        else if (!this.voice.connection || this.voice.connection?.state?.status !== "ready") return false;

        // Если поток не читается, переходим в состояние ожидания
        else if (!this.audio.current?.readable) {
            this.audio.current = null;
            this.status = "player/wait";
            return false;
        }

        return true;
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
            // Если начато воспроизведение, то даем возможность говорить боту
            if (status === "player/playing") this.voice.connection.speak = true;

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
        const {api, time} = this.tracks.track;
        let current = this.audio?.current?.duration;

        // Скорее всего трек играет следующий трек
        if (current > time.total || !this.playing) current = 0;

        // Создаем прогресс бар
        const bar =  Progress.bar({ platform: api.name, duration: { current, total: time.total } });

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };



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
     * @description Задаем параметры плеера перед началом работы
     * @param guild - ID сервера для аутентификации плеера
     */
    public constructor(guild: string) {
        super();
        this.id = guild;

        // Загружаем события плеера
        for (const event of db.events.emitter.player)
            this.addListener(event, (...args: any) => db.events.emitter.emit(event, ...args));

        // Добавляем плеер в базу для отправки пакетов
        db.queues.cycles.players.set(this);
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @param position - Позиция нового трека
     * @public
     */
    public play = (seek: number = 0, position: number = null): void => {
        const track = this._tracks?.track;

        // Если больше нет треков
        if (!track) {
            this.emit("player/wait", this);
            return;
        }

        // Получаем асинхронные данные в синхронном потоке
        track?.resource
            // Если удалось получить исходный файл трека
            .then((path) => {
                // Если нет исходника
                if (!path) {
                    this.emit("player/error", this, `Fail to get audio link`, {
                        skip: true,
                        position: position ?? this.tracks.indexOf(track)
                    });
                    return;
                }

                // Если получена ошибка вместо исходника
                else if (path instanceof Error) {
                    this.emit("player/error", this, `Critical error in track.resource!\n\n${path.name}\n- ${path.message}`, {
                        skip: true,
                        position: position ?? this.tracks.indexOf(track)
                    });
                    return;
                }

                // Создаем класс для управления потоком
                const stream = new AudioResource(path, {seek, filters: this._filters.compress(track.api.name !== "DISCORD" ? track.time.total : null)});

                // Если стрим можно прочитать
                if (stream.readable) {
                    this.audio.current = stream;
                    this.status = "player/playing";

                    // Если включается именно новый трек
                    if (seek === 0) {
                        const queue = db.queues.get(this.id);

                        // Отправляем сообщение, если можно
                        db.events.emitter.emit("message/playing", queue);
                    }

                    return;
                }

                // Если поток нельзя читать, возможно что он еще грузится
                const timeout = setTimeout(() => {
                    // Отправляем данные событию для отображения ошибки
                    this.emit("player/error", this, "Timeout the stream has been exceeded!", {
                        skip: true,
                        position: position ?? this.tracks.indexOf(track)
                    });

                    // Уничтожаем поток
                    stream.destroy();
                }, 10e3);

                // Подключаем события для отслеживания работы потока (временные)
                stream
                    // Если возникнет ошибка во время загрузки потока
                    .once("error", () => {
                        clearTimeout(timeout);

                        // Уничтожаем поток
                        stream.destroy();
                    })
                    // Если уже можно читать поток
                    .once("readable", () => {
                        clearTimeout(timeout);

                        // Если включается именно новый трек
                        if (seek === 0) {
                            const queue = db.queues.get(this.id);

                            // Отправляем сообщение, если можно
                            db.events.emitter.emit("message/playing", queue);
                        }

                        this.audio.current = stream;
                        this.status = "player/playing";
                    });
            })

            // Если возникла ошибка
            .catch((err) => {
                // Сообщаем об ошибке
                Logger.log("ERROR", `[Player] ${err}`);

                // Предпринимаем решение
                this.emit("player/error", this, `${err}`, {skip: true, position: position ?? this.tracks.indexOf(track)});
            });
    };

    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = () => {
        if (this.status !== "player/playing") return;
        this.status = "player/pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = () => {
        if (this.status !== "player/pause") return;
        this.status = "player/playing";
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @param position - Позиция нового трека
     * @public
     */
    public stop = (position?: number) => {
        // Если есть позиция трека, для плавного перехода
        if (typeof position === "number") {
            const duration = this.tracks.track.time.total - db.queues.options.optimization;

            // Если можно сделать плавные переход
            if (this.audio.current && duration > this.audio.current.duration) {
                this.tracks.position = position;
                this.play(0, position);
                return;
            }
        }

        if (this.status === "player/wait") return;
        this.status = "player/wait";
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
        db.queues.cycles.players.remove(this);

        // Удаляем текущий поток, поскольку он больше не нужен
        this.audio.current = null;

        // Отправляем пустышку
        this.voice.send = SILENT_FRAME;

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