# UTDMB
## To do list
```css
Выполнено
[V] Добавить сообщения для плеера
[V] Придумать как запустить ffmpeg через http прокси (SHS rust)
[V] Переделать очередь, включая систему треков
[V] Прошлые треки не удаляются сразу а хранятся до удаления очереди, для правльной работы last track
[V] Кнопки плеера привязаны к плееру, а не к командам
[V] Отслеживание процесса ffmpeg
[V] Перенос действий меню в InteractCreate
[V] Переделать случайные треки
[V] Продвинутая система сообщений
[V] Создать логику проверки бота в голосовом канале
[V] Проигрывание треков без задержки
[V] Добавить перевод на другие языки
[V] Написать Logger
[V] Команды (Utils, Musics, Owners, Voices)

В разработке
[~] Добавить ограничение на ввод команд (cooldown)
[~] Почистить env от всяческого мусора

Еще не решено
[?] Система плейлистов, при помощи json. История прослушивания для каждого пользователя своя
[?] Добавить youtube-dl, ytdl-dlp

Отменено
[~] Фильтры теперь привязаны к плееру, а не к командам (многие фильтры придется удалить)
[-] FFmpeg теперь воспроизводит не ссылку а поток, поток будет получатся методом https.
```
### Идеи и вопросы
```css
Прочие:
[~] Перенос показа что в очереди через кнопку в плеере, остановка музыки тоже будет в плеере
[~] Фильтры включаются не сразу, для предотвращения ошибок при использовании 2 пользователями
[~] Дохуя умные команды такие как 
    - report - для отправки репорта об ошибке
[~] 2 строки кнопок?
[~] Public repository? - пока не знаю
```