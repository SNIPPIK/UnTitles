import {Process} from "@lib/voice/audio/Opus";
import {Cycle} from "@util/tools";
import {Track} from "@lib/player";
import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Класс для сохранения аудио файлов
 * @support ogg/opus
 * @class CacheAudio
 * @protected
 */
export class CacheAudio extends Cycle<Track> {
    /**
     * @description Путь до директории с кешированными данными
     * @readonly
     * @private
     */
    private readonly cache_dir: string = null;

    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor(cache_dir: string) {
        super({
            name: "AudioFile",
            duration: "promise",
            filter: (item) => {
                const names = this.status(item);

                //Если уже скачено или не подходит для скачивания то, пропускаем
                if (names.status === "ended" || item.time.total > 600) {
                    this.remove(item);
                    return false;

                    //Если нет директории то, создаем ее
                } else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");

                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    fs.mkdirSync(dirs.join("/"), {recursive: true});
                }
                return true;
            },
            execute: (track) => {
                return new Promise<boolean>((resolve) => {
                    const status = this.status(track);

                    // Создаем ffmpeg для скачивания трека
                    const ffmpeg = new Process([
                        "-vn",  "-loglevel", "panic",
                        "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                        "-i", track.link,
                        "-f", `opus`,
                        `${status.path}.opus`
                    ]);

                    // Если была получена ошибка
                    ffmpeg.stdout.once("error", () => {
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("close", () => {
                        return resolve(true);
                    });
                });
            }
        });

        this.cache_dir = cache_dir;
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     */
    public status = (track: Track): { status: "not-ended" | "ended" | "download", path: string } => {
        const file = `${this.cache_dir}/Audio/[${track.id}]`;

        // Если файл был найден в виде opus
        if (fs.existsSync(`${file}.opus`)) return { status: "ended", path: `${file}.opus`};

        // Выдаем что ничего нет
        return { status: "not-ended", path: file };
    };
}