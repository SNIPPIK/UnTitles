# UnTitles
- Авторы: [`SNIPPIK`](https://github.com/SNIPPIK), [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS)
- Работает на [`discord.js`](https://discord.js.org) - `v14`
- Если хочется поддержать монеткой [`DonationAlerts`](https://www.donationalerts.com/r/snippik)
- Есть идеи прошу в [`discussions`](https://github.com/SNIPPIK/UnTitles/discussions) | [`Discord`](https://discord.gg/qMf2Sv3)



> [!TIP]
> Сделано с душой, не забывайте указывать авторство от этого зависит разработка!!!\
> Если найдете ошибку, пожалуйста создайте запрос в [`issues`](https://github.com/SNIPPIK/UnTitles/issues) и объясните или заснимите как получить ошибку.\
> Это пожалуй, первый музыкальный бот, который не копирует других, а представляет что-то новое и свое.\
> Много чего было позаимствовано из более старого моего проекта! by WatKLOK\
> Работает на FFmpeg, конвертация происходит в ogg/opus\
> Поддерживает систему кеширования, ее желательно включить для уменьшения запросов на платформы



> [!IMPORTANT]
> Конвертация происходит в opus, есть поддержка библиотек, так-же присутствует [`нативная`](src/services/voice/audio/opus.ts)\
> Поддерживает следующие библиотеки `opusscript`, `mediaplex`, `@evan/opus`\
> Голосовая составляющая была позаимствована из `@discordjs/voice` с модификациями и удалением ненужного мусора\
> (Для РФ) В связи с действиями РКН, голосовые пакеты будут с каким-то шансом пропадать только при обходе!!!



> [!CAUTION]
> Здесь еще присутствует очень много ошибок, используйте код на свой страх и риск\
> Многие функции находятся на стадии полировки



> [!CAUTION]
> Возможно сменить [`Sodium`](src/services/voice/audio/sodium.ts), на выбор есть `sodium-native`, `libsodium-wrappers`\
> Не забываем про `.env` файл, есть заготовка в виде `.env.example`\
> Необходимо установить ffmpeg


## Диаграмма всего проекта
[<img align="center" alt="Diagram" width="" src="diagram.png" />]()