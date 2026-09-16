use std::time::Duration;

/// Обычный send budget: одно отправление за тик.
const NORMAL_SEND_BUDGET: u8 = 1;

/// Максимальный burst, который планировщик может запросить.
///
/// Это НЕ значит, что UDP обязан отправить 3 пакета подряд.
/// Это только разрешённый budget для Player/Session.
const MAX_SEND_BURST: u8 = 3;

/// Порог отставания, после которого одного обычного пакета уже недостаточно
/// для своевременной доставки.
///
/// Соответствие:
/// 20 ms      → normal
/// 20–30 ms   → burst 2
/// >30 ms     → burst 3
const BURST_THRESHOLD_1: Duration = Duration::from_millis(2);
const BURST_THRESHOLD_2: Duration = Duration::from_millis(15);

/// -------------------------------------------------------------------------
/// SendBudget
/// -------------------------------------------------------------------------
///
/// Планировщик отвечает только за timing.
///
/// Он НЕ знает:
/// - какой именно Opus-пакет сейчас играет;
/// - сколько реально готовых пакетов в буфере;
/// - как устроен RTP;
/// - как работает UDP.
///
/// Он лишь сообщает нижнему уровню:
///
///     "у нас есть timing debt, разрешён дополнительный budget".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendBudget {
    /// Обычный режим — один пакет за тик.
    Normal,
    /// Burst-режим — до N пакетов за тик.
    Burst(u8),
}

impl SendBudget {
    /// Возвращает количество пакетов, разрешённых за один тик.
    ///
    /// Для `Normal` — 1, для `Burst(n)` — n.
    #[inline]
    pub const fn packets(self) -> u8 {
        match self {
            Self::Normal => NORMAL_SEND_BUDGET,
            Self::Burst(count) => count,
        }
    }

    /// Возвращает `true`, если бюджет соответствует burst-режиму.
    #[inline]
    pub const fn is_burst(self) -> bool {
        matches!(self, Self::Burst(_))
    }

    /// Определяет дополнительный send budget, который имеет смысл дать сессии.
    ///
    /// Важно: `late` не равно числу пропущенных тиков.
    /// Оценивается именно timing debt.
    ///
    /// Пример:
    ///   deadline = 20 ms
    ///   планировщик проснулся через 26 ms
    ///
    /// Формально один дедлайн пропущен, но это не значит, что нужно
    /// «отправить два тика». Просто разрешается burst из 2 пакетов.
    ///
    /// # Аргументы
    /// * `late` — насколько фактическое пробуждение опоздало относительно дедлайна.
    ///
    /// # Возвращаемое значение
    /// `SendBudget::Normal` при малом опоздании,
    /// `SendBudget::Burst(2..=MAX_SEND_BURST)` — при существенном.
    #[inline]
    pub fn calculate_send_budget(late: Duration) -> SendBudget {
        if late >= BURST_THRESHOLD_2 {
            // Сильно отстали — разрешаем максимальный burst.
            SendBudget::Burst(MAX_SEND_BURST)
        } else if late >= BURST_THRESHOLD_1 {
            // Умеренное отставание — двойной burst.
            SendBudget::Burst(2)
        } else {
            // В пределах нормы — обычный режим.
            SendBudget::Normal
        }
    }
}