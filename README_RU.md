
<div align="center">
  <h1>🌟 Discord Music Bot</h1>

<h4>Невероятный бот с собственным голосовым/аудио движком, масштабируемой архитектурой, множеством фильтров и поддержкой 6 музыкальных платформ.  </h4>
<h4>Качество аудио превосходит lavalink, не верите? Послушайте сами! Работает без просадок даже на ARM!</h4>

  <p>
    <a href="./README.md">
      English
    </a>
    |
    Русский
  </p>

  <p>
    <a href="">
      <img src=".github/images/woman.png" alt="Title" />
    </a>
  </p>

<p>
    <a href="LICENSE.md">
      <img src="https://img.shields.io/badge/License-BSD3-green?style=for-the-badge" alt="License" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/releases/latest">
      <img src="https://img.shields.io/github/v/release/SNIPPIK/Untitles?logo=git&style=for-the-badge&include_prereleases&label=Release" alt="Latest release" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/releases">
      <img src="https://img.shields.io/github/downloads/SNIPPIK/Untitles/total?logo=github&style=for-the-badge&label=Downloads" alt="All downloads" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/graphs/contributors">
      <img src="https://img.shields.io/github/contributors/SNIPPIK/Untitles.svg?logo=github&style=for-the-badge&label=Contributors" alt="All Contributors" />
    </a>
  </p>
</div>

---

## 👥 Авторы

- 👤 [`SNIPPIK`](https://github.com/SNIPPIK)
- 💡 [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS) — идеи и предложения

📢 Об ошибках и недочётах просим сообщать в [Issues](https://github.com/SNIPPIK/UnTitles/issues)  
🚫 Бот не работает 24/7 — он может быть недоступен!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

> [!WARNING]  
> ⚠️ WatKLOK (UnTitles) — это сложный технический проект, который поддерживается исключительно 1 автором `SNIPPIK`  
> Некорректное использование, удаление авторства или присвоение приведут к закрытию публичного репозитория


> [!IMPORTANT]  
> Если нет ответа от YouTube — установите `ytdlp-nodejs`. Настоятельно рекомендуется включить кеширование  
> `main` — стабильная, но редко обновляемая ветка  
> `beta` — новейшие фиксы и функции, может быть нестабильной

---

### ⚠️ Требования к железу | Данные с Ryzen 7 5700x3D | 1 плеер
- CPU: 0-0.1%
- Ram: ~80 MB, все зависит от кол-ва треков, нагрузки на платформы, а именно youtube!
- Disk: ~50 MB, для кеширования хватает 200 GB (1.5к треков ~1.2 GB)

---

# 🎧 Основные возможности
#### 🎖️ Особенности
- Не боится цикла событий, даже в таком случаем звук идет плавно!!!
```ts
setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 200);
```
#### 🔊 Голосовой движок
- Реализация [Voice Gateway Version 8](https://discord.com/developers/docs/topics/voice-connections) [`(WebSocket + UDP + SRTP + Opus + Sodium)`](src/core/voice) + [End-to-End Encryption (DAVE Protocol)](https://discord.com/developers/docs/topics/voice-connections#endtoend-encryption-dave-protocol)
- Полная реализация **SRTP**: `aead_aes256_gcm`, `xchacha20_poly1305` (через библиотеки)
- Не требует никаких opus encoders/decoders, имеет свой opus encoder по методу парсинга!
- Адаптивная система отправки аудио пакетов, свой `Jitter Buffer`!
- Требуется **FFmpeg**, он отвечает за аудио и фильтры!
- Поддерживаются: Autoplay, Repeat, Shuffle, Replay и другие функции.
- Работает даже при сильном **event loop lag**!
#### 🎵 Аудио
- Есть возможность переиспользовать аудио без конвертации если оно длительностью менее 8 мин
- Плавный **fade-in/fade-out** переход между треками, даже при **skip**, **seek** и **тп**.
- Есть система плавного перехода от одного аудио к другому `Hot audio swap`
- 16+ фильтров, можно добавить свои без сложного копания в коде [filters](src/core/player/filters.json)
- Есть поддержка длинных видео, Live видео пока сыровато.
- Присутствует явная синхронизация аудио потока
#### 🌐 Платформы
- Поддерживаются: `YouTube`, `Spotify`, `VK`, `Yandex-Music`, `SoundCloud`, `Deezer`
- Аудио: `YouTube`, `VK`, `Yandex-Music` **(MP3 + Lossless)**, `SoundCloud`
- Точный поиск при отсутствии аудио, через время и названия по слогам
- Есть поиск на других платформах при отсутствии аудио!
- Есть поддержка `related`(**похожих треков**), включение похожих треков
- Платформы работают в отдельном **worker** (потоке) для производительности
- Все подробно расписано, есть примеры и куча интерфейсов для типизации
- Легкое расширение и добавление новых платформ через `Динамический загрузчик - Handler`
#### 🌍 Локализация
- Доступные языки: `English`, `Русский` ([файл с языками](src/structures/locale/languages.json))
- Можно добавить любой язык поддерживаемый discord

---

# 🔩 Прочий функционал
#### Своя система [handlers](src/handlers)
- Универсальный загрузчик: [`commands`](src/handlers/commands), [`events`](src/handlers/events), [`components`](src/handlers/components), [`middlewares`](src/handlers/middlewares), [`rest`](src/handlers/rest)
- Свой framework для команд, кнопок, селекторов меню, событий
- Используются декораторы и интерфейсы, включая типизацию
- Поддержка "горячей" перезагрузки

#### 💡 Адаптивный цикл
- Не боится **event loop** и **drift**, он просто учитывает их не как проблему, а как параметры!
- Цикл может срабатывать на опережение от 0 до 2 ms для обработки объектов в цикле!
- Аудио отправка построена именно на нем!
- Точность цикла `±0.05 ms` при `Date.now` + `performance.now`

#### ⚙️ Внутренние инструменты
- [`SetArray`](src/structures/tools/SetArray.ts) - 2 в одном Array и Set в один класс
- [`Cycle`](src/structures/tools/Cycle.ts) - Управляет системой обновления сообщений и отправкой аудио пакетов
- [`TypedEmitter`](src/structures/tools/TypedEmitter.ts) - типизированный `EventEmitterAsyncResource`
- [`SimpleWorker`](src/structures/tools/SimpleWorker.ts) - Класс для работы с потоками

---

## 🎛 Интерфейс
- Интерактивные кнопки: действия зависят от состояния плеера
- Поддержка прогресс-бара с тайм-кодами
- Отзывчивый UI — не требует повторного использования команд

#### 📚 Команды
|   Команда | Autocomplete | Аргументы                       | Описание                 |
|----------:|:-------------|:--------------------------------|:-------------------------|
|    `/api` | ❌            | access:(block, unblock)         | Управление API           |
|    `/bot` | ❌            | restart:(commands, bot, events) | Перезапуск               |
| `/filter` | ✅            | (off, push, disable)            | Аудио-фильтры            |
|   `/play` | ✅            | (query)                         | Проигрывание             |
| `/player` | ✅            | (api, replay, stop, related)    | Расширенное проигрывание |
| `/volume` | ✅            | value                           | Громкость плеера         |
| `/remove` | ✅            | value                           | Удаление трека           |
|   `/seek` | ❌            | 00:00, int                      | Перемотка времени трека  |
|   `/skip` | ✅            | (back, to, next)                | Пропуск треков           |
|  `/queue` | ✅            | {destroy, list}                 | Управление очередью      |
| `/avatar` | ✅            | {user}                          | Аватар пользователя      |
|  `/voice` | ✅            | (join, leave, tribune)          | Голосовой канал          |
| `/report` | ❌            | (none)                          | Связь с разработчиком    |

---
## 🚀 Быстрый старт
> Необходимы Node.js или Bun, а также установленный FFmpeg  
> Вся конфигурация прописана в `.env`
```shell
# Клонируем
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Установка зависимостей
npm install

# Запуск через Node.js
# настройка переменных окружения в build/.env
npm run build && npm run start

# Запуск через Bun (пока не работает)
# настройка переменных окружения в ./env
npm i dotenv
bun run start-bun
```

---
[![TypeScript](https://img.shields.io/badge/typescript-5.9.2-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/bun-1.2.25-6DA55F?style=for-the-badge&logo=bun&logoColor=white&color=white)](https://bun.com/)
[![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/en)
[![Discord.js](https://img.shields.io/badge/discord.js-14.22-%23CB3837.svg?style=for-the-badge&logo=discord.js&logoColor=white&color=purple)](https://discord.js.org/)
[![WS](https://img.shields.io/badge/ws-8.18.3-%23CB3837.svg?style=for-the-badge&logo=socket&logoColor=white)](https://www.npmjs.com/package/ws)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-7.*.*-%23CB3837.svg?style=for-the-badge&logo=ffmpeg&logoColor=white&color)](https://ffmpeg.org/)
---

# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)