import {AudioPlayerEvents, PlayerTracks, PlayerAudioFilters} from "@service/player";
import {AudioResource, SILENT_FRAME} from "@service/voice";
import {Logger, TypedEmitter} from "@utils";
import {db} from "@app";

// Local modules
import {PlayerProgress} from "../modules/progress";
import {PlayerVoice} from "../modules/voice";
import {PlayerAudio} from "../modules/audio";
import {RepeatType} from "../modules/tracks";

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
    protected readonly _audio = new PlayerAudio();

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
}

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки на серверах
 * @class AudioPlayer
 * @public
 */
export class AudioPlayer extends BasePlayer {
    /**
     * @description Плеер привязан к queue, и это его идентификатор
     * @readonly
     * @public
     */
    public readonly id: string;


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
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        // Если текущий статус не позволяет проигрывать музыку
        if (this.status === "player/wait" || this.status === "player/pause") return false;

        // Если голосовое состояние не позволяет отправлять пакеты
        else if (!this.voice.connection || this.voice.connection.status !== "ready") return false;

        // Если поток не читается, переходим в состояние ожидания
        else if (!this.audio.current?.readable) {
            this.audio.current = null;
            this.status = "player/wait";
            return false;
        }

        return true;
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
     * @description Задаем параметры плеера перед началом работы
     * @param guild - ID сервера для аутентификации плеера
     */
    public constructor(guild: string) {
        super();
        this.id = guild;

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
            setTimeout(player.play, 2e3);
        });

        /**
         * @description Событие получения ошибки плеера
         * @private
         */
        this.on("player/error", async (player, error, skip) => {
            const queue = db.queues.get(player.id);

            // Заставляем плеер пропустить этот трек
            if (skip) {
                setImmediate(() => {
                    player.tracks.remove(skip.position);

                    if (player.tracks.size === 0) queue.cleanup();
                    else {
                        // Переключаем позицию назад, плеер сам переключит на следующий трек
                        player.tracks.position = player.tracks.position + 1;
                        player.emit("player/wait", player);
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

        // Позиция трека
        const positionIndex = position ?? this.tracks.indexOf(track);

        // Функция выполнения ошибки
        const handleError = (message: string) => {
            this.emit("player/error", this, message, { skip: true, position: positionIndex });
        };

        // Функция выполнения отправки сообщения
        const emitPlaying = () => {
            const queue = db.queues.get(this.id);
            // Отправляем сообщение, если можно
            db.events.emitter.emit("message/playing", queue);
        };


        // Получаем асинхронные данные в синхронном потоке
        track?.resource
            // Если удалось получить исходный файл трека
            .then((path) => {
                // Если получена ошибка вместо исходника
                if (path instanceof Error) return handleError(`Critical error in track.resource!\n\n${path.name}\n- ${path.message}`);

                // Если нет исходника
                else if (!path) return handleError("Fail to get audio link");

                // Создаем класс для управления потоком
                const stream = new AudioResource(path, { seek,
                    filters: this._filters.compress(track.api.name !== "DISCORD" ? track.time.total : null)
                });

                // Если стрим можно прочитать
                if (stream.readable) {
                    this.audio.current = stream;
                    this.status = "player/playing";

                    // Если включается именно новый трек
                    if (seek === 0) emitPlaying();
                    return;
                }

                // Если поток нельзя читать, возможно что он еще грузится
                const timeout = setTimeout(() => {
                    // Отправляем данные событию для отображения ошибки
                    handleError("Timeout: the stream has been exceeded!");

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
                        if (seek === 0) emitPlaying();

                        this.audio.current = stream;
                        this.status = "player/playing";
                    });
            })

            // Если возникла ошибка
            .catch((err) => {
                // Сообщаем об ошибке
                Logger.log("ERROR", `[Player/${this.id}] ${err}`);

                // Предпринимаем решение
                handleError(String(err));
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
     * @description Функция проигрывание текущего трека заново
     * @public
     */
    public replay = () => {
        // Включаем текущий трек заново
        this.play(0, this.tracks.position);
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