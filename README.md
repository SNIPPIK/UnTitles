<div align="center">
<h1>WatKLOK</h1>
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

The project is developed and maintained by a single author.

* 👤 **[SNIPPIK](https://github.com/SNIPPIK)**

### 💬 Feedback

If you find a bug, encounter unexpected behavior, or have an idea for an improvement — please open an **Issue** or join the **Discord server**.

* 🐞 **Issues:** https://github.com/SNIPPIK/Untitles/issues
* 💬 **Discord:** https://discord.gg/qMf2Sv3

[![Invite](https://img.shields.io/badge/Add%20the%20bot-%235865F2.svg?style=for-the-badge\&logo=discord\&logoColor=white)](https://discord.com/oauth2/authorize?client_id=623170593268957214)
[![Server](https://img.shields.io/badge/Support%20Server-%235865F2.svg?style=for-the-badge\&logo=discord\&logoColor=white)](https://discord.gg/qMf2Sv3)
-------------------------------------------------------------------------------------------------------------------------------------------------------

> [!IMPORTANT]
> **WatKLOK (UnTitles)** is a fully open-source project currently developed and maintained by a single person. Therefore, the release of fixes and new features depends on the author's available time.

> [!NOTE]
> Some features require additional environment configuration to work correctly (for example, **FFmpeg**, **native modules**, **proxy**, and other dependencies).

> [!WARNING]
> When using a proxy, keep in mind that **FFmpeg** does not support the **SOCKS** protocol. For such scenarios, using **[STH](https://github.com/SNIPPIK/SHS)** is recommended.

---

## 🦀 Native Voice Engine (Rust Powered)

The core voice traffic processing logic is implemented as a native **Rust** module (`rs`). Critical operations run independently of the main Node.js event loop, allowing the voice engine to continue operating even under heavy main-thread load.

* **Voice Engine** — custom implementation of Discord Voice processing: `UDP` + `SRTP` + `Opus`.
* **Security** — support for **End-to-End Encryption (E2EE 🔐)** through the **Discord DAVE** protocol.
* **Timing & Scheduler** — a native cyclic system with precise timing and automatic workload distribution across active voice sessions.
* **Opus** — processing and transmission of Opus frames without requiring an external Opus encoder during the sending stage.
* **FFmpeg Integration** — used for audio decoding, stream conversion, and applying complex audio filters. The order in which filters are applied may affect the final output.

---

## 🌐 Platforms & Parsing

The project supports **YouTube**, **Spotify**, **VK**, **Yandex Music**, **SoundCloud**, **Deezer**, and **Apple Music** *(in development)*.

* **Smart Fallback** — if a track is unavailable on one platform, the system can automatically find an alternative source on another.
* **Related Tracks** — automatically searches for and adds similar tracks to continue playback.
* **Worker Threads** — resource-intensive search and parsing operations are executed in separate worker threads without blocking the main Node.js thread.
* **Extensibility** — a modular architecture based on `Dynamic Handler` allows new platforms to be added without modifying the core player logic.

---

## 🌍 Localization & Typing

* **Localization** — full support for **Russian and English**. Localization files are located in [`languages.json`](src/structures/utils/locale/languages.json).
* **DX (Developer Experience)** — the project is fully typed using **TypeScript**, with a typed interface for Rust communication through N-API.
* **Extensibility** — the localization architecture allows new languages to be added without modifying command or interface logic.

## 🎖️ Event Loop Blocking Resilience

The voice engine runs inside a native Rust module and does not depend on the Node.js event loop for its critical processing and audio transmission cycle.

Even under significant load or temporary blocking of the main Node.js thread, already-running playback continues to be processed by the native voice engine.

This separates the **Node.js control logic** from the **critical audio pipeline**, minimizing the impact of event loop delays on playback stability.

<details>
<summary>Click to expand</summary>

```ts
// 💣 Event Loop Blocking Test (x4)
for (let i = 0; i < 4; i++) {
  setInterval(() => {
    const start = performance.now();
    while (performance.now() - start < 100) {}
  }, 100 + (i * 10));
}
```

<p>
    <a href="">
      <img src=".github/images/ELLx4.png" alt="Title" />
    </a>
  </p>
</details>

---

## 🎵 [`Audio Quality`](https://youtu.be/SwmPmEEDI58)

* **No artificial bitrate limitations** — the audio pipeline does not impose a bitrate limit on the source material. In theory, a stream with a bitrate higher than Discord's standard capabilities can be passed through, although the actual quality is ultimately limited by Discord itself and the audio codec in use.
* **Hot Audio Swap** — instant and seamless switching between audio streams without noticeable gaps between tracks.
* **Audio Effects** — smooth `fade-in` / `fade-out` transitions when switching tracks and performing `skip`, `seek`, and `pause` actions.
* **Audio Filters** — more than 16 built-in audio filters with the ability to easily add custom filters through the JSON configuration file [`filters.json`](src/core/player/filters.json).
* **Synchronization** — precise synchronization of the audio stream and its processing without additional artifacts caused by track switching or filter application.

> [!WARNING]
> WatKLOK cannot guarantee that no packets will be lost after audio data is sent to Discord.
>
> Packet loss can occur anywhere along the network path between the bot, Discord servers, and the client. An unstable internet connection on the client side may result in dropouts or cause Opus to conceal lost frames.
>
> Packet loss cannot be completely eliminated due to the nature of UDP and Discord's network infrastructure. However, packet loss originating directly within the bot's audio pipeline should not be masked as a network issue — playback status is displayed in the current track message.

---

## 🎛 Interface

* **Interactive Controls** — available buttons and actions automatically change depending on the current player state.
* **Progress Bar** — displays the current track position and playback timestamps.
* **Responsive Interface** — core actions are available directly from the player and do not require additional commands.
* **Queue Management** — viewing, removing, and skipping tracks are available directly from the interface.
* **Playback Control** — supports repeat modes, seeking, volume adjustment, and audio filters.

#### 📚 Commands

<details>
<summary>Click to expand</summary>

| Command         | Autocomplete | Arguments                  | Description                            |
| :-------------- | :----------: | :------------------------- | :------------------------------------- |
| `/filter`       |       ✅      | `off`, `push`, `disable`   | Manage audio filters                   |
| `/play`         |       ✅      | `query`                    | Play a track or search by query        |
| `/play search`  |       ✅      | `platform`, `query`        | Search and play on a specific platform |
| `/play radio`   |       ✅      | `query`                    | Play an internet radio station         |
| `/play related` |       ✅      | `platform`, `query`        | Search for and play related tracks     |
| `/player`       |       ✅      | `replay`, `stop`, `volume` | Advanced player controls               |
| `/volume`       |       ✅      | `value`                    | Change player volume                   |
| `/remove`       |       ✅      | `value`                    | Remove a track from the queue          |
| `/seek`         |       ❌      | `00:00`, `int`             | Seek within the current track          |
| `/skip`         |       ✅      | `back`, `to`, `next`       | Switch or skip tracks                  |
| `/repeat`       |       ✅      | `type`                     | Configure repeat mode                  |
| `/queue`        |       ✅      | `destroy`, `list`          | Manage the playback queue              |
| `/voice`        |       ✅      | `join`, `leave`, `tribune` | Manage the voice channel               |
| `/status`       |       ❌      | —                          | View bot status                        |
| `/reload`       |       ❌      | —                          | Reload bot systems                     |

</details>

---

## 🚀 Getting Started

### Requirements

The following are required to run the project:

* **Node.js**
* **FFmpeg**
* **Rust** — only if you need to build the native components yourself

> Building the Rust components yourself is **not required**. Pre-built native binaries are available through [GitHub Actions](https://github.com/SNIPPIK/UnTitles/actions/workflows/build.yml).

### Installation

```shell
# Clone the repository
git clone https://github.com/SNIPPIK/UnTitles
cd UnTitles

# Install dependencies
npm install

# Configure the environment
cp .env.custom .env
```

> All required parameters should already be present in `.env.custom`. Before starting the project, simply copy it to `.env` and provide your token. Other values can be changed if necessary.

### Building Native Components

If Rust is installed and you want to build the native components yourself:

```shell
npm run build:native
```

If you do not need to build the Rust components yourself, you can use the pre-built binaries from [GitHub Actions](https://github.com/SNIPPIK/UnTitles/actions/workflows/build.yml).

The resulting native modules should be placed in:

```text
build/native
```

### Build & Run

After installing the dependencies and preparing the native components:

```shell
# Build TypeScript
npm run build

# Start
npm run start
```

Or with a single command:

```shell
npm run build && npm run start
```
