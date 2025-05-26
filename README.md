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
- Используется [`Voice Gateway Version 8`](https://discord.com/developers/docs/topics/voice-connections), собственная реализация
- Доступные языки из коробки `English`, `Русский` | [`тут`](src/services/locale/languages.json) и в [`commands`](src/handlers/commands)
- Система кеширования как в памяти так и в виде файлов, опционально, но желательно включить
- Плавный переход от одного трека к другому, в конце проигрывания будет молчание на 2 сек
- Есть поддержка фильтров в размере 14 шт, можно добавить свои [`тут`](src/services/player/filters.json)
- Есть поддержка поиска трека в команде он же `autocomplete`
- Есть реализация `replay`, `shuffle`, `queue`, `lyrics`, `repeat (off, on, track)`, `pause/resume`. В сообщении о текущем треке, кнопки динамические!
## 📥 Платформы
- Поддержка `YouTube`, `Spotify`, `VK`, `Yandex-Music`
- Вся реализация платформ работает через `Worker threads`
- Поскольку все реализации являются динамическими, можно добавить свою реализацию без особых проблем
---
## 📌 Команды
- Есть система декораторов для упрощения написания команд

| Команда | `autocomplete` | Аргументы                               | Описание                                                    | 
|---------|----------------|-----------------------------------------|-------------------------------------------------------------|
| /api    | ⛔              | access:(block, unblock)                 | **Управление системой APIs внутри бота**                    |
| /bot    | ⛔              | restart:(commands, bot, events)         | **Управление ботом**                                        |
| /filter | ⛔              | (off, push, disable)                    | **Управление фильтрами аудио**                              |
| /play   | ✅              | (api, replay, stop)                     | **Включение музыки, поиск, так-же прочие утилиты**          |
| /remove | ✅              | value                                   | **Удаление трека из очереди, без возможности восстановить** | 
| /seek   | ⛔              | 00:00, int                              | **Переход к конкретному времени трека**                     |
| /skip   | ✅              | (back, to, next)                        | **Универсальная команда для управления позицией трека**     |
| /avatar | ✅              | {user}                                  | **Для просмотра аватара пользователя**                      |
| /voice  | ⛔              | (join, leave, tribune: (join, request)) | **Взаимодействие с голосовыми подключениями**               |
---
![TypeScript](https://img.shields.io/badge/typescript-5.8.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-14.9.3-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
![ws](https://img.shields.io/badge/ws-8.18.2-%23CB3837.svg?style=for-the-badge&logo=npm&logoColor=white)
---
# 📊 Диаграмма всего проекта
- Вдруг вам интересно как построен бот
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />]()