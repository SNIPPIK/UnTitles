use std::collections::HashMap;
use std::sync::Arc;
use arc_swap::ArcSwap;
use crate::structures::network::udp::socket::SocketBuffered;

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

impl SessionRegistry {
    /// Создаёт пустой реестр.
    pub fn new() -> Self {
        Self { sessions: ArcSwap::from_pointee(HashMap::new()) }
    }

    /// Добавляет сессию в реестр (или заменяет существующую с тем же id).
    ///
    /// # Аргументы
    /// * `id` — идентификатор сессии.
    /// * `session` — обёртка UDP-сессии.
    pub fn add(&self, id: u32, session: Arc<SocketBuffered>) {
        self.update(|map| { map.insert(id, session); });
    }

    /// Удаляет сессию по идентификатору.
    ///
    /// Если сессии с таким id нет — операция не выполняет действий.
    ///
    /// # Аргументы
    /// * `id` — идентификатор удаляемой сессии.
    pub fn remove(&self, id: u32) {
        self.update(|map| { map.remove(&id); });
    }

    /// Проверяет, что реестр не содержит ни одной сессии.
    pub fn is_empty(&self) -> bool {
        self.sessions.load().is_empty()
    }

    /// Возвращает снимок карты сессий.
    ///
    /// Снимок отражает состояние на момент вызова и не изменяется
    /// при последующих обновлениях реестра.
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
        // Загружаем текущий Arc на карту.
        let mut current = self.sessions.load_full();

        // Копируем карту только при наличии конкурентов.
        let map = Arc::make_mut(&mut current);

        // Применяем изменение.
        update_fn(map);

        // Публикуем обновлённый снимок.
        self.sessions.store(current);
    }
}