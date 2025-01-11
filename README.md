# UnTitles
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS)
- Основано на [`discord.js`](https://discord.js.org) - `v14`
- Если хочется поддержать монеткой [`DonationAlerts`](https://www.donationalerts.com/r/snippik)


> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!\
> Если найдете ошибку, пожалуйста создайте запрос в [`issues`](https://github.com/SNIPPIK/UnTitles/issues) и объясните или заснимите как получить ошибку.\
> Это пожалуй, первый музыкальный бот, который не копирует других, а представляет что-то новое и свое.\
> Много чего было позаимствовано из более старого моего проекта! by WatKLOK\
> Работает на FFmpeg, конвертация происходит в ogg/opus\
> Поддерживает систему кеширования, ее желательно включить для уменьшения запросов на платформы



> [!IMPORTANT]
> Конвертация происходит в opus, есть поддержка библиотек, так-же присутствует [`нативная`](src/dependencies/voice/audio/Opus.ts)\
> Поддерживает следующие библиотеки `opusscript`, `mediaplex`, `@evan/opus`\
> Голосовая составляющая была позаимствована из `@discordjs/voice` с модификациями и удалением ненужного мусора



> [!CAUTION]
> Здесь еще присутствует очень много ошибок, используйте код на свой страх и риск\
> Многие функции находятся на стадии полировки



> [!CAUTION]
> Возможно сменить [`Sodium`](src/dependencies/voice/audio/Sodium.ts), на выбор есть `sodium-native`, `libsodium-wrappers`\
> Не забываем про `.env` файл, есть заготовка в виде `.env.example`\
> Необходимо установить ffmpeg



## Todo list
- Здесь будут время от времени как добавляться таски так и завершаться
- Есть идеи прошу в [`discussions`](https://github.com/SNIPPIK/UnTitles/discussions)
```text
                                             --= Выполнено =--
[V] Новый плеер с плавным переходом аудио
    - Улучшено взаимодействие с аудио
    - Треки хранятся в своем классе
    - Взаимодействие с гс теперь имеет свой класс
    - Фильтры управляются через класс
    - Новый VoiceStateUpdate
    - Добавить систему фильтров
[V] Улучшение голосового состояния
    - Упрощение многих функций
    - Значительное снижение потерь пакетов
    - Добавление комментариев под каждый фрагмент кода
[V] Новая система очереди
    - Хранение треков перешло к плееру
    - Треки теперь не удаляются а хранятся до удаления очереди
    - Переработка классов Song, теперь Track
[V] Улучшенное взаимодействие с аудио
    - Добавлены состояния after, before для некоторых действий для избежания ошибок потока
    - Отслеживание ffmpeg
[V] Управление меню перенесено в InteractionCreate
    - Управление кнопками перешло в отдельный класс
    - Добавление новых кнопок для плеера
    - Добавить ограничение на ввод команд (cooldown)
    - Добавление системы whitelist
[V] Улучшение системы перевода
    - Упрощение переводов, первый в списке будет применен к отсутствующим переводам
    - Авто исправление некоторых данных под реалии discord
[V] Команды (Utils, Musics, Owners, Voices)
    - Обновление структуры команд, под новые реалии переводов
    - skip, remove, play, filter, voice (leave, re-configure), avatar, seek
[V] Добавить env файл
[V] Новый logger, модификация старого от WatKLOK
[V] Система кеширования (аудио в виде файлов, данных пока в памяти)
[V] Доработать функционал кнопок
[V] Доделать визуал кнопок
[V] Система lyrics (текст для песни)
```
