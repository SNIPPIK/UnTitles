[<img align="center" alt="Woman" width="" src=".github/images/woman.png" />]()

# 🌟 Discord Music Bot
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS (идеи и предложения)`](https://github.com/GHOST-OF-THE-ABYSS)
- Все работает без Lavalink, Lavaplayer. Это невероятно?!
- Возможны ошибки или недочеты, просим сообщать о них, в [`issues`](https://github.com/SNIPPIK/UnTitles/issues)
- Мы не может запускать бота на постоянной основе. По-этому он может быть не доступен!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)
[![Donate](https://img.shields.io/badge/Donate-DonationAlerts-orange?style=for-the-badge&logo=donationalerts)](https://www.donationalerts.com/r/snippik)
![](https://codecov.io/gh/SNIPPIK/Untitles)

> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!

> [!IMPORTANT]
> Если нет ответа от youtube устанавливаем `ytdlp-nodejs`, в таком случае настоятельно рекомендуется включить кеширование

---

# 🎧 Основные возможности
#### Голосовой движок
- Собственная реализация [Voice Gateway Version 8](https://discord.com/developers/docs/topics/voice-connections) (WebSocket + UDP + RTP + Opus)
- Адаптивная система отправки пакетов, можно выбрать сколько пакетов отправлять!
- Поддержка плавного перехода между треками с `audiofade`
- Горячая смена аудио без прерываний
- Поддержка 14+ фильтров с возможностью добавлять свои
- Кэширование в памяти или в файлы для оптимизации
- Есть поддержка длинных видео, Live видео!
#### Мультиплатформенность и масштабируемость
- Поддержка YouTube, Spotify, VK, Yandex-Music
- Платформы работают в отдельных воркерах для производительности
- Легкое расширение и добавление новых платформ через API
#### Локализация
- Доступные языки: `English`, `Русский` ([файл с языками](src/services/locale/languages.json)).

---

## 🎛 UI
- Полностью динамические кнопки, адаптирующиеся к текущему состоянию плеера (например, фильтры, пауза/продолжить, скип и т.д.)
- Поддержка прогресса трека (визуальная шкала и временные метки)
- Обратная связь мгновенна и понятна: не нужны slash команды повторно, всё доступно в одном сообщении

#### Команды
| Команда | Autocomplete | Аргументы                               | Описание                                       | 
|---------|--------------|-----------------------------------------|------------------------------------------------|
| /api    | ❌            | access:(block, unblock)                 | Управление API системы бота                    |
| /bot    | ❌            | restart:(commands, bot, events)         | Управление ботом                               |
| /filter | ❌            | (off, push, disable)                    | Управление аудио фильтрами                     |
| /play   | ✅            | (api, replay, stop, wave)               | Воспроизведение музыки и поиск                 |
| /remove | ✅            | value                                   | Удаление трека из очереди (без восстановления) | 
| /seek   | ❌            | 00:00, int                              | Перемотка трека                                |
| /skip   | ✅            | (back, to, next)                        | Управление позицией трека                      |
| /avatar | ✅            | {user}                                  | Просмотр аватара пользователя                  |
| /voice  | ❌            | (join, leave, tribune: (join, request)) | Голосовое взаимодействие                       |
---
## 🚀 Быстрый старт
- Требуется `Node.js`, `FFmpeg`
- Настраиваем `.env` файл по пути `build/.env`
- Пример запуска
```shell
# Клонируем
git clone https://github.com/SNIPPIK/UnTitles

# Запускаем через NodeJS
npm run build && npm run start
```
---

# 🔩 Требования к железу
- При 10 guilds (серверы)
- (ShardManager 20-40 Мб), (Shard - Worker + Main Process 70-90 мб)
- За каждую очередь, плеер, голосовое подключение (5-7 мб). Без учета добавленных треков
- Каждое live видео занимает 20-50 мб!

---
![TypeScript](https://img.shields.io/badge/typescript-5.8.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-14.9.3-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
![ws](https://img.shields.io/badge/ws-8.18.2-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
---

# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />]()