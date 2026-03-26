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

📢 Please report any errors or omissions to [`Issues`](https://github.com/SNIPPIK/UnTitles/issues) or [`Discord`](https://discord.gg/qMf2Sv3)

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

## 🎧 What is WatKLOK (UnTitles)?

A high-performance Discord music bot with:
- Instant playback (no delays)
- Smart track matching across platforms
- Seamless transitions (no gaps)
- Stable voice engine even under heavy load

---

> [!WARNING]
> ⚠️ WatKLOK (UnTitles) is a complex technical project maintained exclusively by one author, `SNIPPIK`
> Please respect the authorship and license of the project.
>
> Audio issues
> If your internet is unstable, losses will occur in any case.
> It is impossible to completely eliminate `packet lost` due to the `UDP` protocol and other `discord` limitations.

> [!TIP]
> I recommend enabling the caching system in `.env`. This will allow you to play tracks even if the platform is completely blocked.
> However, the voice system is simply not allowed to lose audio packets, even under critical load!

> [!WARNING]
> If you use a proxy, keep in mind that `FFmpeg` does not support socks. For such tasks, there's [`STH`](https://github.com/SNIPPIK/SHS)
> ⚠️ Some functions require proper environment configuration (FFmpeg, proxy, native modules)
---

### ⚠️ Hardware Requirements | Data from Ryzen 7 5700x3D | 1 player
- CPU: 0-0.1% (`1 cycle` = `50 voice` connections)
- RAM: `~80 MB`, depends on the number of tracks, platform load, and Discord cache!
- 1 ShardManager 20 MB
- 1 Shard 30-40 MB
- 1 Worker 20-30 MB
---

### 🚀 Engine Features (WatKLOK)

#### 🎖️ Event Loop Blocking Resistance
Even when the main Node.js thread is hard blocked, the sound continues playing without lag or distortion.
```ts
// 💣 Event Loop Blocking Test (x4)
setInterval(() => {
const start = performance.now();
while (performance.now() - start < 100) {}
}, 100);
```

#### 💀 What usually happens
* audio starts to crackle
* delays appear
* timing is broken
* playback may stop completely

#### ⚡ In WatKLOK
* stable audio stream
* correct timing
* no distortion
* playback does not depend on the JS event loop
> 📌 The engine uses isolated threads and native audio processing, so blocking JS does not affect playback

#### 🎵 Audio Quality
- No quality loss beyond Discord’s own encoding limits
- **Hot Audio Swap**: System of instant seamless transition between tracks.
- **Audio Effects**: Smooth fade-in/fade-out for any actions (skip, seek, pause)
- **Filters: 16+** built-in **audio filters** with the possibility of easily adding your own via JSON-config [(filters.json)](src/core/player/filters.json)
- **Optimization**: Ability to reuse audio without re-conversion for tracks up to 8 minutes long
- **Synchronization**: Direct synchronization of the audio stream without distortion introduced by software filters.

#### 🦀 Native Voice Engine (Rust Powered)
- **High performance**: The main logic of voice processing is transferred to a native module on Rust (src-rs), which guarantees stability even with high event loop lag in Node.js.
- **Voice engine**: Full implementation of Voice Gateway V8. Stack: UDP + SRTP + Opus.
- **Security**: Support for End-to-End Encryption (E2EE 🔐) via the Discord DAVE protocol.
- **Timers**: Cyclic systems using a timer + auto balancer.
- **Smart streaming**: Does not require external opus encoders for transmission - uses own method of parsing Opus frames.
- **FFmpeg Integration**: Used for flexible audio decoding and application of complex filters.

#### 🌐 Platforms and Parsing
- **Multiplatform**: Support for **YouTube**, **Spotify**, **VK**, **Yandex-Music**, **SoundCloud**, **Deezer**, **Apple (only outline)**.
- **Smart Fallback**: If a track is not available on one platform, the system will automatically find it on another.
- **Related Tracks**: Automatic selection and inclusion of similar tracks for endless listening.
- **Worker Threads**: All heavy search and parsing operations are carried out in separate worker threads so as not to block the main thread of the bot.
- **Extensibility**: Modular architecture through Dynamic Handler allows you to add a new platform in minutes.

#### 🌍 Localization and Typing
- **Languages**: Full support for Русский and English ([**file with languages**](src/structures/locale/languages.json)).
- **DX (Developer Experience)**: The entire project is strictly typed (TypeScript + Rust ABI), comes with a bunch of interfaces and examples.
- **Scalability**: Easy addition of any languages ​​supported by Discord.

#### Cache utility
- **Support**: `Tracks`, `Albums`, `Audios`
- Save in files, later it will be possible to save via FTP, Redis

---

## 🎛 Interface
- Interactive buttons: actions depend on the player's state
- Progress bar support with timecodes
- Responsive UI - no command reuse required

#### 📚 Commands
|   Command | Autocomplete | Arguments                    | Description       |
|----------:|:-------------|:-----------------------------|:------------------|
| `/filter` | ✅            | (off, push, disable)         | Audio filters     |
|   `/play` | ✅            | (query)                      | Playback          |
| `/player` | ✅            | (api, replay, stop, related) | Advanced playback |
| `/volume` | ✅            | value                        | Player volume     |
| `/remove` | ✅            | value                        | Delete track      |
|   `/seek` | ❌            | 00:00, int                   | Rewind track      |
|   `/skip` | ✅            | (back, to, next)             | Skip tracks       |
| `/repeat` | ✅            | type                         | Repeat type       |
|  `/queue` | ✅            | {destroy, list}              | Queue management  |
|  `/voice` | ✅            | (join, leave, tribune)       | Voice channel     |

---
## 🚀 Launch
- Node.js, FFmpeg, and Rust required
- No need to build Rust components! Ready-to-use builds [here](https://github.com/SNIPPIK/UnTitles/actions/workflows/build.yml)
> All parameters should already be in `.env.custom`, so take it and rename it to .env
```shell
# Clone
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Install dependencies
npm i

# If you need to build Rust components
# If you don't want to compile, download the ready-made build and upload everything to the build/native path
npm run build:native

# Build Typescript + settings + start
npm run build && npm run configure && npm run start
```

---
<p>
    <a href="">
      <img src=".github/images/image.png" alt="Title" />
    </a>
</p>

[![TypeScript](https://img.shields.io/badge/typescript-5.9.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/en)
[![Seyfert](https://img.shields.io/badge/seyfert-4.2.2-%23CB3837.svg?style=for-the-badge&logo=seyfert&logoColor=white&color=purple)](https://www.seyfert.dev)
[![WS](https://img.shields.io/badge/ws-8.19.0-%23CB3837.svg?style=for-the-badge&logo=socket&logoColor=white)](https://www.npmjs.com/package/ws)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-8.*.*-%23CB3837.svg?style=for-the-badge&logo=ffmpeg&logoColor=white&color)](https://ffmpeg.org/)
---

## 📊 Project Diagram
- In case you're curious about how the bot is built,
  [<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)