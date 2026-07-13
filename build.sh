#!/usr/bin/env bash
# exit on error
set -o errexit

# Install npm dependencies
npm install

# Create local bin directory
mkdir -p bin

# Download yt-dlp binary
echo "Downloading latest yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod a+rx bin/yt-dlp

# Download ffmpeg static build (official yt-dlp builds)
echo "Downloading static ffmpeg..."
curl -L https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz -o ffmpeg.tar.xz
mkdir -p ffmpeg-temp
tar -xf ffmpeg.tar.xz -C ffmpeg-temp --strip-components=1
cp ffmpeg-temp/bin/ffmpeg bin/
cp ffmpeg-temp/bin/ffprobe bin/
chmod a+rx bin/ffmpeg bin/ffprobe

# Cleanup temp files
rm -rf ffmpeg-temp ffmpeg.tar.xz

echo "Build completed successfully!"
