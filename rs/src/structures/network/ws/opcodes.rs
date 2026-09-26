/// Коды операций голосового WebSocket-протокола Discord.
///
/// Значения соответствуют официальной документации Discord Voice Gateway.
pub mod op {
    /// Идентификация клиента (регистрация голосового подключения).
    pub const IDENTIFY: u8 = 0;

    /// Выбор транспортного протокола (UDP/TLS) после получения данных от шлюза.
    pub const SELECT_PROTOCOL: u8 = 1;

    /// Готовность голосового канала к работе.
    pub const READY: u8 = 2;

    /// Отправка heartbeat-пакета для поддержания соединения.
    pub const HEARTBEAT: u8 = 3;

    /// Описание сессии: SSRC, ключи шифрования, режим.
    pub const SESSION_DESCRIPTION: u8 = 4;

    /// Уведомление о состоянии говорящего (start/stop).
    pub const SPEAKING: u8 = 5;

    /// Подтверждение полученного heartbeat.
    pub const HEARTBEAT_ACK: u8 = 6;

    /// Возобновление сессии с сохранением seq.
    pub const RESUME: u8 = 7;

    /// Приветствие от шлюза с интервалом heartbeat.
    pub const HELLO: u8 = 8;

    /// Подтверждение успешного возобновления сессии.
    pub const RESUMED: u8 = 9;

    /// Уведомление о подключении новых клиентов к каналу.
    pub const CLIENTS_CONNECT: u8 = 11;

    /// Уведомление об отключении клиента от канала.
    pub const CLIENT_DISCONNECT: u8 = 13;

    // ---------------------------------------------------------------------
    // DAVE (E2EE / MLS) — расширение Discord для сквозного шифрования
    // ---------------------------------------------------------------------

    /// Подготовка к переходу между версиями протокола.
    pub const DAVE_PREPARE_TRANSITION: u8 = 21;

    /// Выполнение подготовленного перехода.
    pub const DAVE_EXECUTE_TRANSITION: u8 = 22;

    /// Подтверждение готовности к переходу от другой стороны.
    pub const DAVE_TRANSITION_READY: u8 = 23;

    /// Подготовка новой эпохи (инициализация E2EE-сессии).
    pub const DAVE_PREPARE_EPOCH: u8 = 24;

    /// Внешний отправитель MLS-сессии.
    pub const DAVE_MLS_EXTERNAL_SENDER: u8 = 25;

    /// Key-package для распространения среди участников.
    pub const DAVE_MLS_KEY_PACKAGE: u8 = 26;

    /// Предложения (Proposals) от других участников.
    pub const DAVE_MLS_PROPOSALS: u8 = 27;

    /// Commit и Welcome MLS-сессии.
    pub const DAVE_MLS_COMMIT_WELCOME: u8 = 28;

    /// Анонс Commit-перехода.
    pub const DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION: u8 = 29;

    /// Welcome-сообщение для присоединения к группе.
    pub const DAVE_MLS_WELCOME: u8 = 30;

    /// Уведомление о невалидности Commit или Welcome.
    pub const DAVE_MLS_INVALID_COMMIT_WELCOME: u8 = 31;

    /// Проверяет, относится ли op-код к диапазону DAVE.
    ///
    /// # Аргументы
    /// * `code` — op-код из полученного сообщения.
    ///
    /// # Возвращаемое значение
    /// `true`, если код принадлежит диапазону DAVE/MLS.
    #[inline]
    pub fn is_dave(code: u8) -> bool {
        code >= DAVE_PREPARE_TRANSITION
            && code <= DAVE_MLS_INVALID_COMMIT_WELCOME
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn is_dave_boundaries() {
            assert!(!is_dave(0));
            assert!(!is_dave(DAVE_PREPARE_TRANSITION - 1));
            assert!(is_dave(DAVE_PREPARE_TRANSITION));
            assert!(is_dave(DAVE_MLS_INVALID_COMMIT_WELCOME));
            assert!(!is_dave(DAVE_MLS_INVALID_COMMIT_WELCOME + 1));
            assert!(!is_dave(255));
        }
    }
}

/// Статусы WebSocket-соединения.
pub mod ws_status {
    /// Устанавливается соединение (handshake в процессе).
    pub const CONNECTING: u8 = 0;

    /// Соединение открыто и готово к обмену данными.
    pub const OPEN: u8 = 1;

    /// Соединение закрывается.
    pub const CLOSING: u8 = 2;

    /// Соединение закрыто.
    pub const CLOSED: u8 = 3;
}

/// Коды закрытия соединения, специфичные для Discord Voice.
pub mod close_codes {
    /// Тайм-аут heartbeat — сервер не подтвердил сигнал вовремя.
    pub const SESSION_TIMEOUT: u32 = 4014;

    /// Голосовой сервер не найден.
    pub const SERVER_NOT_FOUND: u32 = 4011;
}

/// Проверяет, относится ли op-код к диапазону DAVE.
///
/// Удобная функция-обёртка над [`op::is_dave`] для использования
/// без явного указания модуля.
#[inline]
pub fn is_dave(code: u8) -> bool {
    op::is_dave(code)
}