[<img align="center" alt="Woman" width="" src=".github/images/woman.png" />]()

# 🌟 Discord Music Bot
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS (идеи и предложения)`](https://github.com/GHOST-OF-THE-ABYSS)
- Если хочется поддержать монеткой [`DonationAlerts`](https://www.donationalerts.com/r/snippik)
- Все работает без Lavalink, Lavaplayer. Это дает полный доступ и лучшее взаимодействие!
- Возможны ошибки или недочеты, просим сообщать о них, в [`issues`](https://github.com/SNIPPIK/UnTitles/issues)
- Мы не может запускать бота на постоянной основе. По-этому он может быть не доступен!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!

> [!IMPORTANT]
> Если нет ответа от youtube устанавливаем `ytdlp-nodejs`, в таком случае настоятельно рекомендуется включить кеширование


## 💡 И как это запустить?!
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
# 🔩 Доступный функционал

## Голосовой движок
- Используется [Voice Gateway Version 8](https://discord.com/developers/docs/topics/voice-connections) — собственная реализация.

## Локализация
- Доступные языки: `English`, `Русский` ([файл с языками](src/services/locale/languages.json)).

## Кэширование
- Система кэширования в памяти и в файлах. Включение рекомендовано для оптимизации.

## Аудио и проигрывание
- Плавный переход между треками с 2-секундной паузой.
- Поддержка 14 фильтров со возможностью добавления своих ([filters.json](src/services/player/filters.json)).
- Поиск трека с поддержкой автозаполнения.
- Управление очередью: `replay`, `shuffle`, `queue`, `lyrics`, `repeat (off, on, track)`, `pause/resume`.
- Динамические кнопки в сообщении текущего трека.

---

## 📥 Поддерживаемые платформы
- YouTube, Spotify, VK, Yandex-Music.
- Все реализовано через `Worker threads`.
- Легко добавить свою платформу благодаря динамическому подключению.

---

## 📌 Команды

| Команда | Autocomplete | Аргументы                               | Описание                                       | 
|---------|--------------|-----------------------------------------|------------------------------------------------|
| /api    | ❌            | access:(block, unblock)                 | Управление API системы бота                    |
| /bot    | ❌            | restart:(commands, bot, events)         | Управление ботом                               |
| /filter | ❌            | (off, push, disable)                    | Управление аудио фильтрами                     |
| /play   | ✅            | (api, replay, stop)                     | Воспроизведение музыки и поиск                 |
| /remove | ✅            | value                                   | Удаление трека из очереди (без восстановления) | 
| /seek   | ❌            | 00:00, int                              | Перемотка трека                                |
| /skip   | ✅            | (back, to, next)                        | Управление позицией трека                      |
| /avatar | ✅            | {user}                                  | Просмотр аватара пользователя                  |
| /voice  | ❌            | (join, leave, tribune: (join, request)) | Голосовое взаимодействие                       |
---
![TypeScript](https://img.shields.io/badge/typescript-5.8.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-14.9.3-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
![ws](https://img.shields.io/badge/ws-8.18.2-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
---
# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />]()