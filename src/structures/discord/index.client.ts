import { Client, GatewayActivityUpdateData, LimitedCollection, LimitedMemoryAdapter } from "seyfert";
import { middlewares } from "#handler/middlewares/index.js";
import { ActivityType } from "seyfert/lib/types/index.js";
import { env } from "#db/env";
import { db } from "#db";

/**
 * Реализация Discord-клиента на базе Seyfert.
 * Расширяет стандартный `Client`, добавляя:
 * - коллекцию кулдаунов для команд;
 * - кастомную конфигурацию команд, middleware, кэша и статусов;
 * - методы для запуска, управления статусами и парсинга статусов из переменных окружения.
 */
export class DiscordClient extends Client {
    /**
     * Коллекция для хранения временных меток кулдаунов.
     * Ключ — строка (обычно идентификатор пользователя/команды), значение — время последнего использования.
     * Используется middleware `checkCooldown`.
     */
    public readonly cooldowns: LimitedCollection<string, number> = new LimitedCollection();

    /**
     * Создаёт экземпляр клиента, конфигурируя:
     * - команды (префиксные и отложенный ответ);
     * - глобальные middleware (`checkCooldown`);
     * - разрешённые упоминания (только роли, без ответа автору).
     */
    public constructor() {
        super({
            commands: {
                // Префикс: либо ".w", либо упоминание бота.
                prefix: (msg) => {
                    return ['.w', `<@${msg.client.me.id}>`];
                },
                // Ответ при отложенной команде (defer), если не было ответа.
                deferReplyResponse: () => ({
                    content: `${db.emoji.loading} **${this.me.username}** lost context`,
                })
            },
            globalMiddlewares: ["checkVerifications", "checkCooldown"],
            allowedMentions: {
                replied_user: false,
                parse: ["roles"]
            }
        });
    }

    /**
     * Запускает клиент с предварительной настройкой сервисов:
     * - регистрирует middleware и языковые алиасы;
     * - настраивает ограниченное кэширование (presence, message);
     * - отключает кэш ненужных сущностей (bans, emojis, stickers, roles, presences, stageInstances);
     * - фильтрует кэш сообщений: остаются только сообщения бота;
     * - после старта загружает команды из файла `commands.json`.
     */
    public run = async () => {
        // Настройка сервисов Seyfert.
        this.setServices({
            middlewares: middlewares,
            langs: {
                aliases: {
                    "en-US": ["en-GB"],
                    "es-419": ["es-ES"],
                }
            },
            cache: {
                // Ограниченный адаптер кэша с истечением для presence и message.
                adapter: new LimitedMemoryAdapter({
                    presence: {
                        expire: 1e3 * 60,
                        limit: 5,
                    },
                    message: {
                        expire: (1e3 * 60) * 2,
                        limit: 10,
                    }
                }),
                // Отключаем кэши, которые не нужны.
                disabledCache: {
                    bans: true,
                    emojis: true,
                    stickers: true,
                    roles: true,
                    presences: true,
                    stageInstances: true,
                }
            }
        });

        // Если кэш сообщений включён, оставляем только сообщения бота.
        if (this.cache.messages) {
            this.cache.messages.filter = (message) => message.author.id === this.botId;
        }

        // Запуск подключения к Discord.
        await this.start();

        // Загрузка слэш-команд (кэшируется в commands.json).
        await this.uploadCommands({ cachePath: "./commands.json" }).catch((err) => {
            this.logger.error(`Failed to upload commands: ${err.message}`);
        });
    };

    /**
     * Перезагружает все динамические модули: события, команды, языки,
     * затем повторно выгружает команды на Discord API.
     *
     * @returns {Promise<void>} Промис, разрешающийся при успешной перезагрузке.
     */
    public async reload(): Promise<void> {
        // Логируем начало перезагрузки.
        this.logger.warn("[Client] Reload started");

        try {
            // Перезагружаем обработчики событий.
            await this.events.reloadAll();
            // Перезагружаем команды.
            await this.commands.reloadAll();
            // Перезагружаем языковые пакеты.
            await this.langs.reloadAll();
            // Повторно выгружаем команды (обновляем кэш-файл).
            await this.uploadCommands({ cachePath: "./commands.json" });

            // Уведомляем об успешном завершении.
            this.logger.info("[Client] Reload completed");
        } catch (error) {
            // Логируем ошибку и пробрасываем её выше.
            this.logger.error(`[Client] Reload failed | error: ${error}`);
            throw error;
        }
    };

    /**
     * Запускает периодическое обновление статуса бота.
     * Использует рекурсивный `setTimeout`, чтобы избежать наложения вызовов.
     * Интервал и частота перечитки статусов задаются через переменные окружения.
     *
     * Запускается в `queueMicrotask`, чтобы не блокировать инициализацию.
     */
    public startIntervalStatuses = () => queueMicrotask(() => {
        // Читаем интервал обновления (сек -> мс).
        const timeoutMs = parseInt(env.get("client.presence.interval", "120")) * 1e3;
        // Интервал перечитывания массива статусов из env.
        const arrayUpdateMs = parseInt(env.get("client.presence.array.update", "3600")) * 1e3;
        // Статус бота (online, idle, dnd, invisible).
        const botStatus = env.get("client.status", "online") as any;

        let array = this.parseStatuses();
        let i = 0;
        let lastUpdateDate = Date.now();

        // Если нет ни одного статуса, выходим.
        if (!array.length) return;

        // Рекурсивная функция обновления присутствия.
        const updatePresence = () => {
            try {
                // Перечитываем статусы, если прошло больше arrayUpdateMs.
                if (Date.now() - lastUpdateDate > arrayUpdateMs) {
                    array = this.parseStatuses();
                    lastUpdateDate = Date.now();
                }

                // Сброс индекса при достижении конца массива.
                if (i >= array.length) i = 0;

                const activity = array[i];

                // Устанавливаем присутствие.
                this.gateway.setPresence({
                    afk: false,
                    since: Date.now(),
                    status: botStatus,
                    activities: [activity]
                });

                i++;
            } catch (error) {
                console.error("[PresenceUpdate]: Failed to set presence:", error);
            } finally {
                // Планируем следующий запуск независимо от ошибки.
                setTimeout(updatePresence, timeoutMs);
            }
        };

        // Запускаем первый цикл.
        updatePresence();
    });

    /**
     * Парсит статусы из переменной окружения `client.presence.array`.
     * Ожидает JSON-массив объектов, каждый с полями `name` и `type`.
     * В `name` подставляются плейсхолдеры: `{shard}`, `{queues}`, `{players}`, `{messages}`, `{version}`, `{guilds}`, `{users}`.
     *
     * @returns Массив объектов `GatewayActivityUpdateData` для установки активностей.
     */
    private parseStatuses = (): GatewayActivityUpdateData[] => {
        const statuses: GatewayActivityUpdateData[] = [];
        const guilds = this.cache.guilds!.count();
        const users = this.cache.users!.count();

        // Получаем и обрабатываем пользовательские статусы.
        try {
            const envPresents = (JSON.parse(`[${env.get("client.presence.array")}]`) as GatewayActivityUpdateData[]).map((status) => {
                // Заменяем плейсхолдеры в имени статуса.
                const edited = status.name
                    .replace(/{shard}/g, `${this.gateway.size}`)
                    .replace(/{queues}}/g, `${db.queues.size}`)
                    .replace(/{players}/g, `${db.queues.cycles.players.size}`)
                    .replace(/{messages}/g, `${db.queues.cycles.messages.size}`)
                    .replace(/{version}/g, "0.5.0")
                    .replace(/{guilds}/g, `${guilds}`)
                    .replace(/{users}/g, `${users}`)

                return {
                    name: edited,
                    type: ActivityType[status.type] as any
                }
            });

            // Добавляем все полученные статусы.
            statuses.push(...envPresents);
        } catch (e) {
            // Логируем ошибку парсинга статусов.
            this.logger.error(`[Client/Status] Failed to parse env statuses. ${e}`);
        }

        return statuses;
    };
}