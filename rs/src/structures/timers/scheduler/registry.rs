use crate::structures::network::udp::socket::SocketBuffered;
use arc_swap::ArcSwap;
use std::collections::HashMap;
use std::sync::Arc;

/// Реестр активных UDP-сессий.
///
/// Хранит карту `id → Arc<SocketBuffered>` и обеспечивает lock-free
/// чтение снимка через `ArcSwap`. Обновления выполняются копированием
/// карты и атомарной заменой, что позволяет читателям получать
/// согласованный снимок без блокировок.
pub struct SessionRegistry {
    /// Карта сессий, обёрнутая в `ArcSwap` для lock-free снимков.
    sessions: ArcSwap<HashMap<u32, Arc<SocketBuffered>>>,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    /// Создаёт пустой реестр.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: ArcSwap::from_pointee(HashMap::new()),
        }
    }

    /// Добавляет сессию в реестр (или заменяет существующую с тем же id).
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
    pub fn add(&self, id: u32, session: Arc<SocketBuffered>) {
        self.update(|map| {
            map.insert(id, session);
        });
    }

    /// Удаляет сессию по идентификатору.
    ///
    /// Если сессии с таким id нет — операция не выполняет действий.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    pub fn remove(&self, id: u32) {
        self.update(|map| {
            map.remove(&id);
        });
    }

    /// Проверяет, что реестр не содержит ни одной сессии.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.load().is_empty()
    }

    /// Количество зарегистрированных сессий (snapshot; может устареть сразу
    /// после возврата при конкурентных обновлениях).
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.load().len()
    }

    /// Возвращает снимок карты сессий.
    ///
    /// Снимок отражает состояние на момент вызова и не изменяется
    /// при последующих обновлениях реестра.
    #[must_use]
    pub fn snapshot(&self) -> Arc<HashMap<u32, Arc<SocketBuffered>>> {
        self.sessions.load_full()
    }

    /// Применяет замыкание к текущей карте сессий и публикует результат.
    ///
    /// `Arc::make_mut` копирует карту только при наличии других владельцев
    /// снимка, иначе изменяет её на месте. Это даёт дешёвые обновления,
    /// когда никто не читает снимок параллельно.
    ///
    /// # Аргументы
    /// * `update_fn` — замыкание, изменяющее карту.
    fn update<F>(&self, update_fn: F)
    where
        F: FnOnce(&mut HashMap<u32, Arc<SocketBuffered>>),
    {
        let mut current = self.sessions.load_full();
        let map = Arc::make_mut(&mut current);
        update_fn(map);
        self.sessions.store(current);
    }
}