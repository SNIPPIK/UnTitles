<div align="center">
  <h1>🌟 Discord Music Bot</h1>

<h4>Incredible bot with its own voice engine, scalable architecture, multiple filters and support for multiple music platforms.</h4>
<h4>Audio quality surpasses lavalink, don't believe me? Listen for yourself!</h4>

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

## 👥 Authors

- 👤 [`SNIPPIK`](https://github.com/SNIPPIK)
- 💡 [`GHOST-OF-THE-ABYSS`](https://github.com/GHOST-OF-THE-ABYSS) — ideas and suggestions

📢 Please report any errors or omissions in [Issues](https://github.com/SNIPPIK/UnTitles/issues)  
🚫 The bot does not work 24/7 — it may be unavailable!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

> [!WARNING]
> ⚠️ WatKLOK (UnTitles) is a complex technical project, which is supported exclusively by 1 author `SNIPPIK`  
> Incorrect use, removal of authorship or appropriation will lead to the closure of the public repository

> [!IMPORTANT]
> If there is no response from YouTube - install `ytdlp-nodejs`. It is strongly recommended to enable caching  
> `main` — stable, but rarely updated branch  
> `beta` — newest fixes and features, may be unstable

---

### ⚠️ Hardware requirements | Data from Ryzen 7 5700x3D | 1 player
- CPU: 0-0.1%
- Ram: ~80 MB, it all depends on the number of tracks, the load on the platforms, namely YouTube!
- Disk: ~50 MB, 200 GB is enough for caching (1.5k tracks ~1.2 GB)

---

# 🎧 Main features
#### 🎖️ Peculiarities
- Not afraid of event loop, even in this case the sound goes quite smoothly
```ts
setInterval(() => {
    const startBlock = performance.now();
    while (performance.now() - startBlock < 100) {}
}, 200);
```
#### 🔊 Voice engine
- [Voice Gateway Version 8](https://discord.com/developers/docs/topics/voice-connections) [`(WebSocket + UDP + SRTP + Opus + Sodium)`](src/core/voice) + [End-to-End Encryption (DAVE Protocol)](https://discord.com/developers/docs/topics/voice-connections#endtoend-encryption-dave-protocol)
- Full **SRTP** implementation: `aead_aes256_gcm`, `xchacha20_poly1305` (via libraries)
- Adaptive packet sending system, works like a **jitter** buffer!
- Works with ready-made **Ogg/Opus** frames!
- **FFmpeg** is required, it is responsible for audio and filters!
- Works even with strong **event loop lag**
#### 🎵 Audio
- Has its own **Ogg/Opus** parser to get pure opus!
- It is possible to reuse audio without conversion if it is less than 8 minutes long
- Smooth **fade-in/fade-out** transition between tracks, even with **skip**, **seek**, **etc**.
- There is a system of smooth transition from one audio to another `Hot audio swap`
- 16+ filters, you can add your own without complex digging in the code [filters](src/core/player/filters.json)
- There is support for long videos, Live video is still raw.
#### 🌐 Platforms
- YouTube, Spotify, VK, Yandex-Music, SoundCloud support
- Platforms work in a separate **worker** (thread) for performance
- Everything is described in detail, there are examples and a bunch of interfaces for typing
- Easy expansion and adding new platforms via `Dynamic Loader - Handler`
#### 🌍 Localization
- Available languages: `English`, `Russian` ([language file](src/structures/locale/languages.json))
- You can add any language supported by discord

---

# 🔩 Other functionality
#### Own system [handlers](src/handlers)
- Universal loader: [`commands`](src/handlers/commands), [`events`](src/handlers/events), [`components`](src/handlers/components), [`middlewares`](src/handlers/middlewares), [`rest`](src/handlers/rest)
- Decorators and interfaces are used, including typing
- Support for "hot" reloading

#### 💡 Adaptive loop
- It is not afraid of **event loop** and **drift**, it just takes them into account not as a problem, but as parameters!
- The loop can work ahead from 0 to 2 ms to process objects in the loop!
- Audio sending is built on it!
- Cycle accuracy `±0.05 ms` with `process.hrtime.bigint` + `performance.now`

#### ⚙️ Internal tools
- [`SetArray`](src/structures/tools/SetArray.ts) - 2 in one Array and Set in one class
- [`Cycle`](src/structures/tools/Cycle.ts) - Manages the message update system and sending audio packets
- [`TypedEmitter`](src/structures/tools/TypedEmitter.ts) - typed `EventEmitterAsyncResource`
- [`SimpleWorker`](src/structures/tools/SimpleWorker.ts) - Class that simplifies working with threads

---

## 🎛 Interface
- Interactive buttons: actions depend on the player state
- Progress bar support with time codes
- Responsive UI - does not require reusing commands

#### 📚 Commands
|   Command | Autocomplete | Arguments                       | Description       |
|----------:|:-------------|:--------------------------------|:------------------|
|    `/api` | ❌            | access:(block, unblock)         | API management    |
|    `/bot` | ❌            | restart:(commands, bot, events) | Restart           |
| `/filter` | ✅            | (off, push, disable)            | Audio filters     |
|   `/play` | ✅            | (api, replay, stop, wave)       | Playback          |
| `/remove` | ✅            | value                           | Delete track      |
|   `/seek` | ❌            | 00:00, int                      | Rewind            |
|   `/skip` | ✅            | (back, to, next)                | Skip              |
| `/avatar` | ✅            | {user}                          | User avatar       |
|  `/voice` | ✅            | (join, leave, tribune)          | Voice channel     |
| `/report` | ❌            | (none)                          | Contact developer |

---
## 🚀 Quick start
> Node.js or Bun is required, as well as FFmpeg installed  
> All configuration is written in `.env`
```shell
# Clone
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Install dependencies
npm install

# Run via Node.js
# configure environment variables in build/.env
npm run build && npm run start

# Run via Bun
# configure environment variables in ./env
npm i dotenv
bun run start-bun
```

---
[![TypeScript](https://img.shields.io/badge/typescript-5.8.3-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/bun-1.2.15-6DA55F?style=for-the-badge&logo=bun&logoColor=white&color=white)](https://bun.com/)
[![NodeJS](https://img.shields.io/badge/node.js-23.0.0-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/en)
[![Discord.js](https://img.shields.io/badge/discord.js-14.21-%23CB3837.svg?style=for-the-badge&logo=discord.js&logoColor=white&color=purple)](https://discord.js.org/)
[![WS](https://img.shields.io/badge/ws-8.18.3-%23CB3837.svg?style=for-the-badge&logo=socket&logoColor=white)](https://www.npmjs.com/package/ws)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-7.*.*-%23CB3837.svg?style=for-the-badge&logo=ffmpeg&logoColor=white&color)](https://ffmpeg.org/)
---

# 📊 Diagram of the entire project
- In case you are interested in how the bot is built
[<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)