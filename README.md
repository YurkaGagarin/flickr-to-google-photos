# 📸 Flickr to Google Photos Migration Tool

[Читать на русском (Russian)](README_RUS.md)

Automated tool to migrate your Flickr library to Google Photos while preserving albums, metadata, and geolocation using a highly resilient "Upload-First" architecture.

---

## USAGE GUIDE

This tool migrates your Flickr library to Google Photos while preserving albums, capture dates, tags, and geolocation.

### 📋 Prerequisites
1. **Node.js** (v18+)
2. **ExifTool** (required for metadata writing: `brew install exiftool` on Mac)
3. **Google Cloud Project** — create a project, enable "Google Photos Library API," and download `credentials.json`.
4. **Flickr API Key** — get a key from Flickr to access metadata.

### 🛠 Migration Steps
1. **Setup:**
   - Place your `credentials.json` in the root directory.
   - Create a `.env` file and add your `FLICKR_API_KEY` and `FLICKR_USER_ID`.
   - Run `npm install`.

2. **Stage 1: Extract:**
   - Place your Flickr Takeout ZIP archives into `flickr_zips/`.
   - `npm run extract` — unpacks archives to `flickr_extracted` and builds metadata mapping.

3. **Stage 2: Metadata Injection:**
   - `npm run metadata` — embeds tags, GPS, and dates directly into files (requires ExifTool).

4. **Stage 3: Upload:**
   - `npm run upload` — uploads photos to Google Photos and organizes them into albums.

### 🔋 Features
- **Upload-First Strategy**: Bypasses API lookup limitations by tracking uploads in a local cache.
- **Rate Limit Resilience**: Automatically handles Google API 429 errors with exponential backoff.
- **Batch Error Recovery**: If a batch upload fails, the tool falls back to individual item processing to ensure maximum data recovery.

---

### 🔍 Troubleshooting
Use `node find_missing.js` to identify any files that failed to upload after completion.

### 🤖 Credits / AI Powered
This project was fully designed, debugged, and prepared for release with the assistance of **Antigravity AI**. 

It serves as a real-world example of how modern agentic AI systems can handle complex data migrations, navigate API limitations, and build production-ready code from scratch. Feel free to use this as a foundation and evolve it further using AI!

### 🤝 License
ISC License. Feel free to use and distribute!
