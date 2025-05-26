# Discord Music Bot (UnTitles)
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS)
- Если хочется поддержать монеткой [`DonationAlerts`](https://www.donationalerts.com/r/snippik)
- Есть идеи прошу в [`discussions`](https://github.com/SNIPPIK/UnTitles/discussions) или на [`Discord Server`](https://discord.gg/qMf2Sv3)

> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!\
> Если найдете ошибку, пожалуйста создайте запрос в [`issues`](https://github.com/SNIPPIK/UnTitles/issues)

> [!IMPORTANT]
> Если нет ответа от youtube устанавливаем `ytdlp-nodejs`, в таком случае рекомендуется включения кеширования\
---

## Доступный функционал
- Используется [`Voice Gateway Version 8`](https://discord.com/developers/docs/topics/voice-connections)
- Доступные языки из коробки `English`, `Русский` | [`тут`](src/services/locale/languages.json) и в [`commands`](src/handlers/commands)
- Горячая подмена трека / seek / фильтров — сделано на уровне потоков, без глитчей.
- Fade на замене, но не через фильтр, а через подмену потока.
- Система кеширования (audio, tracks), ее желательно включить для уменьшения запросов на платформы и в случае поломки вы сможете включать трек из кеша
---
## Платформы
- Поддержка `YouTube`, `Spotify`, `VK`, `Yandex-Music`
- Вся реализация платформ работает через `Worker threads`
---
### Команды
- Есть система декораторов для упрощения написания команд

| Команда | Аргументы                               | Описание                                                    | 
|---------|-----------------------------------------|-------------------------------------------------------------|
| /api    | access:(block, unblock)                 | **Управление системой APIs внутри бота**                    |
| /bot    | restart:(commands, bot, events)         | **Управление ботом**                                        |
| /filter | (off, push, disable)                    | **Управление фильтрами аудио**                              |
| /play   | (api, replay, stop)                     | **Включение музыки, поиск, так-же прочие утилиты**          |
| /remove | value                                   | **Удаление трека из очереди, без возможности восстановить** | 
| /seek   | 00:00, int                              | **Переход к конкретному времени трека**                     |
| /skip   | (back, to, next)                        | **Универсальная команда для управления позицией трека**     |
| /avatar | {user}                                  | **Для просмотра аватара пользователя**                      |
| /voice  | (join, leave, tribune: (join, request)) | **Взаимодействие с голосовыми подключениями**               |
---
### Сообщения
- Динамическое сообщение о текущем треке
  - Эти функции есть в плеере и они работают в сообщении о текущем треке
    - `replay`, `shuffle`, `queue`, `lyrics`, `repeat (off, on, track)`, `pause/resume`, `stop`
![img_1.png](.github/images/playing.png)
---

## И как это запустить?!
- Требуется Node.js или Bun, не забываем про FFmpeg
- Настраиваем env файл
    - Для Bun он будет в текущей директории
    - Для Node.js в build/.env
- Пример запуска
```shell
git clone https://github.com/SNIPPIK/UnTitles

# Bun
npm run start-new

# NodeJS
npm run build && npm run start
```

## Диаграмма всего проекта
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />]()