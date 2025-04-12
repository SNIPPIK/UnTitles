import type {ChildProcessWithoutNullStreams} from "node:child_process"
import {spawn, spawnSync} from "node:child_process";
import {isMainThread} from "node:worker_threads";
import {Logger} from "@utils";
import {env} from "@handler";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 * @private
 */
export class Process {
    /**
     * @description Процесс запущенный через spawn
     * @private
     */
    private _process: ChildProcessWithoutNullStreams = null;

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
        // Если процесс уже уничтожен
        if (!this._process || this._process.killed) return null;

        return this?.process?.stdout;
    };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = ffmpeg_path) {
        // Проверяем на наличие ссылки в пути
        if (args.includes("-i")) {
            const index = args.indexOf("-i");
            const isLink = args.at(index + 1).startsWith("http");

            // Если указана ссылка
            if (isLink) args.unshift("-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5")
        }

        // Проверяем на наличие пропуска времени
        if (args.includes("-ss")) {
            const index = args.indexOf("-ss");
            const seek = parseInt(args.at(index + 1));

            // Если указано не число
            if (isNaN(seek) || seek === 0) args.splice(index, 2);
        }

        args.unshift("-vn", "-loglevel", "panic");
        this._process = spawn(name, args);

        for (let event of ["end", "error", "exit"]) {
            this.process.once(event, this.destroy);
        }
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public destroy = () => {
        if (this._process) {
            Logger.log("DEBUG", `[Process/${this._process.pid}] has destroyed`);

            for (const std of [this._process.stdout, this._process.stderr, this._process.stdin]) {
                std.removeAllListeners();
                std.destroy();
            }

            this.process.ref();
            this.process.removeAllListeners();
            this._process.kill("SIGKILL");
            this._process = null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Путь до исполняемого файла ffmpeg
 */
let ffmpeg_path = null;

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg
 */
(async () => {
    if (!isMainThread) return;

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