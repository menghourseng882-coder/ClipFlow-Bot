# 📹 ClipFlow Downloader Bot

A production-ready Telegram Bot to download videos from YouTube, TikTok, and Facebook using Node.js, Telegraf, Express, and `yt-dlp`. 

This bot features a concurrent download queue, automatic platform detection, Telegram upload size limit checks (50MB), automatic file cleanup, and a self-pinging keep-alive system tailored for cloud hosting platforms like Render.

---

## 🚀 Features

- **Multi-Platform Support**: Automatically detects and downloads videos from **YouTube** (including Shorts), **TikTok**, and **Facebook**.
- **Safe Concurrency**: Queue system handles up to 3 concurrent downloads, informing users of their queue position if the queue is full.
- **Telegram Size Protection**: Rejects videos larger than 50MB before uploading to avoid Telegram Bot API errors.
- **Auto-Cleanup**: Instantly deletes all temporary and final download files from the server, even if the download or upload fails.
- **Robust Web Server**: Built-in Express server with a `/health` endpoint to satisfy deployment health checks.
- **Keep-Alive mechanism**: Automatically pings itself every 10 minutes when deployed on Render to keep the free-tier service awake.

---

## 🛠️ Local Development Setup

### Prerequisites
1. **Node.js**: Version 20.0.0 or higher.
2. **Python**: Python 3.7+ (required by `yt-dlp`).
3. **yt-dlp**: Must be installed and available in your system's PATH.
   - *Windows*: Download from the [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) page and add to PATH.
   - *macOS*: `brew install yt-dlp`
   - *Linux*: `sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp`
4. **FFmpeg**: Required by `yt-dlp` for merging high-quality video and audio formats.
   - *macOS*: `brew install ffmpeg`
   - *Windows / Linux*: Download static builds and add them to your PATH.

---

### Running the Bot Locally

1. **Clone the repository** (or navigate to the workspace).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (an example is provided in `.env.example`):
   ```env
   BOT_TOKEN=your_telegram_bot_token
   PORT=3000
   ```
4. **Start the Bot**:
   ```bash
   npm start
   ```
   For development mode:
   ```bash
   npm run dev
   ```

---

## ☁️ Deployment on Render

This project is fully prepared for one-click deployment on Render. It includes a `render.yaml` blueprint that automates setting up the web service and a custom `build.sh` script to install `yt-dlp` and `ffmpeg` inside the Render environment automatically.

### Steps to Deploy:
1. Push this project to a GitHub repository.
2. Log into [Render](https://render.com/).
3. Click **New** -> **Blueprint Route** (or use the Render Blueprint CLI).
4. Select the repository you just created.
5. Render will automatically parse the `render.yaml` file.
6. Provide your **`BOT_TOKEN`** in the Environment variables prompt.
7. Click **Deploy**.

Render will run `build.sh` to download `yt-dlp` and `ffmpeg` into a local `bin` folder, bind the Express server to `PORT` 10000, and launch the bot. The self-pinging feature will automatically activate using the `RENDER_EXTERNAL_URL` env variable.
