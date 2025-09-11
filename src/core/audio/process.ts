import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { env } from "#app/env";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 * @public
 */
export class Process {
    /**
     * @description Процесс запущенный через spawn
     * @private
     */
    private _process: ChildProcessWithoutNullStreams;

    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @return ChildProcessWithoutNullStreams
     * @public
     */
    public get process() {
        return this._process;
    };

    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() {
        return this?._process?.stdout ?? null;
    };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args - Аргументы для запуска
     * @param name - Имя процесса
     * @constructor
     * @public
     */
    public constructor(args: string[], name: string = ffmpeg_path) {
        const index_resource = args.indexOf("-i");
        const index_seek = args.indexOf("-ss");

        // Проверяем на наличие ссылки в пути
        if (index_resource !== -1) {
            const isLink = args.at(index_resource + 1)?.startsWith("http");

            // Если указана ссылка
            if (isLink) args.unshift("-reconnect", "1", "-reconnect_delay_max", "5", "-reconnect_on_network_error", "1");
        }

        // Проверяем на наличие пропуска времени
        if (index_seek !== -1) {
            const seek = parseInt(args.at(index_seek + 1));

            // Если указано не число
            if (isNaN(seek) || !seek) args.splice(index_seek, 2);
        }

        // Добавляем аргументы отключения видео и логирования
        args.unshift("-vn", "-loglevel", "error", "-hide_banner");
        this._process = spawn(name, args, {
            env: { PATH: process.env.PATH },
            stdio: "pipe",
            shell: false
        });

        // дДобавляем события к процессу
        for (let event of ["end", "error", "exit"]) {
            this._process.once(event, this.destroy);
        }
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public destroy = () => {
        if (this._process) {
            // Отключаем все точки данных и удаляем их
            for (const std of [this._process.stdout, this._process.stderr, this._process.stdin]) {
                std.removeAllListeners();
                std.destroy();
            }

            // Отключаем события
            this._process.removeAllListeners();
            // Убиваем процесс
            this._process.kill("SIGKILL");

            // Удаляем данные процесса
            this._process = null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Путь до исполняемого файла ffmpeg
 * @private
 */
let ffmpeg_path = null;

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg
 */
(async () => {
    const cache = env.get("cache.dir");
    const names = [`${cache}/ffmpeg`, cache, env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    // Проверяем имена, если есть FFmpeg/avconv
    for (const name of ["ffmpeg", ...names]) {
        try {
            const result = spawnSync(name, ['-h'], { windowsHide: true });
            if (result.error) continue;
            ffmpeg_path = name;
            return;
        } catch {}
    }

    // Выдаем ошибку если нет FFmpeg
    throw Error("[Critical] FFmpeg not found!");
})();