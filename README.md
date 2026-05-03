
<div align="center">
  <h1>🌟 WatKLOK — High-Performance Voice Engine for Discord</h1>

<h4>Incredible bot with its own voice/audio engine, scalable architecture, multiple filters and support for 6 music platforms.</h4>
<h4>Audio quality surpasses lavalink, don't believe me? Listen for yourself!</h4>
<h4>The project is aimed at quality, not speed!!!</h4>

  <p>
    English
    |
    <a href="./README_RU.md">
    Русский
    </a>
  </p>

  <p>
    <a href="">
      <img src=".github/images/woman.png" alt="Title" />
    </a>
  </p>

<p>
    <a href="LICENSE.md">
      <img src="https://img.shields.io/badge/License-BSD3-green?style=for-the-badge" alt="License" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/releases/latest">
      <img src="https://img.shields.io/github/v/release/SNIPPIK/Untitles?logo=git&style=for-the-badge&include_prereleases&label=Release" alt="Latest release" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/releases">
      <img src="https://img.shields.io/github/downloads/SNIPPIK/Untitles/total?logo=github&style=for-the-badge&label=Downloads" alt="All downloads" />
    </a>
    <a href="https://github.com/SNIPPIK/Untitles/graphs/contributors">
      <img src="https://img.shields.io/github/contributors/SNIPPIK/Untitles.svg?logo=github&style=for-the-badge&label=Contributors" alt="All Contributors" />
    </a>
  </p>
</div>

---

## 👥 Contributors

- 👤 [`SNIPPIK`](https://github.com/SNIPPIK)

📢 Report any bugs or omissions to [`Issues`](https://github.com/SNIPPIK/UnTitles/issues) or [`Discord`](https://discord.gg/qMf2Sv3)

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

---

> [!IMPORTANT]
> ⚠️ WatKLOK (UnTitles) is a complex technical project maintained exclusively by one author, `SNIPPIK`  
> Please respect the authorship and license of the project.

> [!TIP]
> I recommend enabling the caching system in `.env`. This will allow you to play tracks even if the platform is completely blocked.
> However, the voice system is simply not allowed to lose audio packets, even under critical load!

> [!WARNING]
> If you use a proxy, keep in mind that `FFmpeg` does not support socks. For such tasks, there's [`STH`](https://github.com/SNIPPIK/SHS)  
> ⚠️ Some functions require proper environment configuration (FFmpeg, proxy, native modules)
---

### ⚠️ Hardware Requirements | Data from Ryzen 7 5700x3D | 1 player
- Total load for `1 layer + shard` (Voice + Player)
- CPU: `~0.1%`
- RAM: `80 MB`

#### What causes a heavy load
- `Scheduler` for 1 thread (50 UDP + RingBuffer) ~0.1% CPU
- `OggOpusParser` for 1 conversion cycle ~0.5 CPU (1.2 sec)
---

## 🚀 Advantages (WatKLOK)
- The most complex operations are handled by Rust via n-api, providing almost complete independence from Node.js limitations.
- You can define the decoder mode (`voip`, `audio`, `lowdelay`), enable/disable `VBR`, enable/disable packet loss during the download phase, and also enable `FEC`.
- There are strict delay limits to limit audio corruption, which can also be changed!

<details>
<summary>Click to open</summary>

## 🦀 Native Voice Engine (Rust Powered)
- The core voice processing logic is moved to a native Rust module (src-rs), ensuring stability even with high event loop lag in Node.js.
- **Voice Engine**: Full implementation of Voice Gateway V8. Stack: UDP + SRTP + Opus.
- **Security**: Support for End-to-End Encryption (E2EE 🔐) via the Discord DAVE protocol.
- **Timers**: Cyclic systems using a timer + auto-balancing.
- Smart Streaming: No external Opus encoders required for streaming—it uses a proprietary Opus frame parsing method.
- FFmpeg Integration: Used for flexible audio decoding and complex filtering.

---

## 🌐 Platforms and Parsing
- Support for YouTube, Spotify, VK, Yandex-Music, SoundCloud, Deezer, and Apple (only a draft).
- Smart Fallback: If a track is unavailable on one platform, the system will automatically find it on another.
- Related Tracks: Automatically selects and plays similar tracks for endless listening.
- Worker Threads: All heavy-duty search and parsing operations are moved to separate worker threads to avoid blocking the bot's main thread. - **Extensibility**: Modular architecture via Dynamic Handler allows you to add a new platform in minutes.

---

## 🌍 Localization and Typing
- **Languages**: Full support for Russian and English ([**language file**](src/structures/locale/languages.json)).
- **DX (Developer Experience)**: The entire project is strongly typed (TypeScript + Rust ABI), comes with a bunch of interfaces and examples.
- **Scalability**: Easily add any languages ​​supported by Discord.

---
</details>

## 🎖️ Event Loop Blocking Resistance
Even if the main Node.js thread is hard blocked, audio continues playing **without lag or distortion**.
<details>
<summary>Click to open</summary>

```ts
// 💣 Event Loop Blocking Test (x4)
setInterval(() => {
    const start = performance.now();
    while (performance.now() - start < 100) {}
}, 100);
```
</details>

---

## 🎵 Audio Quality
- Everything depends on the limitations of Discord itself. There are no encoding restrictions; you can try feeding Discord even 512 KBit audio.
- **Hot Audio Swap**: Instant seamless transitions between tracks.
- **Audio Effects**: Smooth fade-in/fade-out for any actions (skip, seek, pause)
- **Filters: 16+** built-in **audio filters** with the ability to easily add your own via the JSON config [(filters.json)](src/core/player/filters.json)
- **Sync**: Direct synchronization of the audio stream without distortion introduced by software filters.

> [!WARNING]
> Losses on the client side are impossible, if a loss occurs accidentally you will see it in the `current track` message  
> If your internet is unstable, losses will occur in any case.  
> It is impossible to completely eliminate `packet lost` due to the `UDP` protocol and other `discord` limitations.


### Entire Audio Path
<details>
<summary>Click to open</summary>

```txt
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              1. REQUEST INITIATION                                  │
│  /play command → Platform API (YouTube, SoundCloud, Yandex...) → Fetch URL/ID       │
│                                 (REST Layer)                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          2. RESOURCE RESOLUTION (ResourceProvider)                  │
│  • AudioCache check (if already downloaded → instant return of .opus file path)     │
│  • If not: db.api.fetchAudioLink() → obtain temporary URL from platform             │
│  • HTTPS client (with Keep-Alive and redirects) → HEAD / GET stream                 │
│  • If needed: save stream to AudioCache (background worker)                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                             3. DECODING AND PARSING                                 │
│  [Rust] FFmpegProcess / native OggOpusParser (if source is already Opus)            │
│  • Chunked reading (streaming)                                                      │
│  • Extraction of raw Opus frames (OggParser::parse_internal)                        │
│  • Stripping Ogg container → pure Opus bytes for each frame                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         4. PLAYER PREPARATION (AudioPlayer)                         │
│  • Track queue (Queue) → Track → AudioResource                                      │
│  • If filters enabled (nightcore, bassboost) → applied ON Opus without PCM          │
│  • Hot Audio Swap: instant source switching without breaking the connection         │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    5. TRANSMISSION SCHEDULER (CycleManager + Balancer)              │
│  [Rust] tokio runtime                                                               │
│  • Balancer groups up to 50 active connections per cycle                            │
│  • CycleManager runs a loop with ~20 ms interval                                    │
│  • Each cycle pulls ready Opus frames from AudioPlayer                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              6. TRANSPORT LAYERS (Layers)                           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │  RTPLayer                                                                   │    │
│  │  • Adds RTP header (SSRC, timestamp, sequence number)                       │    │
│  │  • Encrypts RTP packet with DAVELayer key (or static secret_key)            │    │
│  │  • Forms final UDP datagram ready for sending                               │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                            │
│                                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │ ┌─────────────────────────────────────────────────────────────────────────┐ │    │
│  │ │ DAVELayer (if channel is E2EE)                                          │ │    │
│  │ │ • Obtains keys from MLS session                                         │ │    │
│  │ │ • Encrypts Opus frame (AES-GCM)                                         │ │    │
│  │ │ • Fallback: up to 3 retries on encryption failure                       │ │    │
│  │ └─────────────────────────────────────────────────────────────────────────┘ │    │
│  │                                    │                                        │    │
│  │                                    ▼                                        │    │
│  │ ┌─────────────────────────────────────────────────────────────────────────┐ │    │
│  │ │ UDPLayer                                                                │ │    │
│  │ │ • Sends packet via UDP socket to Discord Voice Server                   │ │    │
│  │ │ • Discovery Handshake (performed once per connection)                   │ │    │
│  │ └─────────────────────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              7. RECEPTION AND STATISTICS                            │
│  • Discord receives RTP packets, decodes Opus, plays back in the voice channel      │
│  • WatKLOK collects WebRTC feedback: Delay, Packet Loss                             │
│  • Logging of all stages with [RAM] and timestamps                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```
</details>

---

## 🎛 Interface
- Interactive buttons: actions depend on the player's state
- Progress bar support with timecodes
- Responsive UI - no need to reuse commands

#### 📚 Commands
<details>
<summary>Click to open</summary>

|   Command | Autocomplete | Arguments                    | Description       |
|----------:|:-------------|:-----------------------------|:------------------|
| `/filter` | ✅            | (off, push, disable)         | Audio filters     |
|   `/play` | ✅            | (query)                      | Playback          |
| `/player` | ✅            | (api, replay, stop, related) | Advanced playback |
| `/volume` | ✅            | value                        | Player Volume     |
| `/remove` | ✅            | value                        | Delete Track      |
|   `/seek` | ❌            | 00:00, int                   | Rewind Track      |
|   `/skip` | ✅            | (back, to, next)             | Skip Tracks       |
| `/repeat` | ✅            | type                         | Repeat Type       |
|  `/queue` | ✅            | {destroy, list}              | Queue Management  |
|  `/voice` | ✅            | (join, leave, tribune)       | Voice Channel     |
</details>

---

## 🚀 Launch
- Node.js, FFmpeg, and Rust (optional) required
- You don't need to build Rust components! Ready-made builds [here](https://github.com/SNIPPIK/UnTitles/actions/workflows/build.yml)
> All parameters should already be defined in `.env.custom`, so take it and rename it to .env
```shell
# Clone
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Install dependencies
npm i

# If you need to build Rust components
# If you don't want to build, download the ready-made build and add everything to build/native
npm run build:native

# Build Typescript + run
npm run build && npm run start
```

# 📊 Project Diagram
- In case you're curious about how the bot is built

<details>
<summary>Click to open</summary>

[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)
</details>