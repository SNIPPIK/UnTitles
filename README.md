# Discord Music Bot (UnTitles)
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS)
- Работает на [`discord.js`](https://discord.js.org) - `v14`
- Если хочется поддержать монеткой [`DonationAlerts`](https://www.donationalerts.com/r/snippik)
- Есть идеи прошу в [`discussions`](https://github.com/SNIPPIK/UnTitles/discussions) | [`Discord`](https://discord.gg/qMf2Sv3)
- По-умолчанию бот поддерживает Russian, English. Свой язык можно добавить [тут](src/services/locale/languages.json)


> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!\
> Если найдете ошибку, пожалуйста создайте запрос в [`issues`](https://github.com/SNIPPIK/UnTitles/issues)\
> Работает на FFmpeg, конвертация происходит в ogg/opus\
> Поддерживает систему кеширования, ее желательно включить для уменьшения запросов на платформы


> [!CAUTION]
> Все работает на ffmpeg, его необходимо установить!!!\
> Не забываем про `.env` файл, есть заготовка в виде `.env.example`\


> [!IMPORTANT]
> Есть поддержка [`opus`](src/services/voice/audio/opus.ts), [`sodium`](src/services/voice/audio/sodium.ts)\
> Голосовая составляющая была позаимствована из `@discordjs/voice` с модификациями и удалением ненужного мусора


### Доступные команды
| Команда  | Аргументы                   | Описание                                                    | 
|----------|-----------------------------|-------------------------------------------------------------|
| /api     | access:(block, unblock)     | **Управление системой APIs внутри бота**                    |
| /bot     | (restart)                   | **Управление ботом**                                        | 
| /filter  | (off, push, disable)        | **Управление фильтрами аудио**                              |
| /play    | (api, file, replay)         | **Включение музыки, или поиск**                             |
| /remove  | value                       | **Удаление трека из очереди, без возможности восстановить** | 
| /seek    | 00:00, int                  | **Переход к конкретному времени трека**                     |
| /skip    | (back, to, next)            | **Универсальная команда для управления позицией трека**     |
| /avatar  | {user}                      | **Для просмотра аватара пользователя**                      |
| /voice   | (join. leave, re-configure) | **Взаимодействие с голосовыми подключениями**               |
| /tribune | stage:(join, request)       | **Взаимодействие с подключением к трибуне**                 |


## Как запустить проект
1. Настраиваем `.env` файл в `./build`
- Запуск на node.js
    1. Установить `node.js` - `>=23` и `ffmpeg`
    2. Заходим в директорию проекта
    3. Открываем терминал 
    4. npm i && npm run start
- Есть вариант запустить проект через `bun`, очень не стабилен!!!
    1. Установить `bun` и `ffmpeg`
    2. Заходим в директорию проекта
    3. Открываем терминал
    4. bun install && npm run dev:bun:start


## Диаграмма всего проекта
[<img align="center" alt="Diagram" width="" src="diagram.png" />]()