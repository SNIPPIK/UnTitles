
<p align="center">
  <img alt="Woman" src=".github/images/woman.png" width="1200" />
</p>

# 🌟 Discord Music Bot

> Мощный бот с собственным голосовым движком, масштабируемой архитектурой, множеством фильтров и поддержкой нескольких музыкальных платформ.

---

## 👥 Авторы

- 👤 [`SNIPPIK`](https://github.com/SNIPPIK)
- 💡 [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS) — идеи и предложения

📢 Об ошибках и недочётах просим сообщать в [Issues](https://github.com/SNIPPIK/UnTitles/issues)  
🚫 Бот не работает 24/7 — он может быть недоступен!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)
[![Donate](https://img.shields.io/badge/Donate-DonationAlerts-orange?style=for-the-badge&logo=donationalerts)](https://www.donationalerts.com/r/snippik)

> [!IMPORTANT]  
> Если нет ответа от YouTube — установите `ytdlp-nodejs`. Настоятельно рекомендуется включить кеширование.  
> `main` — стабильная, но редко обновляемая ветка.  
> `beta` — новейшие фиксы и функции, может быть нестабильной.

---

# 🎧 Основные возможности
#### 🔊 Голосовой движок
- Собственная реализация [Voice Gateway Version 8](https://discord.com/developers/docs/topics/voice-connections) [`(WebSocket + UDP + SRTP + Opus + Sodium)`](src/services/voice)
- WebSocket поддерживает 18+ Discord Voice OpCode
- Полная реализация SRTP: `aead_aes256_gcm`, `xchacha20_poly1305` (через библиотеки)
- Система адаптивной отправки аудио пакетов, подстраивается под нагрузку
- Циклическая отправка аудио: drift ~`0.003ms`
- Работа с OGG/Opus напрямую: без лишней перекодировки
#### 🎵 Аудио
- Использует `OGG/Opus` формат для аудио
- Есть возможность переиспользовать аудио без конвертации если оно длительностью менее 8 мин
- Максимальное качество аудио, без потерь!
- Горячая смена аудио без прерываний
- Плавный fade-in/fade-out переход
- 16+ фильтров, можно добавить свои
- Есть поддержка длинных видео, Live видео пока сыровато.
#### 🌐 Платформы
- Поддержка YouTube, Spotify, VK, Yandex-Music, SoundCloud
- Платформы работают в отдельном воркере (потоке) для производительности
- Все подробно расписано, есть примеры и куча интерфейсов для типизации
- Легкое расширение и добавление новых платформ через `Dynamic Loader - Handler`
#### 🌍 Локализация
- Доступные языки: `English`, `Русский` ([файл с языками](src/services/locale/languages.json))
- Можно добавить любой язык поддерживаемый discord
---
# 🔩 Прочий функционал
#### Handler - загрузчик
- Универсальный загрузчик: [`commands`](src/handlers/commands), [`events`](src/handlers/events), [`components`](src/handlers/components), [`middlewares`](src/handlers/middlewares), [`rest`](src/handlers/rest)
- Поддержка "горячей" перезагрузки

#### Своя система [handlers](src/handlers)
- Используются декораторы и интерфейсы, включая типизацию
- Есть поддержка Options, Autocomplete

#### ⚙️ Внутренние инструменты
- [`SetArray`](src/structures/tools/SetArray.ts) - Обьединение Array и Set в один класс
- [`Cycle`](src/structures/tools/Cycle.ts) - Управляет системой обновления сообщений и отправкой аудио пакетов
- [`TypedEmitter`](src/structures/tools/TypedEmitter.ts) - типизированный `EventEmitterAsyncResource`
---

## 🎛 Интерфейс
- Интерактивные кнопки: действия зависят от состояния плеера
- Поддержка прогресс-бара с таймкодами
- Отзывчивый UI — не требует повторного использования команд

#### 📚 Команды
|   Команда | Autocomplete | Аргументы                       | Описание            |
|----------:|:-------------|:--------------------------------|:--------------------|
|    `/api` | ❌            | access:(block, unblock)         | Управление API      |
|    `/bot` | ❌            | restart:(commands, bot, events) | Перезапуск          |
| `/filter` | ✅            | (off, push, disable)            | Аудио-фильтры       |
|   `/play` | ✅            | (api, replay, stop, wave)       | Проигрывание        |
| `/remove` | ✅            | value                           | Удаление трека      |
|   `/seek` | ❌            | 00:00, int                      | Перемотка           |
|   `/skip` | ✅            | (back, to, next)                | Пропуск             |
| `/avatar` | ✅            | {user}                          | Аватар пользователя |
|  `/voice` | ✅            | (join, leave, tribune)          | Голосовой канал     |

---
## 🚀 Быстрый старт
> Необходимы Node.js или Bun, а также установленный FFmpeg  
> Вся конфигурация прописана в `.env`
```shell
# Клонируем
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Запуск через Node.js
npm install
# настройка переменных окружения в build/.env
npm run build && npm run start

# Запуск через Bun
# настройка переменных окружения в ./env
bun install
bun run start-bun
```

---
![TypeScript](https://img.shields.io/badge/typescript-5.8.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/bun-1.2.15-6DA55F?style=for-the-badge&logo=bun&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-14.21-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
![undici](https://img.shields.io/badge/undici-7.11-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
---

# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />]()