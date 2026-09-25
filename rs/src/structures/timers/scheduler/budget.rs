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
/// 20 ms → normal
/// 20–30 ms → burst 2
/// >30 ms → burst 3
const BURST_THRESHOLD_1: Duration = Duration::from_millis(3);

/// Второй порог отставания: при его превышении разрешается максимальный
/// burst (`MAX_SEND_BURST`).
const BURST_THRESHOLD_2: Duration = Duration::from_millis(10);

/// -------------------------------------------------------------------------
/// SendBudget
/// -------------------------------------------------------------------------
///
/// Планировщик отвечает только за timing.
///
/// Нижний уровень (Player/Session/UDP) сам решает, сколько пакетов
/// фактически отправить в пределах разрешённого бюджета.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendBudget {
    /// Обычный режим — один пакет за тик.
    Normal,

    /// Burst-режим — до N пакетов за тик.
    Burst(u8)
}

impl SendBudget {
    /// Возвращает количество пакетов, разрешённых за один тик.
    ///
    /// Для `Normal` — 1, для `Burst(n)` — n.
    #[inline]
    pub const fn packets(self) -> u8 {
        match self {
            // Обычный режим: ровно один пакет.
            Self::Normal => NORMAL_SEND_BUDGET,
            
            // Burst-режим: количество, зафиксированное в варианте.
            Self::Burst(count) => count,
        }
    }

    /// Определяет дополнительный send budget, который имеет смысл дать сессии.
    ///
    /// Важно: `late` не равно числу пропущенных тиков.
    /// Оценивается именно timing debt — насколько мы опоздали к дедлайну.
    ///
    /// # Аргументы
    /// * `late` — насколько фактическое пробуждение опоздало относительно дедлайна.
    ///
    /// # Возвращаемое значение
    /// * `SendBudget::Normal` — при малом опоздании (< `BURST_THRESHOLD_1`).
    /// * `SendBudget::Burst(2)` — при умеренном отставании
    ///   (`>= BURST_THRESHOLD_1`, `< BURST_THRESHOLD_2`).
    /// * `SendBudget::Burst(MAX_SEND_BURST)` — при сильном отставании
    ///   (`>= BURST_THRESHOLD_2`).
    #[inline]
    pub fn calculate_send_budget(late: Duration) -> SendBudget {
        match late {
            // Сильно отстали — разрешаем максимальный burst.
            BURST_THRESHOLD_2 => {
                SendBudget::Burst(MAX_SEND_BURST)
            }

            // Умеренное отставание — двойной burst.
            BURST_THRESHOLD_1 => {
                SendBudget::Burst(2)
            }

            // В пределах нормы — обычный режим.
            _ => {
                SendBudget::Normal
            }
        }
    }
}