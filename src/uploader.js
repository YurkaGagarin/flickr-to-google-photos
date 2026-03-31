import fs from 'fs';
import path from 'path';
import { getAuthClient } from './auth.js';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import 'dotenv/config';

// ─── Конфигурация ───────────────────────────────────────────────
const CACHE_DIR = path.resolve('flickr_cache');
const MAPPING_PATH = path.resolve(CACHE_DIR, 'photo_mapping.json');
const ALBUMS_PATH = path.resolve(CACHE_DIR, 'albums.json');
const UPLOAD_PROGRESS_PATH = path.resolve(CACHE_DIR, 'upload_progress.json');

const API_BASE = 'https://photoslibrary.googleapis.com/v1';

// Google Photos API limits
const DELAY_BETWEEN_UPLOADS_MS = 300;   // ~3 uploads/sec (щадящий режим)
const BATCH_CREATE_SIZE = 50;           // Max items per batchCreate
const BATCH_ADD_ALBUM_SIZE = 50;        // Max items per batchAddMediaItems
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ─── Утилиты ────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.heic': 'image/heic',
    '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.3gp': 'video/3gpp',
  };
  return map[ext] || 'application/octet-stream';
}

// ─── Загрузка / сохранение данных ───────────────────────────────
function loadMapping() {
  if (!fs.existsSync(MAPPING_PATH)) {
    console.log(chalk.red('❌ Маппинг не найден. Сначала запустите: npm run extract'));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'));
}

/**
 * Загрузка альбомов из отдельного кэш-файла.
 * Формат albums.json: { albumList, albumMap: { title: [photoIds] }, photoToAlbums }
 * Преобразуем в формат: [{ title, photoIds }]
 */
function loadAlbums() {
  if (!fs.existsSync(ALBUMS_PATH)) {
    console.log(chalk.yellow('⚠️ Файл альбомов не найден: ' + ALBUMS_PATH));
    return [];
  }
  const data = JSON.parse(fs.readFileSync(ALBUMS_PATH, 'utf-8'));
  // albumMap: { "Venice 2024": ["id1", "id2", ...], ... }
  if (data.albumMap) {
    return Object.entries(data.albumMap).map(([title, photoIds]) => ({
      title,
      photoIds: Array.isArray(photoIds) ? photoIds : [],
    }));
  }
  return [];
}

function loadProgress() {
  if (fs.existsSync(UPLOAD_PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(UPLOAD_PROGRESS_PATH, 'utf-8'));
  }
  return { uploadedIds: {}, albumsCreated: {} };
  // uploadedIds: { flickrId: googleMediaItemId }
  // albumsCreated: { flickrAlbumTitle: googleAlbumId }
}

function saveProgress(progress) {
  fs.writeFileSync(UPLOAD_PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ─── Google Photos API ──────────────────────────────────────────

async function getToken(auth) {
  // Проверяем и обновляем токен если истёк
  if (auth.credentials.expiry_date && auth.credentials.expiry_date < Date.now()) {
    const { credentials } = await auth.refreshAccessToken();
    auth.setCredentials(credentials);
    fs.writeFileSync(path.resolve('token.json'), JSON.stringify(credentials, null, 2));
  }
  return auth.credentials.access_token;
}

/**
 * Загрузка байтов файла → upload token
 */
async function uploadBytes(auth, filePath) {
  const token = await getToken(auth);
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = getMimeType(filePath);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${API_BASE}/uploads`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'X-Goog-Upload-Content-Type': mimeType,
          'X-Goog-Upload-Protocol': 'raw',
        },
        body: fileBuffer,
      });

      if (resp.ok) {
        return await resp.text(); // upload token
      }

      if (resp.status === 429) {
        // Rate limit — ждём и повторяем
        const waitTime = RETRY_DELAY_MS * attempt * 2;
        console.log(chalk.yellow(`   ⏳ Rate limit, жду ${waitTime / 1000}с...`));
        await sleep(waitTime);
        continue;
      }

      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Создание mediaItems из upload tokens (батч до 50)
 */
async function batchCreateMediaItems(auth, items) {
  const token = await getToken(auth);

  const body = {
    newMediaItems: items.map(item => ({
      description: item.description || '',
      simpleMediaItem: {
        uploadToken: item.uploadToken,
        fileName: item.fileName,
      }
    }))
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${API_BASE}/mediaItems:batchCreate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (resp.ok) return await resp.json();

      if (resp.status === 429) {
        await sleep(RETRY_DELAY_MS * attempt * 2);
        continue;
      }

      const errText = await resp.text();
      throw new Error(`batchCreate HTTP ${resp.status}: ${errText}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Создание альбома (с retry при 429)
 */
async function createAlbum(auth, title) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const token = await getToken(auth);

    try {
      const resp = await fetch(`${API_BASE}/albums`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ album: { title } }),
      });

      if (resp.ok) return await resp.json();

      if (resp.status === 429) {
        const waitTime = RETRY_DELAY_MS * attempt * 3;
        console.log(chalk.yellow(`   ⏳ Album rate limit, жду ${waitTime / 1000}с...`));
        await sleep(waitTime);
        continue;
      }

      throw new Error(`Create album "${title}" failed: ${resp.status} ${await resp.text()}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Добавление фото в альбом (батч до 50, с retry при 429)
 */
async function batchAddToAlbum(auth, albumId, mediaItemIds) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const token = await getToken(auth);

    try {
      const resp = await fetch(`${API_BASE}/albums/${albumId}:batchAddMediaItems`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mediaItemIds }),
      });

      if (resp.ok) return await resp.json();

      if (resp.status === 429) {
        const waitTime = RETRY_DELAY_MS * attempt * 3;
        console.log(chalk.yellow(`   ⏳ Album assign rate limit, жду ${waitTime / 1000}с...`));
        await sleep(waitTime);
        continue;
      }

      const errText = await resp.text();
      throw new Error(`batchAdd to album failed: ${resp.status} ${errText}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

// ─── Формирование описания ──────────────────────────────────────
function buildDescription(photo) {
  const parts = [];

  if (photo.description && photo.description.trim()) {
    parts.push(photo.description.trim());
  }

  // Flickr URL для кросс-ссылки
  if (photo.flickrId) {
    const userId = process.env.FLICKR_USER_ID || '';
    parts.push(`Flickr: https://www.flickr.com/photos/${userId}/${photo.flickrId}`);
  }

  parts.push('#FlickrMigration');

  return parts.join('\n');
}

// ─── ФАЗА 1: Загрузка фото ─────────────────────────────────────
async function uploadAllPhotos(auth, mapping, progress) {
  console.log(chalk.bold.cyan('\n📤 ФАЗА 1: Загрузка фотографий\n'));

  // Загружаем ВСЕ фото из маппинга, чтобы гарантировать 100% сохранность.
  // Если на Google Photos уже есть такое же фото (с iPhone), оно будет дубликатом.
  // Это безопаснее, чем пропустить фото, которое есть только на Flickr.
  const photosToUpload = mapping.photos.filter(p => {
    if (progress.uploadedIds[p.flickrId]) return false;  // уже загружено
    if (!fs.existsSync(p.filePath)) return false;        // файл не найден
    return true;
  });

  const totalInMapping = mapping.photos.filter(p => fs.existsSync(p.filePath)).length;
  const alreadyUploaded = Object.keys(progress.uploadedIds).length;

  console.log(chalk.cyan(`   Всего фото в маппинге:      ${totalInMapping}`));
  console.log(chalk.cyan(`   Уже загружено (resume):     ${alreadyUploaded}`));
  console.log(chalk.cyan(`   Осталось к загрузке:        ${photosToUpload.length}\n`));

  if (photosToUpload.length === 0) {
    console.log(chalk.green('   ✅ Все фото уже загружены!\n'));
    return;
  }

  const uploadBar = new cliProgress.SingleBar({
    format: chalk.cyan('   Загрузка') + ' |' + chalk.blue('{bar}') + '| {percentage}% || {value}/{total} Фото || {speed} фото/сек || ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  uploadBar.start(photosToUpload.length, 0, { speed: "0.0" });

  const stats = { uploaded: 0, errors: 0, totalBytes: 0 };
  const startTime = Date.now();

  // Загружаем пачками по BATCH_CREATE_SIZE
  for (let batchStart = 0; batchStart < photosToUpload.length; batchStart += BATCH_CREATE_SIZE) {
    const batch = photosToUpload.slice(batchStart, batchStart + BATCH_CREATE_SIZE);
    const uploadTokens = [];

    // Шаг 1: загрузка байтов каждого файла
    for (const photo of batch) {
      try {
        const fileSize = fs.statSync(photo.filePath).size;
        const uploadToken = await uploadBytes(auth, photo.filePath);

        uploadTokens.push({
          flickrId: photo.flickrId,
          uploadToken,
          fileName: photo.filename,
          description: buildDescription(photo),
        });

        stats.totalBytes += fileSize;
        await sleep(DELAY_BETWEEN_UPLOADS_MS);
      } catch (err) {
        stats.errors++;
        if (stats.errors <= 20) {
          console.log(chalk.red(`   ✗ ${photo.filename}: ${err.message.slice(0, 80)}`));
        }
      }
    }

    if (uploadTokens.length === 0) continue;

    // Шаг 2: batchCreate — создаём mediaItems
    try {
      const result = await batchCreateMediaItems(auth, uploadTokens);

      if (result.newMediaItemResults) {
        for (let i = 0; i < result.newMediaItemResults.length; i++) {
          const r = result.newMediaItemResults[i];
          const flickrId = uploadTokens[i]?.flickrId;
          if (!flickrId) continue;

          // Google возвращает status.code (0 = OK) или status.message
          const isSuccess = (r.mediaItem && r.mediaItem.id) ||
            (r.status && (r.status.message === 'Success' || r.status.message === 'OK' || r.status.code === 0));

          if (isSuccess && r.mediaItem) {
            progress.uploadedIds[flickrId] = r.mediaItem.id;
            stats.uploaded++;
          } else {
            stats.errors++;
            if (stats.errors <= 20) {
              console.log(chalk.red(`   ✗ batchCreate item: ${JSON.stringify(r.status)}`));
            }
          }
        }
      }
    } catch (err) {
      stats.errors++;
      console.log(chalk.red(`   ✗ batchCreate batch error: ${err.message.slice(0, 100)}`));
    }

    // Промежуточное сохранение
    saveProgress(progress);

    // Обновление прогресс-бара
    const elapsed = Math.max((Date.now() - startTime) / 1000, 0.1);
    const speed = (stats.uploaded / elapsed).toFixed(1);
    uploadBar.update(batchStart + batch.length, { speed });
  }

  uploadBar.stop();

  saveProgress(progress);

  console.log(chalk.bold('\n' + '─'.repeat(50)));
  console.log(`   Загружено:  ${chalk.green(stats.uploaded)}`);
  console.log(`   Ошибки:     ${chalk.red(stats.errors)}`);
  console.log(`   Объём:      ${(stats.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log('─'.repeat(50));
}

// ─── ФАЗА 2: Создание альбомов и привязка фото ─────────────────
async function createAlbumsAndAssign(auth, albums, progress) {
  console.log(chalk.bold.cyan('\n📁 ФАЗА 2: Создание альбомов\n'));

  if (!albums || albums.length === 0) {
    console.log(chalk.yellow('   Альбомов не найдено'));
    return;
  }

  const stats = { created: 0, assigned: 0, errors: 0 };

  const albumBar = new cliProgress.SingleBar({
    format: chalk.cyan('   Альбомы') + '  |' + chalk.magenta('{bar}') + '| {percentage}% || {value}/{total} Альбомов || ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  albumBar.start(albums.length, 0);

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    const albumTitle = album.title;

    // Создаём альбом (если ещё не создан)
    let googleAlbumId = progress.albumsCreated[albumTitle];

    if (!googleAlbumId) {
      try {
        const created = await createAlbum(auth, albumTitle);
        googleAlbumId = created.id;
        progress.albumsCreated[albumTitle] = googleAlbumId;
        stats.created++;
        saveProgress(progress);
        await sleep(200);
      } catch (err) {
        stats.errors++;
        console.log(chalk.red(`   ✗ Альбом "${albumTitle}": ${err.message.slice(0, 80)}`));
        continue;
      }
    }

    // Собираем Google Media Item IDs для фото в этом альбоме
    const mediaItemIds = [];
    for (const flickrPhotoId of album.photoIds) {
      const googleId = progress.uploadedIds[String(flickrPhotoId)];
      if (googleId) {
        mediaItemIds.push(googleId);
      }
    }

    if (mediaItemIds.length === 0) {
      continue;
    }

    // Добавляем фото в альбом батчами по 50
    // При ошибке 400 (невалидные ID) — фоллбэк на поштучную загрузку
    for (let j = 0; j < mediaItemIds.length; j += BATCH_ADD_ALBUM_SIZE) {
      const batch = mediaItemIds.slice(j, j + BATCH_ADD_ALBUM_SIZE);
      try {
        await batchAddToAlbum(auth, googleAlbumId, batch);
        stats.assigned += batch.length;
        await sleep(300);
      } catch (err) {
        // Если 400 — в батче есть битые ID, пробуем по одному
        if (err.message.includes('400')) {
          for (const singleId of batch) {
            try {
              await batchAddToAlbum(auth, googleAlbumId, [singleId]);
              stats.assigned++;
              await sleep(200);
            } catch (innerErr) {
              // Этот конкретный ID — битый, пропускаем
              stats.errors++;
            }
          }
        } else {
          stats.errors++;
          if (stats.errors <= 20) {
            console.log(chalk.red(`   ✗ Добавление в "${albumTitle}": ${err.message.slice(0, 80)}`));
          }
        }
      }
    }

    // Обновляем прогресс
    albumBar.update(i + 1);
  }

  albumBar.stop();

  saveProgress(progress);

  console.log(chalk.bold('\n' + '─'.repeat(50)));
  console.log(`   Альбомов создано:     ${chalk.green(stats.created)}`);
  console.log(`   Фото привязано:       ${chalk.green(stats.assigned)}`);
  console.log(`   Ошибки:               ${chalk.red(stats.errors)}`);
  console.log('─'.repeat(50));
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════╗
║  UPLOADER — Stage 3                           ║
║  Загрузка в Google Photos                     ║
╚════════════════════════════════════════════════╝`));

  // Авторизация
  console.log(chalk.cyan('\n🔐 Авторизация Google Photos...'));
  const auth = await getAuthClient();
  console.log(chalk.green('   ✅ Авторизован\n'));

  // Загрузка данных
  const mapping = loadMapping();
  const albums = loadAlbums();
  const progress = loadProgress();

  console.log(chalk.cyan(`   Фото в маппинге:    ${mapping.photos.length}`));
  console.log(chalk.cyan(`   Альбомов загружено: ${albums.length}`));

  // Фаза 1: Загрузка фото
  await uploadAllPhotos(auth, mapping, progress);

  // Фаза 2: Создание альбомов
  await createAlbumsAndAssign(auth, albums, progress);

  // Финальный отчёт
  const totalUploaded = Object.keys(progress.uploadedIds).length;
  const totalAlbums = Object.keys(progress.albumsCreated).length;

  console.log(chalk.bold.green(`
══════════════════════════════════════════════════
📊 ИТОГОВЫЙ ОТЧЁТ ЗАГРУЗКИ
══════════════════════════════════════════════════
   Фото загружено:        ${totalUploaded}
   Альбомов создано:       ${totalAlbums}
   Прогресс сохранён:      ${UPLOAD_PROGRESS_PATH}
══════════════════════════════════════════════════

🎉 Stage 3 (Upload) завершён!
`));
}

main().catch(err => {
  console.error(chalk.red('\n❌ Фатальная ошибка:'), err);
  process.exit(1);
});
