FROM node:20-slim

# Install system dependencies (ffmpeg and python3 required for yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg python3 curl xz-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Download the standalone yt-dlp Linux binary and place it in the project's bin directory
RUN mkdir -p bin && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o bin/yt-dlp && \
    chmod a+rx bin/yt-dlp

# Copy the rest of the application files
COPY . .

# Expose port (Render standard is 10000, defaults to 3000 if not set)
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
