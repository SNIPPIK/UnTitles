import type {ChildProcessWithoutNullStreams} from "node:child_process"
import {spawn, spawnSync} from "node:child_process";
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
    public get process() { return this._process; }

    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() { return this?.process?.stdout; };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = ff_path) {
        this._process = spawn(name, args);
        ["end", "close", "error", "disconnect", "exit"].forEach((event) => this.process.once(event, this.destroy));
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public destroy = () => {
        // Удаляем данные в следующем цикле
        setImmediate(() => {
            if (this._process) {
                this._process.stdout.destroy();
                this._process.stdout.read();

                this._process.stderr.destroy();
                this._process.stderr.read();

                this._process.stdin.destroy();
                this._process.kill('SIGKILL');

                Logger.log("DEBUG", "[Process] has destroyed");
            }

            this._process = null;
        });
    };
}

/**
 * @author SNIPPIK
 * @description Путь до исполняемого файла ffmpeg
 */
let ff_path = null;

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg/avconv
 */
(() => {
    const cache = env.get("cache.dir");
    const names = [`${cache}/FFmpeg/ffmpeg`, cache, env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    // Проверяем имена, если есть FFmpeg/avconv
    for (const name of [...names, "ffmpeg", "avconv"]) {
        try {
            const result = spawnSync(name, ['-h'], {windowsHide: true});
            if (result.error) continue;
            ff_path = name;
            return env.set("ffmpeg.path", name);
        } catch {}
    }

    // Выдаем ошибку если нет FFmpeg/avconv
    throw Error("[Critical]: FFmpeg/avconv not found!");
})();