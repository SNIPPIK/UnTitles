#include <napi.h>
#include <thread>
#include <chrono>
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <unordered_map>
#include <algorithm>

class CycleWorker {
public:
    CycleWorker(int interval_ms, Napi::ThreadSafeFunction tsfn)
        : target_interval_micros(interval_ms * 1000),
          tsfn(tsfn),
          running(false),
          current_lag_micros(0) {}

    ~CycleWorker() {
        Stop();
    }

    void Start() {
        if (running.exchange(true)) return;

        native_thread = std::thread([this]() {
            // Точка отсчета для синхронизации с performance.now() в JS
            auto start_time = std::chrono::steady_clock::now();
            auto next_tick = start_time;

            while (running) {
                // 1. РАСЧЕТ КОРРЕКЦИИ
                int32_t lag = current_lag_micros.load();
                auto adjusted_tick = next_tick - std::chrono::microseconds(lag);

                // 2. ПРЕЦИЗИОННЫЙ ГИБРИДНЫЙ СОН
                std::unique_lock<std::mutex> lock(cv_m);

                // Спим через CV чуть меньше (на 500 мкс), чтобы не "проспать" момент из-за планировщика ОС
                auto sleep_until = adjusted_tick - std::chrono::microseconds(500);
                cv.wait_until(lock, sleep_until, [this] { return !running; });

                if (!running) break;

                // "Догрев" процессора (Busy Wait) для микросекундной точности
                while (std::chrono::steady_clock::now() < adjusted_tick && running) {
                    std::this_thread::yield();
                }

                // 3. ФИКСАЦИЯ ОТНОСИТЕЛЬНОГО ВРЕМЕНИ
                auto shot_time = std::chrono::steady_clock::now();
                // Сколько мс прошло с запуска воркера
                double elapsed_ms = std::chrono::duration<double, std::milli>(shot_time - start_time).count();

                // 4. ВЫЗОВ JS
                auto callback = [elapsed_ms](Napi::Env env, Napi::Function jsCallback) {
                    // Передаем double, чтобы сохранить точность дробной части мс
                    jsCallback.Call({ Napi::Number::New(env, elapsed_ms) });
                };

                tsfn.NonBlockingCall(callback);

                // 5. ПЛАНИРОВАНИЕ СЛЕДУЮЩЕГО ШАГА
                next_tick += std::chrono::microseconds(target_interval_micros);

                // Защита от накопления (drift)
                if (std::chrono::steady_clock::now() > next_tick + std::chrono::seconds(1)) {
                    next_tick = std::chrono::steady_clock::now();
                }
            }
        });
    }

    void Stop() {
        if (running.exchange(false)) {
            cv.notify_all();
            if (native_thread.joinable()) {
                native_thread.join();
            }
            tsfn.Release();
        }
    }

    void SetLag(int32_t lag_micros) {
        // Ограничиваем коррекцию, чтобы не схлопнуть цикл (макс 95% интервала)
        int32_t max_corr = static_cast<int32_t>(target_interval_micros * 0.95);
        current_lag_micros.store(std::clamp(lag_micros, 0, max_corr));
    }

private:
    int64_t target_interval_micros;
    Napi::ThreadSafeFunction tsfn;
    std::atomic<bool> running;
    std::atomic<int32_t> current_lag_micros;
    std::thread native_thread;
    std::condition_variable cv;
    std::mutex cv_m;
};

// Глобальный менеджер воркеров
static std::mutex map_m;
static std::unordered_map<uint32_t, std::unique_ptr<CycleWorker>> workers;
static uint32_t next_id = 1;

Napi::Value StartCycle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected (number, function)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int interval = info[0].As<Napi::Number>().Int32Value();
    Napi::Function cb = info[1].As<Napi::Function>();

    // Создаем ThreadSafeFunction с очередью в 1 сообщение (нам не нужно копить тики)
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(env, cb, "AudioClock", 0, 1);

    std::lock_guard<std::mutex> lock(map_m);
    uint32_t id = next_id++;
    workers[id] = std::make_unique<CycleWorker>(interval, tsfn);
    workers[id]->Start();

    return Napi::Number::New(env, id);
}

Napi::Value SetLag(const Napi::CallbackInfo& info) {
    uint32_t id = info[0].As<Napi::Number>().Uint32Value();
    int32_t lag_micros = info[1].As<Napi::Number>().Int32Value();

    std::lock_guard<std::mutex> lock(map_m);
    if (workers.count(id)) {
        workers[id]->SetLag(lag_micros);
    }
    return info.Env().Undefined();
}

Napi::Value StopCycle(const Napi::CallbackInfo& info) {
    uint32_t id = info[0].As<Napi::Number>().Uint32Value();
    std::lock_guard<std::mutex> lock(map_m);
    if (workers.count(id)) {
        workers[id]->Stop();
        workers.erase(id);
    }
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, StartCycle));
    exports.Set("stop", Napi::Function::New(env, StopCycle));
    exports.Set("lag", Napi::Function::New(env, SetLag));
    return exports;
}

NODE_API_MODULE(cycle_native, Init)