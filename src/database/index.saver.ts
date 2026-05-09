import type { APIRequestData } from "#handler/rest/index.js";
import { Logger, PromiseCycle } from "#structures";
import { Process } from "#core/audio/process.js";
import { Track } from "#core/queue/index.js";
import afs from "node:fs/promises";
import { env } from "#app/env";
import path from "node:path";
import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Утилита для скачивания метаданных треков
 * @class MetaSaver
 * @public
 */
export class MetaSaver<T extends APIRequestData.Track | APIRequestData.List> {
    /** Можно ли сохранять файлы */
    public inFile = env.get("cache.file") as boolean;

    /** Путь до директории с кешированными данными */
    public _dirname = path.resolve(env.get("cache.dir"));

    /**
     * @description Сохраняем трек в локальную базу данных
     * @param track - Кешируемый трек
     * @param api - Ссылка на платформу
     * @returns void
     * @public
     */
    public set = (track: T, api: string) => queueMicrotask(async () => {
        // Если можно сохранять в файлы
        if (this.inFile) {
            const Path = path.join(this._dirname, "Data", api, `${track.id}.json`);

            if (Path && !fs.existsSync(Path)) {
                try {
                    const dirPath = path.dirname(Path);
                    await afs.mkdir(dirPath, { recursive: true });

                    // Записываем данные в файл
                    await afs.writeFile(Path, JSON.stringify(track, null, 2), "utf-8");
                } catch (error) {
                    console.error("Failed to write track cache:", error);
                }
            }
        }

        return null;
    });

    /**
     * @description Выдаем данные из класса
     * @param ID - Идентификатор трека
     * @returns T
     * @public
     */
    public get = (ID: string): T => {
        // Если можно сохранять в файлы
        if (this.inFile) {
            // Если есть трек в кеше
            if (fs.existsSync(`${this._dirname}/Data/${ID}.json`)) {
                try {
                    // Если трек кеширован в файл
                    const json = JSON.parse(fs.readFileSync(`${this._dirname}/Data/${ID}.json`, "utf8"));

                    // Если трек был найден среди файлов
                    if (json) return json?.track ?? json;
                } catch {
                    return null;
                }
            }
        }

        return null;
    };
}

/**
 * @author SNIPPIK
 * @description Утилита для скачивания аудио данных
 * @class AudioSaver
 * @extends PromiseCycle<Track>
 * @public
 */
export class AudioSaver extends PromiseCycle<Track> {
    /** Путь до директории с кешированными данными */
    public _dirname = path.resolve(env.get("cache.dir"));

    public constructor() {
        super({
            duration: 30e3,
            custom: {
                push: (track) => {
                    // Удаляем дубликаты по URL (асинхронно, чтобы избежать мутации во время итерации)
                    setImmediate(() => {
                        const duplicates = this.filter(t => t.url === track.url);
                        for (let i = 1; i < duplicates.length; i++) {
                            this.delete(duplicates[i]);
                        }
                    })
                }
            },
            filter: async (item) => {
                const names = await this.status(item);

                // Если такой трек уже есть в системе кеширования
                if (names.status === "ended" || item.time.total > 500 || item.time.total === 0 || item.api.type === "technical") {
                    this.delete(item);
                    return false;
                }

                // Если нет директории то, создаем ее
                else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");
                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    await afs.mkdir(dirs.join("/"), { recursive: true });
                }

                return true;
            },
            execute: (track) => this.lowPriorityExecute(track)
        });
    }

    /**
     * Опускаем приоритет задачи в самый низ очереди Event Loop
     */
    private async lowPriorityExecute(track: Track): Promise<boolean> {
        return this.download(track);
    };

    /**
     * @description Старт скачивания аудио
     * @param track
     * @private
     */
    private async download(track: Track): Promise<boolean> {
        const status = await this.status(track);
        const targetFile = status.path;
        const tmp = targetFile + ".tmp";

        const similarPath = (track as any).similarTrackPath;
        const isLocalFile = track.link.startsWith("/") || track.link.includes(":\\");

        // --- ЛИНКОВКА (Второй проход или локальный файл) ---
        await this.symlink(track);

        // --- СКАЧИВАНИЕ ---
        if (!isLocalFile) {
            const args = ["-i", track.link, "-f", "opus", tmp];
            this.applyProxy(args, track);

            return new Promise((resolve) => {
                const ffmpeg = new Process(args);

                const timeout = setTimeout(() => {
                    ffmpeg.destroy();
                    fail();
                }, 60_000);

                const fail = async () => {
                    clearTimeout(timeout);
                    ffmpeg.destroy();
                    await afs.rm(tmp, { force: true }).catch(() => {});
                    resolve(false);
                };

                ffmpeg.stdout.once("error", fail);
                ffmpeg.stdout.once("end", async () => {
                    clearTimeout(timeout);
                    try {
                        const stat = await afs.stat(tmp);
                        if (stat.size < 1024) return fail();

                        await afs.rename(tmp, targetFile);
                        Logger.log("DEBUG", `[AudioSaver/Success]: ${track.ID}`);

                        if (similarPath) {
                            setImmediate(async () => {
                                // Теперь в track.link путь к реально существующему файлу
                                track.link = targetFile;
                                await this.symlink(track);
                            });
                        }

                        resolve(true);
                    } catch {
                        fail();
                    } finally {
                        ffmpeg.destroy();
                    }
                });
            });
        }
        return false;
    };

    /**
     * @description Создание ссылок на аудио
     * @param track
     * @public
     */
    public symlink = async (track: Track) => {
        const similarPath = (track as any).similarTrackPath;
        const isLocalFile = track.link.startsWith("/") || track.link.includes(":\\");

        // --- ЛИНКОВКА (Второй проход или локальный файл) ---
        if (similarPath && isLocalFile) {
            try {
                // Путь ссылки (path)
                const linkPath = similarPath;
                // На что ссылаемся (target)
                const target = track.link;

                // Не позволяем линковать одно и тоже
                if (linkPath === target) return false;

                await afs.mkdir(path.dirname(linkPath), { recursive: true }).catch(() => {});
                await afs.rm(linkPath, { force: true }).catch(() => {});

                // symlink(цель, путь_ссылки)
                await afs.symlink(target, linkPath);

                Logger.log("DEBUG", `[AudioSaver/Link]: Linked \n${target} -> \n${linkPath}`);

                (track as any).similarTrackPath = null;
                return true;
            } catch (e: any) {
                Logger.log("DEBUG", `[AudioSaver/Link] Failed: ${e.message}`);
                return false;
            }
        }

        return false;
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     * @public
     */
    public status = async (track: Track | string) => {
        const basePath = typeof track === "string"
            ? `${this._dirname}/Audio/${track}`
            : `${this._dirname}/Audio/${track.api.url}/${track.ID}`;
        const file = basePath + '.opus';
        const tmp  = file + '.tmp';
        const dir  = path.dirname(file);

        try {
            const entries = await afs.readdir(dir);
            if (entries.includes(path.basename(file))) return { status: 'ended', path: file };
            if (entries.includes(path.basename(tmp)))  return { status: 'download', path: file };
            return { status: 'not-ended', path: file };
        } catch {
            return { status: 'not-ended', path: file };
        }
    };

    /**
     * @description Применение прокси для FFmpeg
     * @param args - Текущие аргументы
     * @param track - Трек
     * @private
     */
    private applyProxy(args: string[], track: Track) {
        if (!track.proxy || !track.link.startsWith("http")) return;
        const proxy = env.get("APIs.proxy", null);
        if (proxy) {
            args.unshift("-http_proxy", `http:/${proxy.split(":/")[1]}`);
        }
    };
}