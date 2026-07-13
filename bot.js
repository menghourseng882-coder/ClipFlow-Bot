require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Verify token exists
if (!process.env.BOT_TOKEN) {
  console.error('CRITICAL ERROR: BOT_TOKEN is not set in environment variables.');
  process.exit(1);
}

// Prepend local bin directory to PATH so node can find yt-dlp and ffmpeg downloaded during build/startup
const binPath = path.join(__dirname, 'bin');
const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
process.env[pathKey] = `${binPath}${path.delimiter}${process.env[pathKey] || ''}`;

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Helper: Download a file following redirects
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    function get(requestUrl) {
      const protocol = requestUrl.startsWith('https') ? https : http;
      protocol.get(requestUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          get(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`Server returned status code: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

// Helper: Check for yt-dlp in PATH or local bin, and download it if missing
async function ensureYtDlp() {
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binPath, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const ext = isWindows ? '.exe' : '';
  const localBinaryPath = path.join(binPath, `yt-dlp${ext}`);

  // 1. Check if yt-dlp is in system PATH
  let inPath = false;
  try {
    const checkCmd = isWindows ? 'where yt-dlp' : 'which yt-dlp';
    execSync(checkCmd, { stdio: 'ignore' });
    inPath = true;
    console.log('[Startup] yt-dlp found in system PATH.');
  } catch (e) {
    // Not in PATH
  }

  // 2. Check if already downloaded locally
  if (!inPath && fs.existsSync(localBinaryPath)) {
    console.log(`[Startup] yt-dlp found locally in bin folder: ${localBinaryPath}`);
    return;
  }

  if (inPath) return;

  // 3. Download if missing
  console.log('[Startup] yt-dlp is missing. Initiating automatic download...');
  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  if (isWindows) {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (isMac) {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  try {
    await downloadFile(downloadUrl, localBinaryPath);
    fs.chmodSync(localBinaryPath, '755');
    console.log(`[Startup] yt-dlp successfully downloaded to: ${localBinaryPath}`);
  } catch (err) {
    console.error('[Startup] Failed to download yt-dlp automatically:', err.message);
    console.error('[Startup] Please install yt-dlp manually as specified in the README.md.');
  }
}

// Helper: Check for ffmpeg in PATH or local bin, and download it if missing
async function ensureFfmpeg() {
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binPath, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const ext = isWindows ? '.exe' : '';
  const localFfmpegPath = path.join(binPath, `ffmpeg${ext}`);
  const localFfprobePath = path.join(binPath, `ffprobe${ext}`);

  // 1. Check if ffmpeg is in system PATH
  let inPath = false;
  try {
    const checkCmd = isWindows ? 'where ffmpeg' : 'which ffmpeg';
    execSync(checkCmd, { stdio: 'ignore' });
    inPath = true;
    console.log('[Startup] ffmpeg found in system PATH.');
  } catch (e) {
    // Not in PATH
  }

  // 2. Check if already downloaded locally
  if (!inPath && fs.existsSync(localFfmpegPath) && fs.existsSync(localFfprobePath)) {
    console.log(`[Startup] ffmpeg and ffprobe found locally in bin folder.`);
    return;
  }

  if (inPath) return;

  // 3. Download if missing
  console.log('[Startup] ffmpeg is missing. Initiating automatic download...');
  
  if (isWindows) {
    const downloadUrl = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    const zipPath = path.join(binPath, 'ffmpeg.zip');
    const tempExtractPath = path.join(binPath, 'ffmpeg-temp');
    
    try {
      await downloadFile(downloadUrl, zipPath);
      console.log('[Startup] Downloaded ffmpeg.zip. Extracting...');
      
      if (fs.existsSync(tempExtractPath)) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractPath, { recursive: true });
      
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempExtractPath}' -Force"`);
      
      const extractedDirs = fs.readdirSync(tempExtractPath);
      const mainDir = extractedDirs.find(d => d.includes('ffmpeg'));
      if (mainDir) {
        const srcFfmpeg = path.join(tempExtractPath, mainDir, 'bin', 'ffmpeg.exe');
        const srcFfprobe = path.join(tempExtractPath, mainDir, 'bin', 'ffprobe.exe');
        
        fs.copyFileSync(srcFfmpeg, localFfmpegPath);
        fs.copyFileSync(srcFfprobe, localFfprobePath);
        console.log('[Startup] ffmpeg and ffprobe extracted successfully.');
      } else {
        throw new Error('Could not find ffmpeg folder in extracted zip.');
      }
    } catch (err) {
      console.error('[Startup] Failed to download/extract ffmpeg for Windows:', err.message);
    } finally {
      if (fs.existsSync(zipPath)) {
        try { fs.unlinkSync(zipPath); } catch (e) {}
      }
      if (fs.existsSync(tempExtractPath)) {
        try { fs.rmSync(tempExtractPath, { recursive: true, force: true }); } catch (e) {}
      }
    }
  } else if (isMac) {
    console.log('[Startup] macOS detected. Please install ffmpeg manually via brew if needed (brew install ffmpeg).');
  } else {
    // Linux
    const downloadUrl = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
    const tarPath = path.join(binPath, 'ffmpeg.tar.xz');
    const tempExtractPath = path.join(binPath, 'ffmpeg-temp');
    
    try {
      await downloadFile(downloadUrl, tarPath);
      console.log('[Startup] Downloaded ffmpeg.tar.xz. Extracting...');
      
      if (fs.existsSync(tempExtractPath)) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractPath, { recursive: true });
      
      execSync(`tar -xf "${tarPath}" -C "${tempExtractPath}" --strip-components=1`);
      
      const srcFfmpeg = path.join(tempExtractPath, 'bin', 'ffmpeg');
      const srcFfprobe = path.join(tempExtractPath, 'bin', 'ffprobe');
      
      fs.copyFileSync(srcFfmpeg, localFfmpegPath);
      fs.copyFileSync(srcFfprobe, localFfprobePath);
      
      fs.chmodSync(localFfmpegPath, '755');
      fs.chmodSync(localFfprobePath, '755');
      console.log('[Startup] ffmpeg and ffprobe extracted successfully.');
    } catch (err) {
      console.error('[Startup] Failed to download/extract ffmpeg for Linux:', err.message);
    } finally {
      if (fs.existsSync(tarPath)) {
        try { fs.unlinkSync(tarPath); } catch (e) {}
      }
      if (fs.existsSync(tempExtractPath)) {
        try { fs.rmSync(tempExtractPath, { recursive: true, force: true }); } catch (e) {}
      }
    }
  }
}

// Express server configuration for health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    activeDownloads,
    queueLength: queue.length,
  });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Initialize Telegraf Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Concurrency Queue implementation
const queue = [];
let activeDownloads = 0;
const MAX_CONCURRENT = 3;

function enqueueDownload(downloadTask) {
  return new Promise((resolve, reject) => {
    queue.push({ downloadTask, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  if (activeDownloads >= MAX_CONCURRENT || queue.length === 0) {
    return;
  }
  
  const { downloadTask, resolve, reject } = queue.shift();
  activeDownloads++;
  
  downloadTask()
    .then(result => resolve(result))
    .catch(error => reject(error))
    .finally(() => {
      activeDownloads--;
      processQueue();
    });
}

// Helper: Parse and validate URLs
function getValidUrl(urlStr) {
  let url = urlStr.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
}

// Helper: Detect the video hosting platform
function detectPlatform(parsedUrl) {
  if (!parsedUrl) return null;
  const host = parsedUrl.hostname.toLowerCase();
  
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return 'YouTube';
  }
  if (host.includes('tiktok.com')) {
    return 'TikTok';
  }
  if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) {
    return 'Facebook';
  }
  return null;
}

// Helper: Run yt-dlp inside child_process
function runYtDlp(url, outputTemplate, option) {
  return new Promise((resolve, reject) => {
    // Check if ffmpeg is available in system PATH or local bin folder
    let ffmpegExists = false;
    try {
      const checkCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
      execSync(checkCmd, { stdio: 'ignore' });
      ffmpegExists = true;
    } catch (e) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      if (fs.existsSync(path.join(binPath, `ffmpeg${ext}`))) {
        ffmpegExists = true;
      }
    }

    const args = [
      '--no-playlist',
      '--max-filesize', '50M',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=default,-android_sdkless',
      '-o', outputTemplate,
    ];

    if (option === 'mp3') {
      if (ffmpegExists) {
        args.push(
          '-f', 'bestaudio/best',
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0'
        );
      } else {
        args.push('-f', 'bestaudio/best');
      }
    } else {
      // Option is video format: 360p, 480p, 720p, or 1080p
      const height = option.replace('p', '');
      
      if (ffmpegExists) {
        // Enforce maximum size limit in format selection and recode video to H.264 MP4 to guarantee Telegram compatibility
        args.push(
          '-f', `bestvideo[height<=${height}][filesize<=?50M][filesize_approx<=?50M]+bestaudio[filesize<=?50M][filesize_approx<=?50M]/best[height<=${height}][filesize<=?50M][filesize_approx<=?50M]`,
          '--merge-output-format', 'mp4',
          '--recode-video', 'mp4'
        );
      } else {
        args.push(
          '-f', `best[height<=${height}][filesize<=?50M][filesize_approx<=?50M]/best[height<=${height}]`
        );
      }
    }

    args.push(url);

    const ext = process.platform === 'win32' ? '.exe' : '';
    const localBinaryPath = path.join(binPath, `yt-dlp${ext}`);
    const binaryToRun = fs.existsSync(localBinaryPath) ? localBinaryPath : 'yt-dlp';

    console.log(`[Spawn] ffmpeg detected: ${ffmpegExists}. Running: ${binaryToRun} ${args.slice(0, -1).join(' ')} "${url}"`);

    // 5 minutes timeout to prevent hanging downloads
    execFile(binaryToRun, args, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      resolve({ stdout, stderr });
    });
  });
}

// Helper: Clean up files matching the uniquePrefix in the directory
function cleanUpFiles(dir, uniquePrefix) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(uniquePrefix)) {
        const filePath = path.join(dir, file);
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted temporary file: ${filePath}`);
      }
    }
  } catch (error) {
    console.error(`[Cleanup Error] Failed cleaning up prefix ${uniquePrefix}:`, error);
  }
}

// Helper: Upload media with retry (up to 3 attempts) in case of transient Telegram network/gateway errors
async function uploadMediaWithRetry(ctx, type, source, extra, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      if (type === 'audio') {
        return await ctx.replyWithAudio(source, extra);
      } else {
        return await ctx.replyWithVideo(source, extra);
      }
    } catch (err) {
      console.warn(`[Upload Attempt ${i}/${attempts} Failed]:`, err.message || err);
      if (i === attempts) throw err;
      // Wait 3 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Helper: Fetch TikTok metadata from TikWM API
function fetchTikWmData(url) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    
    https.get(apiUrl, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.code === 0 && parsed.data) {
            resolve(parsed.data);
          } else {
            reject(new Error(parsed.msg || 'Failed to fetch TikWM API.'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Bot Command: /start
bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to ClipFlow Bot!\n\n` +
    `I can download videos from:\n` +
    `• YouTube (including Shorts)\n` +
    `• TikTok\n` +
    `• Facebook\n\n` +
    `Simply send me a video link, and I will download it and send it to you!\n\n` +
    `⚠️ Maximum file size limit: 50MB (Telegram Bot API restriction).`
  );
});

// Bot Command: /help
bot.help((ctx) => {
  ctx.reply(
    `ℹ️ How to use ClipFlow Bot:\n\n` +
    `1. Copy a video link from YouTube, TikTok, or Facebook.\n` +
    `2. Paste and send the link here.\n` +
    `3. Wait for the download to complete and enjoy!\n\n` +
    `⚙️ Technical Limits:\n` +
    `• Videos must be under 50MB to upload to Telegram.\n` +
    `• Single videos only (playlists are not supported).`
  );
});

// URL Session cache for handling callback queries
const urlStore = new Map();

// Periodic cleanup of the urlStore cache (runs every 10 minutes, expires keys after 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of urlStore.entries()) {
    if (now - value.createdAt > 3600000) {
      urlStore.delete(key);
    }
  }
}, 600000);

// Bot Message Handler
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  
  // Skip command processing if handled by start/help
  if (text.startsWith('/')) return;

  // Extract first URL in message
  const urlPattern = /(https?:\/\/[^\s]+)/i;
  const match = text.match(urlPattern);
  
  if (!match) {
    return ctx.reply('❌ Please send a valid video URL (from YouTube, TikTok, or Facebook).').catch(() => {});
  }
  
  const url = match[1];
  const parsedUrl = getValidUrl(url);
  const platform = detectPlatform(parsedUrl);
  
  if (!platform) {
    return ctx.reply('❌ Unsupported platform. I only support YouTube, TikTok, and Facebook links.').catch(() => {});
  }

  // Create unique session ID and cache URL details
  const shortId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
  const cacheItem = {
    url,
    platform,
    messageId: ctx.message.message_id,
    createdAt: Date.now()
  };

  let isSlideshow = false;
  if (platform === 'TikTok') {
    try {
      // Fetch TikTok metadata with a 3-second timeout limit to prevent hanging the chat
      const tikwmData = await Promise.race([
        fetchTikWmData(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      
      let images = [];
      if (tikwmData.images && Array.isArray(tikwmData.images)) {
        images = tikwmData.images;
      } else if (tikwmData.image_post_info && tikwmData.image_post_info.images && Array.isArray(tikwmData.image_post_info.images)) {
        images = tikwmData.image_post_info.images.map(img => {
          if (typeof img === 'string') return img;
          if (img.url_list && Array.isArray(img.url_list)) return img.url_list[0];
          if (img.display_image && img.display_image.url_list && Array.isArray(img.display_image.url_list)) return img.display_image.url_list[0];
          return null;
        }).filter(Boolean);
      }

      if (images.length > 0) {
        isSlideshow = true;
        cacheItem.slideshowImages = images;
      }
      cacheItem.tiktokVideoUrl = tikwmData.play;
      cacheItem.tiktokAudioUrl = tikwmData.music || (tikwmData.music_info && tikwmData.music_info.play);
    } catch (err) {
      console.warn('[TikTok API warning] Failed to check slideshow status, defaulting to standard video flow:', err.message);
    }
  }

  urlStore.set(shortId, cacheItem);

  // Reply with format & quality choices
  let keyboard;
  if (isSlideshow) {
    keyboard = {
      inline_keyboard: [
        [
          { text: '📷 Download All Photos', callback_data: `dl:${shortId}:photos` }
        ],
        [
          { text: '🎵 Download MP3 Audio', callback_data: `dl:${shortId}:mp3` }
        ]
      ]
    };
  } else {
    keyboard = {
      inline_keyboard: [
        [
          { text: '🎵 MP3 (Audio)', callback_data: `dl:${shortId}:mp3` }
        ],
        [
          { text: '🎬 MP4 (360p)', callback_data: `dl:${shortId}:360p` },
          { text: '🎬 MP4 (480p)', callback_data: `dl:${shortId}:480p` }
        ],
        [
          { text: '🎬 MP4 (720p)', callback_data: `dl:${shortId}:720p` },
          { text: '🎬 MP4 (1080p)', callback_data: `dl:${shortId}:1080p` }
        ]
      ]
    };
  }

  await ctx.reply('👉 Please select your desired format and quality:', {
    reply_markup: keyboard,
    reply_to_message_id: ctx.message.message_id
  }).catch(() => {});
});

// Bot Callback Query Handler (handles button clicks)
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data || !data.startsWith('dl:')) return;

  // Answer callback query immediately to stop loading spinner on the button
  await ctx.answerCbQuery().catch(() => {});

  const parts = data.split(':');
  if (parts.length < 3) return;

  const shortId = parts[1];
  const option = parts[2]; // 'mp3', '360p', '480p', '720p'

  const storeItem = urlStore.get(shortId);
  if (!storeItem) {
    return ctx.reply('❌ This link session has expired or the server was restarted. Please send the link again.').catch(() => {});
  }

  const { url, platform, messageId, slideshowAudioUrl, slideshowImages, tiktokVideoUrl, tiktokAudioUrl } = storeItem;

  // Send status message to inform user
  const statusMsg = await ctx.reply('⏳ Validating link and checking queue status...').catch(() => null);
  if (!statusMsg) return;

  const downloadTask = async () => {
    // Check if it is a custom slideshow photos task
    if (option === 'photos' && slideshowImages && slideshowImages.length > 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `⏳ Downloading slideshow photos (0/${slideshowImages.length})...`
      ).catch(() => {});

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const uniqueId = `slideshow_${timestamp}_${randomSuffix}`;
      const tempPaths = [];

      try {
        // Download all images locally
        for (let i = 0; i < slideshowImages.length; i++) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `⏳ Downloading slideshow photos (${i + 1}/${slideshowImages.length})...`
          ).catch(() => {});

          const imgUrl = slideshowImages[i];
          const tempPath = path.join(downloadsDir, `${uniqueId}_${i}.jpg`);
          await downloadFile(imgUrl, tempPath);
          tempPaths.push(tempPath);
        }

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📤 Uploading photos to Telegram...`
        ).catch(() => {});

        // Send images in chunks of 10
        for (let i = 0; i < tempPaths.length; i += 10) {
          const chunk = tempPaths.slice(i, i + 10).map(filePath => ({
            type: 'photo',
            media: { source: filePath }
          }));
          await ctx.replyWithMediaGroup(chunk, { reply_to_message_id: messageId }).catch(async () => {
            // Fallback without reply_to_message_id
            return await ctx.replyWithMediaGroup(chunk).catch(() => {});
          });
        }

        // Delete status message
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        console.log(`[Success] Slideshow photos successfully sent to user.`);
      } catch (err) {
        console.error(`[Failure] Error downloading/uploading slideshow photos:`, err);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          '❌ Failed to download slideshow photos. Please try again.'
        ).catch(() => {});
      } finally {
        // Cleanup temp images
        cleanUpFiles(downloadsDir, uniqueId);
      }
      return;
    }

    // Check if it is a slideshow MP3 task (download directly bypassing yt-dlp)
    if (option === 'mp3' && slideshowAudioUrl) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `⏳ Downloading slideshow audio...`
      ).catch(() => {});

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const uniqueId = `slideshow_audio_${timestamp}_${randomSuffix}`;
      const filePath = path.join(downloadsDir, `${uniqueId}.mp3`);

      try {
        await downloadFile(slideshowAudioUrl, filePath);
        
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        console.log(`[Slideshow Audio] Finished download. File size: ${fileSizeMB.toFixed(2)} MB`);

        if (fileSizeMB > 50) {
          throw new Error('Slideshow audio exceeds Telegram limit of 50MB.');
        }

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📤 Uploading audio to Telegram...`
        ).catch(() => {});

        const extraOptions = {
          caption: `🎵 Audio track from TikTok slideshow\n\nDownloaded via @ClipFlowDLBot`,
          reply_to_message_id: messageId
        };

        await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, extraOptions).catch(async () => {
          const fallbackOptions = { ...extraOptions };
          delete fallbackOptions.reply_to_message_id;
          return await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, fallbackOptions);
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        console.log(`[Success] Slideshow audio successfully sent to user.`);
      } catch (err) {
        console.error(`[Failure] Error downloading/uploading slideshow audio:`, err);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          '❌ Failed to download slideshow audio. Please try again.'
        ).catch(() => {});
      } finally {
        cleanUpFiles(downloadsDir, uniqueId);
      }
      return;
    }

    // Check if it is a TikTok video download (bypassing yt-dlp to avoid age blocks and challenges)
    if (option !== 'mp3' && option !== 'photos' && platform === 'TikTok' && tiktokVideoUrl) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `⏳ Downloading MP4 video from TikTok...`
      ).catch(() => {});

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const uniqueId = `tiktok_video_${timestamp}_${randomSuffix}`;
      const filePath = path.join(downloadsDir, `${uniqueId}.mp4`);

      try {
        await downloadFile(tiktokVideoUrl, filePath);
        
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        console.log(`[TikTok Video] Finished download. File size: ${fileSizeMB.toFixed(2)} MB`);

        if (fileSizeMB > 50) {
          throw new Error('TikTok video exceeds Telegram limit of 50MB.');
        }

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📤 Uploading video to Telegram...`
        ).catch(() => {});

        const extraOptions = {
          caption: `📹 Video downloaded from TikTok\n\nDownloaded via @ClipFlowDLBot`,
          reply_to_message_id: messageId
        };

        await uploadMediaWithRetry(ctx, 'video', { source: filePath }, extraOptions).catch(async () => {
          const fallbackOptions = { ...extraOptions };
          delete fallbackOptions.reply_to_message_id;
          return await uploadMediaWithRetry(ctx, 'video', { source: filePath }, fallbackOptions);
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        console.log(`[Success] TikTok video successfully sent to user.`);
      } catch (err) {
        console.error(`[Failure] Error downloading/uploading TikTok video:`, err);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          '❌ Failed to download TikTok video. Please try again.'
        ).catch(() => {});
      } finally {
        cleanUpFiles(downloadsDir, uniqueId);
      }
      return;
    }

    // Check if it is a TikTok MP3 audio download (bypassing yt-dlp)
    if (option === 'mp3' && platform === 'TikTok' && tiktokAudioUrl) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `⏳ Downloading audio track from TikTok...`
      ).catch(() => {});

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const uniqueId = `tiktok_audio_${timestamp}_${randomSuffix}`;
      const filePath = path.join(downloadsDir, `${uniqueId}.mp3`);

      try {
        await downloadFile(tiktokAudioUrl, filePath);
        
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        console.log(`[TikTok Audio] Finished download. File size: ${fileSizeMB.toFixed(2)} MB`);

        if (fileSizeMB > 50) {
          throw new Error('TikTok audio exceeds Telegram limit of 50MB.');
        }

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📤 Uploading audio to Telegram...`
        ).catch(() => {});

        const extraOptions = {
          caption: `🎵 Audio downloaded from TikTok\n\nDownloaded via @ClipFlowDLBot`,
          reply_to_message_id: messageId
        };

        await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, extraOptions).catch(async () => {
          const fallbackOptions = { ...extraOptions };
          delete fallbackOptions.reply_to_message_id;
          return await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, fallbackOptions);
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        console.log(`[Success] TikTok audio successfully sent to user.`);
      } catch (err) {
        console.error(`[Failure] Error downloading/uploading TikTok audio:`, err);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          '❌ Failed to download TikTok audio. Please try again.'
        ).catch(() => {});
      } finally {
        cleanUpFiles(downloadsDir, uniqueId);
      }
      return;
    }

    // Update status to Downloading
    const formatName = option === 'mp3' ? 'MP3' : `MP4 (${option})`;
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `⏳ Downloading ${formatName} from ${platform}...`
    ).catch(() => {});

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const uniqueId = `dl_${timestamp}_${randomSuffix}`;
    const outputTemplate = path.join(downloadsDir, `${uniqueId}.%(ext)s`);
    
    console.log(`[Queue] Active: ${activeDownloads}/${MAX_CONCURRENT}. Starting: ${url} (${platform}) [Option: ${option}]`);
    const startTime = Date.now();
    let filePath = null;

    try {
      // Execute Download
      await runYtDlp(url, outputTemplate, option);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Locate the downloaded file
      const files = fs.readdirSync(downloadsDir);
      const downloadedFile = files.find(file => 
        file.startsWith(uniqueId) && 
        !file.endsWith('.part') && 
        !file.endsWith('.ytdl')
      );

      if (!downloadedFile) {
        throw new Error('Downloaded file not found on disk.');
      }

      // If video download was requested, but we only got an audio or other non-video extension (because video stream exceeded 50MB limit and was skipped)
      if (option !== 'mp3' && !downloadedFile.endsWith('.mp4')) {
        throw new Error('Could not download video within the 50MB limit.');
      }

      filePath = path.join(downloadsDir, downloadedFile);
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`[Queue] Finished download in ${duration}s. File size: ${fileSizeMB.toFixed(2)} MB`);

      // File Size Check
      if (fileSizeMB > 50) {
        throw new Error(`The file is ${fileSizeMB.toFixed(1)}MB, which exceeds Telegram's 50MB upload limit.`);
      }

      // Update status to Uploading
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `📤 Uploading ${formatName} to Telegram...`
      ).catch(() => {});

      // Send appropriate media type
      const extraOptions = {
        caption: option === 'mp3'
          ? `🎵 Audio downloaded from ${platform}\n\nDownloaded via @ClipFlowDLBot`
          : `📹 Video (${option}) downloaded from ${platform}\n\nDownloaded via @ClipFlowDLBot`,
        reply_to_message_id: messageId
      };

      if (option === 'mp3' || downloadedFile.endsWith('.mp3')) {
        await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, extraOptions).catch(async () => {
          // Fallback without reply_to_message_id
          const fallbackOptions = { ...extraOptions };
          delete fallbackOptions.reply_to_message_id;
          return await uploadMediaWithRetry(ctx, 'audio', { source: filePath }, fallbackOptions);
        });
      } else {
        await uploadMediaWithRetry(ctx, 'video', { source: filePath }, extraOptions).catch(async () => {
          // Fallback without reply_to_message_id
          const fallbackOptions = { ...extraOptions };
          delete fallbackOptions.reply_to_message_id;
          return await uploadMediaWithRetry(ctx, 'video', { source: filePath }, fallbackOptions);
        });
      }

      // Cleanup Status message
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      console.log(`[Success] Media successfully sent to user.`);
    } catch (err) {
      console.error(`[Failure] Error downloading/uploading video:`, err);
      
      let friendlyError = '❌ Failed to download. Please verify the link is public, accessible, and try again.';
      const errStr = `${err.message || ''} ${err.stdout || ''} ${err.stderr || ''}`;
      
      if (err.message && err.message.includes('exceeds Telegram\'s 50MB upload limit')) {
        friendlyError = `❌ ${err.message}`;
      } else if (errStr.includes('larger than max-filesize') || errStr.includes('File is larger than')) {
        friendlyError = `❌ The file exceeds Telegram's 50MB upload limit.`;
      } else if (errStr.includes('confirm your age') || errStr.includes('Sign in to confirm your age')) {
        friendlyError = `❌ Video requires age confirmation and cannot be downloaded.`;
      } else if (errStr.includes('Private video') || errStr.includes('private')) {
        friendlyError = `❌ This video is private or restricted.`;
      }
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        friendlyError
      ).catch(() => {
        ctx.reply(friendlyError).catch(() => {});
      });
    } finally {
      // Ensure all temporary files with this uniqueId are deleted
      cleanUpFiles(downloadsDir, uniqueId);
    }
  };

  // If queue is busy, notify user of their position
  if (activeDownloads >= MAX_CONCURRENT) {
    const queuePosition = queue.length + 1;
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `⏳ Queue is full. You are at position #${queuePosition}. Waiting for download to start...`
    ).catch(() => {});
  }

  // Push to queue
  enqueueDownload(downloadTask);
});

// Ensure yt-dlp and ffmpeg are present and launch Telegraf Bot
Promise.all([ensureYtDlp(), ensureFfmpeg()])
  .then(() => bot.launch())
  .then(() => {
    console.log('Telegram Bot successfully running in polling mode!');
    
    // Self-ping to keep Render container active if host environment is provided
    const hostUrl = process.env.RENDER_EXTERNAL_URL;
    if (hostUrl) {
      console.log(`Self-pinging enabled for: ${hostUrl}`);
      setInterval(() => {
        const http = require('http');
        http.get(`${hostUrl}/health`, (res) => {
          console.log(`[Self-Ping] Health check status code: ${res.statusCode}`);
        }).on('error', (err) => {
          console.error('[Self-Ping] Error:', err.message);
        });
      }, 10 * 60 * 1000); // 10 minutes interval
    }
  })
  .catch((err) => {
    console.error('CRITICAL ERROR: Failed to launch Telegram Bot:', err);
  });

// Handle safe shutdowns
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
