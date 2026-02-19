#include <napi.h>
#include <vector>
#include <cstring>
#include <string_view>

/**
 * @author SNIPPIK
 * @description Базовый класс декодера, ищет opus фрагменты в ogg потоке.
 * Наследуемся от ObjectWrap, чтобы Node.js мог управлять жизненным циклом C++ объекта.
 */
class OggOpusParser : public Napi::ObjectWrap<OggOpusParser> {
public:
    /**
     * @description Инициализация экспорта класса в Node.js контекст.
     */
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        // Регистрируем методы, которые будут доступны в JS (например, parser.parse())
        Napi::Function func = DefineClass(env, "OggOpusParser", {
            InstanceMethod("parse", &OggOpusParser::Parse),
            InstanceMethod("destroy", &OggOpusParser::Destroy)
        });

        // Создаем Persistent (долгоживущую) ссылку на конструктор класса.
        // Это нужно, чтобы V8 не удалил описание класса раньше времени.
        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);

        // Сохраняем конструктор в данных окружения, чтобы иметь к нему доступ позже
        env.SetInstanceData(constructor);

        // Экспортируем под именем OggOpusParser
        exports.Set("OggOpusParser", func);
        return exports;
    }

    /**
     * @constructor Вызывается при `new OggOpusParser()`
     */
    OggOpusParser(const Napi::CallbackInfo& info) : Napi::ObjectWrap<OggOpusParser>(info) {
        _remainder.reserve(8192);
        _packetCarry.reserve(2048);
    }

private:
    /** * Буфер для "хвостов". Если страница Ogg пришла не полностью,
     * мы храним её начало здесь до прихода следующего чанка.
     */
    std::vector<uint8_t> _remainder;

    /** * Накопитель пакета (carry). В Ogg один пакет может быть разбит на несколько страниц.
     * Мы собираем его сегменты здесь, пока не встретим сегмент размером < 255 байт.
     */
    std::vector<uint8_t> _packetCarry;

    /** * Serial Number текущего потока. Ogg может быть многопоточным (Chained Ogg).
     * Мы следим за этим ID, чтобы не смешать данные разных треков.
     */
    int32_t _bitstreamSerial = -1;
    bool _waitingForHead = true;

    /**
     * @description Основной метод обработки входящих байтов.
     * Вызывается из JS: instance.parse(buffer, (type, data) => {})
     */
    Napi::Value Parse(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Buffer<uint8_t> chunk = info[0].As<Napi::Buffer<uint8_t>>();
        Napi::Function emit = info[1].As<Napi::Function>();

        const uint8_t* workPtr;
        size_t workSize;

        // Эффективная работа с памятью:
        // Вместо копирования _remainder, мы делаем swap (обмен указателями).
        // Это O(1) операция, которая мгновенно перемещает данные в рабочую переменную.
        std::vector<uint8_t> combinedData;

        // Если есть остаток от прошлого чанка — склеиваем
        if (!_remainder.empty()) {
            combinedData.swap(_remainder);
            combinedData.insert(combinedData.end(), chunk.Data(), chunk.Data() + chunk.Length());
            workPtr = combinedData.data();
            workSize = combinedData.size();
        } else {
            // Zero-copy: работаем напрямую с буфером из JS
            workPtr = chunk.Data();
            workSize = chunk.Length();
        }

        size_t offset = 0;

        // Минимум 27 байт — это размер базового заголовка страницы Ogg (без таблицы сегментов)
        while (offset + 27 <= workSize) {
            // Ищем сигнатуру "OggS" (0x4f 0x67 0x67 0x53)
            if (workPtr[offset] != 'O' || std::memcmp(&workPtr[offset], "OggS", 4) != 0) {
                offset++;
                continue;
            }

            // Байт №26 содержит количество сегментов в странице
            uint8_t segmentsCount = workPtr[offset + 26];

            // Полный размер заголовка = 27 байт + таблица сегментов (по 1 байту на сегмент)
            size_t headerSize = 27 + segmentsCount;

            // Если в буфере нет даже полного заголовка — прерываемся и ждем данных
            if (offset + headerSize > workSize) break;

            // Считаем размер Payload (полезной нагрузки) текущей страницы
            // Суммируем значения из таблицы сегментов (каждый байт — длина сегмента)
            size_t payloadSize = 0;
            const uint8_t* segmentTable = &workPtr[offset + 27];
            for (size_t i = 0; i < segmentsCount; i++) {
                payloadSize += segmentTable[i];
            }

            // Общий размер страницы (заголовок + таблица + данные)
            size_t totalPageSize = headerSize + payloadSize;

            // Если страница целиком не влезла в текущий буфер — сохраняем её остаток и выходим
            if (offset + totalPageSize > workSize) break;

            // Страница валидна и полностью загружена — обрабатываем её
            HandlePage(env, &workPtr[offset], segmentsCount, emit);
            offset += totalPageSize;
        }

        // Если после цикла остались байты (неполная страница), сохраняем их на будущее
        if (offset < workSize) {
            _remainder.assign(workPtr + offset, workPtr + workSize);
        }

        return env.Undefined();
    }

    /**
     * @description Разбирает конкретную страницу Ogg на пакеты Opus.
     */
    void HandlePage(Napi::Env env, const uint8_t* page, uint8_t segmentsCount, Napi::Function emit) {
        // Извлекаем Serial Number страницы (байты 14-17)
        uint32_t serial;
        std::memcpy(&serial, page + 14, 4);

        // Извлекаем флаги страницы (байт 5)
        uint8_t flags = page[5];

        // Обработка логики смены потоков (Chained Ogg)
        if ((flags & 0x02) || (_bitstreamSerial != -1 && _bitstreamSerial != (int32_t)serial)) {
            _bitstreamSerial = serial;
            _packetCarry.clear();
            _waitingForHead = true;
        }

        if (_bitstreamSerial == -1) _bitstreamSerial = serial;

       // Указатель на начало таблицы сегментов
        const uint8_t* segmentTable = page + 27;
        // Указатель на начало фактических данных (сразу после таблицы)
        const uint8_t* dataPtr = segmentTable + segmentsCount;

        // Итерируемся по сегментам страницы
        for (size_t i = 0; i < segmentsCount; i++) {
            uint8_t segmentSize = segmentTable[i];

            // Копируем данные сегмента в наш накопитель пакета
            _packetCarry.insert(_packetCarry.end(), dataPtr, dataPtr + segmentSize);
            dataPtr += segmentSize;

            /**
             * В Ogg окончание логического пакета определяется размером сегмента.
             * Если сегмент < 255 байт — это конец пакета.
             * Если сегмент == 255 — пакет продолжается в следующем сегменте.
             */
            if (segmentSize < 255) {
                ProcessPacket(env, emit);
                _packetCarry.clear();
            }
        }

        if (flags & 0x04) { // EOS (End of Stream)
            _bitstreamSerial = -1;
        }
    }

    void ProcessPacket(Napi::Env env, Napi::Function emit) {
        if (_packetCarry.empty()) return;

        std::string_view type = "frame";
        if (_packetCarry.size() >= 8) {
            if (std::memcmp(_packetCarry.data(), "OpusHead", 8) == 0) {
                type = "head";
                _waitingForHead = false;
            } else if (std::memcmp(_packetCarry.data(), "OpusTags", 8) == 0) {
                type = "tags";
            }
        }

        // Пропускаем фреймы, пока не встретим OpusHead (важно для Chained Ogg)
        if (_waitingForHead && type == "frame") return;

        // Передаем собранные данные обратно в JavaScript через коллбэк.
        // Используем Copy, чтобы создать независимый Buffer в куче V8.
        emit.Call({
            Napi::String::New(env, type.data(), type.size()),
            Napi::Buffer<uint8_t>::Copy(env, _packetCarry.data(), _packetCarry.size())
        });
    }

    /**
     * @description Удаляем данные из OGG парсера
     */
    Napi::Value Destroy(const Napi::CallbackInfo& info) {
        _remainder.clear();
        _remainder.shrink_to_fit();
        _packetCarry.clear();
        _packetCarry.shrink_to_fit();
        _bitstreamSerial = -1;
        return info.Env().Undefined();
    }
};

/**
 * Инициализация модуля
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return OggOpusParser::Init(env, exports);
}

// Макрос регистрации модуля (имя должно совпадать с именем в binding.gyp)
NODE_API_MODULE(opus_native, Init)