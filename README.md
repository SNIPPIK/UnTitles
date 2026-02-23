<div align="center">
  <h1>🌟 Discord Music Bot</h1>

<h4>Incredible bot with its own voice/audio engine, scalable architecture, multiple filters and support for 6 music platforms.</h4>
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

## 👥 Contributors

- 👤 [`SNIPPIK`](https://github.com/SNIPPIK)

📢 Please report any errors or omissions to [`Issues`](https://github.com/SNIPPIK/UnTitles/issues) or [`Discord`](https://discord.gg/qMf2Sv3)
🚫 The bot doesn't work 24/7 — it may be unavailable!

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/qMf2Sv3)

> [!WARNING]
> ⚠️ WatKLOK (UnTitles) is a complex technical project that is supported exclusively by 1 author by `SNIPPIK`
> Incorrect use, removal of authorship, or attribution will result in the closure of the public repository.
>
> Audio issues
> If your internet connection is unstable, losses will occur regardless.
> It is impossible to completely eliminate `packet lost` due to the `UDP` protocol and other `discord` limitations.

> [!TIP]
> I recommend enabling the caching system in `.env`. This way, you can play tracks even if the platform is completely blocked.
> However, the voice system is simply not allowed to lose audio packets, even under critical load!

> [!WARNING]
> If you use a proxy, keep in mind that `FFmpeg` does not support socks. [`STH`](https://github.com/SNIPPIK/SHS) is available for such tasks.
> Something may not work if you configured it incorrectly!!!
---

### ⚠️ Hardware Requirements | Data from Ryzen 7 5700x3D | 1 player
- CPU: 0-0.1%
- RAM: ~80 MB, depends on the number of tracks, platform load, and Discord cache!
- Disk: ~50 MB, 200 GB is enough for caching (1.5k tracks ~1.2 GB)

---

# 🎧 Key Features
#### 🎖️ Features
- Event loop-resistant, so even in this case, the audio plays smoothly!!!
```ts
setInterval(() => {
  const startBlock = performance.now();
  while (performance.now() - startBlock < 100) {}
}, 60);

setInterval(() => {
  const startBlock = performance.now();
  while (performance.now() - startBlock < 100) {}
}, 80);

setInterval(() => {
  const startBlock = performance.now();
  while (performance.now() - startBlock < 100) {}
}, 120);

setInterval(() => {
  const startBlock = performance.now();
  while (performance.now() - startBlock < 100) {}
}, 100);
```
#### 🔊 Voice Engine
- Implementation of [**Voice Gateway Version 8**](https://discord.com/developers/docs/topics/voice-connections) [`(WebSocket + UDP + SRTP + Opus + Sodium)`](src/core/voice) + [**End-to-End Encryption (E2EE 🔐)**](https://discord.com/developers/docs/topics/voice-connections#endtoend-encryption-dave-protocol)
- Full **SRTP** implementation: `aead_aes256_gcm`, `xchacha20_poly1305` (via libraries)
- A better audio player compared to **open source** solutions
- Does not require any opus encoders/decoders, has its own opus encoder using the parsing method!
- Requires FFmpeg, which is responsible for audio and filters!
- Supported: Autoplay, Repeat, Shuffle, Replay, and other functions.
- Works even with severe event loop lag!
#### 🎵 Audio
- Audio can be reused without conversion if it's less than 8 minutes long.
- Smooth fade-in/fade-out transitions between tracks, even with skip, seek, and other actions.
- Hot audio swap for smooth transitions from one audio track to another.
- 16+ filters, you can add your own without digging into the code [**filters**](src/core/player/filters.json)
- Support for long videos, including Live, is still a bit rough.
- Explicit audio stream synchronization is present, without audio filters!
#### 🌐 Platforms
- Supported: YouTube, Spotify, VK, Yandex Music, SoundCloud, Deezer
- Audio: YouTube, VK, Yandex Music, SoundCloud
- Audio search on other platforms is available, even if the platform doesn't want to serve audio!
- Completely fallback system: no track on one platform will be found on another!
- Related support (including related tracks) is available.
- Platforms run in a separate worker (thread) for better performance.
- Everything is described in detail, with examples and a bunch of interfaces for typing.
- Easy to extend and adding new platforms via the Dynamic Loader - Handler
#### 🌍 Localization
- Available languages: English, Russian ([**language file**](src/structures/locale/languages.json))
- You can add any language supported by Discord

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
## 🚀 Quick Start
> Node.js is required, as well as FFmpeg installed.
> All parameters are specified in `.env`


> [!WARNING]
> Since the project uses Rust, a compiler will be required 
```shell
# Cloning
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Installing dependencies
npm install

# Running via Node.js
# Setting environment variables in .env
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
[![Seyfert](https://img.shields.io/badge/seyfert-4.1.0-%23CB3837.svg?style=for-the-badge&logo=seyfert&logoColor=white&color=purple)](https://www.seyfert.dev)
[![WS](https://img.shields.io/badge/ws-8.18.3-%23CB3837.svg?style=for-the-badge&logo=socket&logoColor=white)](https://www.npmjs.com/package/ws)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-7.*.*-%23CB3837.svg?style=for-the-badge&logo=ffmpeg&logoColor=white&color)](https://ffmpeg.org/)
---

# 📊 Project Diagram
- In case you're curious about how the bot is built,
  [<img align="center" alt="Diagram" width="" src=".github/images/src.png" />](.github/images/src.png)