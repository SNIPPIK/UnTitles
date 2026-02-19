
<div align="center">
  <h1>🌟 Discord Music Bot 💫</h1>

<h4>Невероятный бот с собственным голосовым/аудио движком, масштабируемой архитектурой, множеством фильтров и поддержкой 6 музыкальных платформ.</h4>
<h4>Качество аудио превосходит lavalink и использует E2EE 🔐, не верите? Послушайте сами! Работает без просадок даже на ARM!</h4>

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

📢 Об ошибках и недочётах просим сообщать в [`Issues`](https://github.com/SNIPPIK/UnTitles/issues) или [`Discord`](https://discord.gg/qMf2Sv3)  
🚫 Бот не работает 24/7 — он может быть недоступен!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

> [!WARNING]
> ⚠️ WatKLOK (UnTitles) — это сложный технический проект, который поддерживается исключительно 1 автором `SNIPPIK`  
> Некорректное использование, удаление авторства или присвоение приведут к закрытию публичного репозитория   
> 
> Audio issues  
> Если ваш интернет не стабилен потери будут в любом случае.  
> Полностью устранить `packet lost` не возможно, из-за протокола `UDP` и прочих ограничений `discord`

> [!TIP]
> Рекомендую включить систему кэширования в `.env`, в таком случае можно включать треки даже при полной блокировке платформы  
> Но голосовой системе просто не дозволено терять аудио пакеты даже при критической нагрузке!

> [!WARNING]
> Если используется прокси, учитывайте что `FFmpeg` не поддерживает socks. Для таких задач есть [`STH`](https://github.com/SNIPPIK/SHS)  
> Что-то может не работать, если вы не правильно настроили!!! 
---

### ⚠️ Требования к железу | Данные с Ryzen 7 5700x3D | 1 плеер
- CPU: 0-0.1%
- RAM: `~80 MB`, все зависит от кол-ва треков, нагрузки на платформы, кеша discord!
- Disk: `~50 MB`, для кеширования хватает `200 GB` (1.5к треков ~1.2 GB)

---

# 🎧 Основные возможности
#### 🎖️ Особенности
- Устойчивость к зацикливанию событий, поэтому даже в этом случае звук воспроизводится плавно!!!
```ts
setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 60);

setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 80);

setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 120);

setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 100);
```
#### 🔊 Голосовой движок
- Реализация [**Voice Gateway Version 8**](https://discord.com/developers/docs/topics/voice-connections) [`(WebSocket + UDP + SRTP + Opus + Sodium)`](src/core/voice) + [**End-to-End Encryption (E2EE 🔐)**](https://discord.com/developers/docs/topics/voice-connections#endtoend-encryption-dave-protocol)
- Полная реализация **SRTP**: `aead_aes256_gcm`, `xchacha20_poly1305` (через библиотеки)
- Лучший аудио плеер по сравнению с **open source** решениями
- Не требует никаких opus encoders/decoders, имеет свой opus encoder по методу парсинга!
- Требуется **FFmpeg**, он отвечает за аудио и фильтры!
- Поддерживаются: Autoplay, Repeat, Shuffle, Replay и другие функции.
- Работает даже при сильном **event loop lag**!
#### 🎵 Аудио
- Есть возможность переиспользовать аудио без конвертации если оно длительностью менее 8 мин
- Плавный **fade-in/fade-out** переход между треками, даже при **skip**, **seek** и **тп**.
- Есть система плавного перехода от одного аудио к другому `Hot audio swap`
- 16+ фильтров, можно добавить свои без сложного копания в коде [**filters**](src/core/player/filters.json)
- Есть поддержка длинных видео, Live, пока сыровато.
- Присутствует явная синхронизация аудио потока, без аудио фильтров!
#### 🌐 Платформы
- Поддерживаются: `YouTube`, `Spotify`, `VK`, `Yandex-Music`, `SoundCloud`, `Deezer`
- Аудио: `YouTube`, `VK`, `Yandex-Music`, `SoundCloud`
- Есть поиск аудио на других платформах, даже если платформа не хочет отдавать аудио!
- Полностью `fallback` система, нет трека на 1 платформе найдется на другой!
- Есть поддержка `related`(**похожих треков**), включение похожих треков
- Платформы работают в отдельном **worker** (потоке) для лучшей производительности
- Все подробно расписано, есть примеры и куча интерфейсов для типизации
- Легкое расширение и добавление новых платформ через `Динамический загрузчик - Handler`
#### 🌍 Локализация
- Доступные языки: `English`, `Русский` ([**файл с языками**](src/structures/locale/languages.json))
- Можно добавить любой язык поддерживаемый discord

---

## 🎛 Интерфейс
- Интерактивные кнопки: действия зависят от состояния плеера
- Поддержка прогресс-бара с тайм-кодами
- Отзывчивый UI — не требует повторного использования команд

#### 📚 Команды
|   Команда | Autocomplete | Аргументы                       | Описание                 |
|----------:|:-------------|:--------------------------------|:-------------------------|
| `/filter` | ✅            | (off, push, disable)            | Аудио-фильтры            |
|   `/play` | ✅            | (query)                         | Проигрывание             |
| `/player` | ✅            | (api, replay, stop, related)    | Расширенное проигрывание |
| `/volume` | ✅            | value                           | Громкость плеера         |
| `/remove` | ✅            | value                           | Удаление трека           |
|   `/seek` | ❌            | 00:00, int                      | Перемотка времени трека  |
|   `/skip` | ✅            | (back, to, next)                | Пропуск треков           |
| `/repeat` | ✅            | type                            | Тип повтора              |
|  `/queue` | ✅            | {destroy, list}                 | Управление очередью      |
|  `/voice` | ✅            | (join, leave, tribune)          | Голосовой канал          |

---
## 🚀 Быстрый старт
> Необходим Node.js, а также установленный FFmpeg  
> Все параметры прописаны в `.env`, не забудьте скопировать его в `.build` и настроить его под себя


> [!WARNING]
> Поскольку в проекте используется C++, потребуется компилятор. MSVC для Windows, CLANG для Linux, Mac или что-то другое.
```shell
# Клонируем
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Установка зависимостей
npm install

# Запуск через Node.js
# настройка переменных окружения в build/.env
npm run build && npm run configure && npm run start
```

---
<p>
    <a href="">
      <img src=".github/images/image.png" alt="Title" />
    </a>
</p>

[![TypeScript](https://img.shields.io/badge/typescript-5.9.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/en)
[![Seyfert](https://img.shields.io/badge/seyfert-4.1.0-%23CB3837.svg?style=for-the-badge&logo=seyfert&logoColor=white&color=purple)](https://www.seyfert.dev)
[![WS](https://img.shields.io/badge/ws-8.18.3-%23CB3837.svg?style=for-the-badge&logo=socket&logoColor=white)](https://www.npmjs.com/package/ws)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-7.*.*-%23CB3837.svg?style=for-the-badge&logo=ffmpeg&logoColor=white&color)](https://ffmpeg.org/)
---

# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)