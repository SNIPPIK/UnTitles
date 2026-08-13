import { TRACK_CHECK_WAIT } from "#core/queue/controllers/provider.js";
import { AudioResource } from "#core/audio/index.js";
import { Logger } from "#structures";
import { db } from "#app/db";

/**
 * Управляет жизненным циклом аудиопотоков в плеере: текущим воспроизведением,
 * пред загрузкой, таймаутами и индикацией громкости.
 *
 * Класс оптимизирован для частых обращений:
 * - индикатор громкости кэшируется в строковом виде и пересчитывается только при изменении громкости;
 * - признак наличия пред загруженного потока хранится в явном поле, а не вычисляется динамически;
 * - прямые проверки и отсутствие избыточных вызовов ускоряют горячий путь.
 *
 * @typeParam T - Тип аудио ресурса, расширяющий `AudioResource`.
 *
 * @example
 * ```ts
 * const audio = new PlayerAudio<MyStream>();
 * audio.volume = 85;                      // устанавливает громкость и индикатор
 * audio.preload = new MyStream(...);      // запускает пред загрузку
 * console.log(audio.volumeIndicator);     // "🔊 85%"
 * ```
 */
export class PlayerAudio<T extends AudioResource> {
    /**
     * Текущий активный (воспроизводимый) аудиопоток.
     * `null`, если ничего не проигрывается.
     */
    private _audio: T | null = null;

    /**
     * Поток, находящийся в процессе пред загрузки (ожидает события `readable`).
     * После успешной инициализации перемещается в `_audio`.
     */
    private _pre_audio: T | null = null;

    /**
     * Таймер контроля максимального времени ожидания готовности пред загружаемого потока.
     * По истечении генерируется ошибка, и поток уничтожается.
     */
    private _timeout: NodeJS.Timeout | null = null;

    /**
     * Текущая громкость (целое число, диапазон 10..200).
     * Инициализируется глобальной настройкой из хранилища конфигурации.
     */
    private _volume = db.queues.options.volume;

    /**
     * Кешированная строка индикатора громкости (эмодзи + значение).
     * Пересчитывается только при изменении `_volume`.
     */
    private _volumeIndicator: string;

    /**
     * Кешированный признак наличия пред загруженного (но ещё не активного) потока.
     * Позволяет быстро проверить состояние без разыменования `_pre_audio`.
     */
    private _preloaded = false;

    /**
     * Создаёт экземпляр менеджера аудио.
     * Вычисляет начальный индикатор громкости на основе значения по умолчанию.
     */
    public constructor() {
        this._updateVolumeIndicator();
    };

    /**
     * Устанавливает громкость и обновляет кэшированный текстовый индикатор.
     *
     * Значение автоматически ограничивается диапазоном **[10, 200]**:
     * - меньше 10 → 10 (почти беззвучно, но не 0);
     * - больше 200 → 200 (максимальное усиление).
     *
     * @param volume - Новый уровень громкости (целое число).
     */
    public set volume(volume: number) {
        // Простой clamp без тернарных операторов для производительности.
        this._volume = volume > 200 ? 200 : volume < 10 ? 10 : volume;
        this._updateVolumeIndicator();
    };

    /** Текущий уровень громкости (10..200). */
    public get volume(): number {
        return this._volume;
    };

    /**
     * Кешированный индикатор громкости в формате `"🔉 85%"`.
     * Обновляется синхронно при изменении `volume`.
     */
    public get volumeIndicator(): string {
        return this._volumeIndicator;
    };

    /** Активный аудиопоток или `null`, если ничего не воспроизводится. */
    public get current(): T | null {
        return this._audio;
    };

    /**
     * Признак того, что в данный момент есть пред загружаемый поток,
     * ожидающий готовности (события `readable`).
     */
    public get preloaded(): boolean {
        return this._preloaded;
    };

    /**
     * Начинает пред загрузку нового аудиопотока.
     *
     * Логика:
     * 1. Если уже есть ожидающий поток (`_pre_audio`), он уничтожается, а его таймер сбрасывается.
     * 2. Новый поток сохраняется в `_pre_audio`, взводится флаг `_preloaded`.
     * 3. Запускается таймер на `TRACK_CHECK_WAIT` мс — если за это время поток не станет готовым,
     *    генерируется ошибка, и поток уничтожается.
     * 4. При возникновении ошибки в потоке (событие `error`) поток также уничтожается,
     *    флаг сбрасывается.
     * 5. Когда поток сигнализирует о готовности к чтению (`readable`), он становится активным:
     *    текущий `_audio` уничтожается, новый переносится в `_audio`,
     *    `_pre_audio` и таймер очищаются, флаг `_preloaded` сбрасывается.
     *
     * **Важно:** Метод предполагает, что поток ещё не готов на момент вызова.
     * Если поток уже находится в состоянии `readable` **до** подписки, событие `readable`
     * не будет сгенерировано повторно, и пред загрузка зависнет до тайм-аута.
     * Потребитель должен гарантировать, что свежесозданный поток ещё не начал генерацию данных.
     *
     * @param stream - Новый аудиопоток для пред загрузки.
     */
    public set preload(stream: T) {
        // Отменяем предыдущую пред загрузку, если она ещё не завершилась.
        if (this._pre_audio) {
            clearTimeout(this._timeout!);
            this._pre_audio.destroy();
        }

        this._pre_audio = stream;
        this._preloaded = true;

        // Устанавливаем защитный тайм-аут.
        this._timeout = setTimeout(() => {
            stream.emit("error", new Error("Timeout: the stream has been exceeded!"));
        }, TRACK_CHECK_WAIT);

        // При ошибке — очищаем всё, связанное с этим потоком.
        stream.once("error", (error) => {
            clearTimeout(this._timeout!);
            stream.destroy();
            this._pre_audio = null;
            this._preloaded = false;
            Logger.log("ERROR", error);
        });

        // Поток готов к чтению — активируем его.
        stream.once("readable", () => {
            clearTimeout(this._timeout!);
            // Уничтожаем предыдущий активный поток, если он был.
            this._audio?.destroy();
            // Переключаем на новый.
            this._audio = stream;
            this._pre_audio = null;
            this._preloaded = false;
        });
    };

    /**
     * Полное освобождение ресурсов: уничтожает текущий и пред загружаемый потоки,
     * сбрасывает все внутренние состояния и таймеры.
     *
     * После вызова экземпляр можно использовать повторно, но все ссылки на потоки
     * будут утеряны.
     */
    public destroy = () => {
        this._audio?.destroy();
        this._audio = null;

        this._pre_audio?.destroy();
        this._pre_audio = null;
        this._preloaded = false;

        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
    };

    /**
     * Пересчитывает кэшированную строку индикатора громкости на основе `_volume`.
     *
     * Использует разные эмодзи в зависимости от уровня:
     * - 10..29 → 🔈 (очень тихо)
     * - 30..69 → 🔉 (умеренно)
     * - 70..149 → 🔊 (громко)
     * - 150..200 → 📢 (максимальная громкость / усиление)
     *
     * Результат сохраняется в `_volumeIndicator` для мгновенного доступа.
     */
    private _updateVolumeIndicator(): void {
        const v = this._volume;
        if (v < 30) {
            this._volumeIndicator = `🔈 ${v}%`;
        } else if (v < 70) {
            this._volumeIndicator = `🔉 ${v}%`;
        } else if (v < 150) {
            this._volumeIndicator = `🔊 ${v}%`;
        } else {
            this._volumeIndicator = `📢 ${v}%`;
        }
    };
}