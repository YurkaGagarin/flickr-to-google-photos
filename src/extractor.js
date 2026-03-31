import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import pLimit from 'p-limit';
import 'dotenv/config';

// ─── Конфигурация ───────────────────────────────────────────────
const FLICKR_API_KEY = process.env.FLICKR_API_KEY;
const FLICKR_USER_ID = process.env.FLICKR_USER_ID;
const FLICKR_API_BASE = 'https://api.flickr.com/services/rest/';

const ZIPS_DIR = path.resolve('flickr_zips');
const EXTRACTED_DIR = path.resolve('flickr_extracted');
const CACHE_DIR = path.resolve('flickr_cache');
const MAPPING_PATH = path.resolve('flickr_cache', 'photo_mapping.json');
const ALBUMS_CACHE = path.resolve('flickr_cache', 'albums.json');
const BULK_CACHE = path.resolve('flickr_cache', 'bulk_photos.json');
const TAGS_CACHE = path.resolve('flickr_cache', 'tags_detail.json');

const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.tiff', '.tif',
  '.bmp', '.webp', '.heic', '.heif',
  '.mp4', '.mov', '.avi', '.wmv', '.mkv', '.3gp'
]);

// ─── Утилита: Запрос к Flickr API ──────────────────────────────
async function flickrCall(method, params = {}) {
  const url = new URL(FLICKR_API_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', FLICKR_API_KEY);
  url.searchParams.set('format', 'json');
  url.searchParams.set('nojsoncallback', '1');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${method}`);
  const data = await resp.json();

  if (data.stat === 'fail') {
    throw new Error(`Flickr API error: ${data.message} (code: ${data.code})`);
  }
  return data;
}

// ─── Утилита: Задержка ─────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Шаг 0: Распаковка ZIP-архивов ─────────────────────────────
function unzipArchives() {
  console.log(chalk.bold('\n📦 Шаг 0: Распаковка архивов\n'));

  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });

  const zipFiles = fs.readdirSync(ZIPS_DIR)
    .filter(f => f.endsWith('.zip'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/_(\d+)\.zip$/)?.[1] || '0');
      const numB = parseInt(b.match(/_(\d+)\.zip$/)?.[1] || '0');
      return numA - numB;
    });

  if (zipFiles.length === 0) {
    console.log(chalk.red('❌ ZIP-файлы не найдены в:', ZIPS_DIR));
    process.exit(1);
  }

  console.log(chalk.cyan(`   Найдено ${zipFiles.length} архивов\n`));

  for (let i = 0; i < zipFiles.length; i++) {
    const zipFile = zipFiles[i];
    const zipPath = path.join(ZIPS_DIR, zipFile);
    process.stdout.write(chalk.yellow(`   [${i + 1}/${zipFiles.length}] ${zipFile}... `));

    try {
      execSync(`unzip -oqn "${zipPath}" -d "${EXTRACTED_DIR}"`, {
        stdio: 'pipe',
        maxBuffer: 50 * 1024 * 1024
      });
      console.log(chalk.green('✓'));
    } catch (err) {
      console.log(chalk.red('✗'), err.message.slice(0, 80));
    }
  }
}

// ─── Шаг 1: Сканирование локальных файлов ──────────────────────
function scanLocalFiles() {
  console.log(chalk.bold('\n🔍 Шаг 1: Сканирование локальных файлов\n'));

  const allFiles = getAllFiles(EXTRACTED_DIR);
  const mediaFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return MEDIA_EXTENSIONS.has(ext);
  });

  console.log(chalk.cyan(`   Найдено медиа-файлов: ${mediaFiles.length}\n`));

  const localIndex = {};
  let matched = 0;
  let unmatched = 0;

  for (const filePath of mediaFiles) {
    const filename = path.basename(filePath);
    const flickrId = extractFlickrId(filename);

    if (flickrId) {
      localIndex[flickrId] = {
        filePath,
        filename,
        relativePath: path.relative(EXTRACTED_DIR, filePath),
      };
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(chalk.green(`   Flickr ID извлечён: ${matched}`));
  if (unmatched > 0) {
    console.log(chalk.yellow(`   Без Flickr ID:      ${unmatched}`));
  }

  return localIndex;
}

/**
 * Извлечение Flickr Photo ID из имени файла.
 *
 * Flickr использует два паттерна:
 * 1. "{original-name}_{flickr_id}_o.{ext}"
 *    Пример: "palma-2010-4132jpg_5035939327_o.jpg" → ID = 5035939327
 *
 * 2. "{flickr_id}_{secret}_o.{ext}"
 *    Пример: "54979764320_59a5979fdb_o.jpg" → ID = 54979764320
 */
function extractFlickrId(filename) {
  // Убираем расширение и суффикс _o
  const name = filename.replace(/\.[^.]+$/, '').replace(/_o$/, '');
  const parts = name.split('_');

  if (parts.length < 2) return null;

  // Паттерн 1: последняя часть — числовой ID (длинное число)
  const lastPart = parts[parts.length - 1];
  if (/^\d{5,}$/.test(lastPart)) return lastPart;

  // Паттерн 2: первая часть — числовой ID (когда вторая — hex-секрет)
  const firstPart = parts[0];
  if (/^\d{5,}$/.test(firstPart)) return firstPart;

  return null;
}

// ─── Шаг 2a: Bulk-загрузка метаданных через API ────────────────
async function fetchBulkPhotos() {
  console.log(chalk.bold('\n📡 Шаг 2a: Bulk-загрузка метаданных из Flickr API\n'));

  // Проверяем кэш
  if (fs.existsSync(BULK_CACHE)) {
    console.log(chalk.cyan('   Загрузка из кэша...'));
    return JSON.parse(fs.readFileSync(BULK_CACHE, 'utf-8'));
  }

  const allPhotos = {};
  let page = 1;
  let totalPages = 1;

  // Extras: date_taken (ДАТА СЪЁМКИ, НЕ загрузки!), geo, tags, description
  const extras = 'date_taken,geo,tags,description,original_format,o_dims,url_o';

  while (page <= totalPages) {
    process.stdout.write(chalk.yellow(`   Страница ${page}/${totalPages}... `));

    const data = await flickrCall('flickr.people.getPhotos', {
      user_id: FLICKR_USER_ID,
      extras,
      per_page: '500',
      page: String(page),
    });

    const photos = data.photos;
    totalPages = photos.pages;

    for (const p of photos.photo) {
      allPhotos[p.id] = {
        id: p.id,
        title: p.title,
        description: p.description?._content || '',
        // КРИТИЧНО: datetaken = дата съёмки камерой, НЕ дата загрузки на Flickr
        dateTaken: p.datetaken,
        // GPS: 0/0 означает "нет данных"
        latitude: parseFloat(p.latitude) || 0,
        longitude: parseFloat(p.longitude) || 0,
        hasGeo: (parseFloat(p.latitude) !== 0 || parseFloat(p.longitude) !== 0),
        // Теги из bulk: пробелоразделённая строка (НЕ надёжна для многословных)
        tagsBulk: p.tags || '',
        hasTags: !!(p.tags && p.tags.trim()),
        originalFormat: p.originalformat || '',
      };
    }

    console.log(chalk.green(`✓ (${Object.keys(allPhotos).length} фото)`));
    page++;
    await sleep(200); // Уважаем rate limit
  }

  // Сохраняем кэш
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(BULK_CACHE, JSON.stringify(allPhotos, null, 2));
  console.log(chalk.green(`\n   ✅ Bulk-данные сохранены в кэш (${Object.keys(allPhotos).length} фото)`));

  return allPhotos;
}

// ─── Шаг 2b: Загрузка альбомов ─────────────────────────────────
async function fetchAlbums() {
  console.log(chalk.bold('\n📁 Шаг 2b: Загрузка альбомов из Flickr API\n'));

  if (fs.existsSync(ALBUMS_CACHE)) {
    console.log(chalk.cyan('   Загрузка из кэша...'));
    return JSON.parse(fs.readFileSync(ALBUMS_CACHE, 'utf-8'));
  }

  // 1. Получаем список всех альбомов
  const albumList = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await flickrCall('flickr.photosets.getList', {
      user_id: FLICKR_USER_ID,
      per_page: '500',
      page: String(page),
    });

    totalPages = data.photosets.pages;
    for (const ps of data.photosets.photoset) {
      albumList.push({
        id: ps.id,
        title: ps.title._content,
        description: ps.description._content,
        photoCount: ps.photos,
      });
    }
    page++;
  }

  console.log(chalk.cyan(`   Найдено альбомов: ${albumList.length}\n`));

  // 2. Для каждого альбома получаем список фото
  const albumMap = {};       // albumTitle → [photoId, ...]
  const photoToAlbums = {};  // photoId → [albumTitle, ...]

  for (let i = 0; i < albumList.length; i++) {
    const album = albumList[i];
    process.stdout.write(chalk.yellow(`   [${i + 1}/${albumList.length}] ${album.title}... `));

    const photoIds = [];
    let aPage = 1;
    let aTotalPages = 1;

    while (aPage <= aTotalPages) {
      const data = await flickrCall('flickr.photosets.getPhotos', {
        photoset_id: album.id,
        user_id: FLICKR_USER_ID,
        per_page: '500',
        page: String(aPage),
      });

      aTotalPages = data.photoset.pages;
      for (const p of data.photoset.photo) {
        photoIds.push(p.id);
      }
      aPage++;
    }

    albumMap[album.title] = photoIds;

    for (const pid of photoIds) {
      if (!photoToAlbums[pid]) photoToAlbums[pid] = [];
      photoToAlbums[pid].push(album.title);
    }

    console.log(chalk.green(`✓ (${photoIds.length})`));
    await sleep(150);
  }

  const result = { albumList, albumMap, photoToAlbums };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(ALBUMS_CACHE, JSON.stringify(result, null, 2));
  console.log(chalk.green(`\n   ✅ Альбомы сохранены в кэш`));

  return result;
}

// ─── Шаг 2c: Детальные теги (raw) для фото с тегами ────────────
async function fetchDetailedTags(bulkPhotos) {
  console.log(chalk.bold('\n🏷  Шаг 2c: Загрузка точных тегов (raw) из Flickr API\n'));

  // Загружаем кэш если есть
  let tagsCache = {};
  if (fs.existsSync(TAGS_CACHE)) {
    tagsCache = JSON.parse(fs.readFileSync(TAGS_CACHE, 'utf-8'));
  }

  // Фильтруем: только фото с тегами, которых ещё нет в кэше
  const photosWithTags = Object.values(bulkPhotos)
    .filter(p => p.hasTags && !tagsCache[p.id]);

  if (photosWithTags.length === 0) {
    console.log(chalk.cyan('   Все теги уже в кэше'));
    return tagsCache;
  }

  console.log(chalk.cyan(`   Фото с тегами (не в кэше): ${photosWithTags.length}\n`));

  const limit = pLimit(3); // Ограничиваем параллельность
  let processed = 0;

  const tasks = photosWithTags.map(photo => limit(async () => {
    try {
      const data = await flickrCall('flickr.photos.getInfo', {
        photo_id: photo.id,
      });

      const tags = data.photo.tags.tag.map(t => ({
        raw: t.raw,
        clean: t._content,
      }));

      // Также забираем точную ссылку на Flickr-страницу
      const flickrUrl = data.photo.urls?.url?.[0]?._content || '';

      // КРИТИЧНО: Проверяем дату. dates.taken = ДАТА СЪЁМКИ камерой.
      //           dates.posted = дата загрузки на Flickr (НЕ используем).
      //           dates.takengranularity = 0 значит дата точная.
      const dates = data.photo.dates;

      tagsCache[photo.id] = {
        tags,
        flickrUrl,
        dateTaken: dates.taken,
        datePosted: dates.posted,
        dateGranularity: parseInt(dates.takengranularity),
      };

      processed++;
      if (processed % 50 === 0) {
        process.stdout.write(chalk.yellow(`   Обработано: ${processed}/${photosWithTags.length}\r`));
        // Промежуточное сохранение кэша каждые 50 фото
        fs.writeFileSync(TAGS_CACHE, JSON.stringify(tagsCache, null, 2));
      }
    } catch (err) {
      // Личное/удалённое фото — пропускаем
      processed++;
    }
    await sleep(100);
  }));

  await Promise.all(tasks);

  // Финальное сохранение
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(TAGS_CACHE, JSON.stringify(tagsCache, null, 2));
  console.log(chalk.green(`\n   ✅ Теги сохранены (${Object.keys(tagsCache).length} фото)`));

  return tagsCache;
}

// ─── Шаг 3: Сборка финального маппинга ─────────────────────────
function buildFinalMapping(localIndex, bulkPhotos, albumData, tagsDetail) {
  console.log(chalk.bold('\n🔗 Шаг 3: Сборка финального маппинга\n'));

  const mapping = {
    photos: [],
    albums: albumData.albumMap,
    stats: {
      totalLocal: 0,
      matchedWithApi: 0,
      withGeo: 0,
      withTags: 0,
      withDescription: 0,
      withAlbum: 0,
      isLightroom: 0,
      noApiMatch: 0,
    }
  };

  for (const [flickrId, local] of Object.entries(localIndex)) {
    mapping.stats.totalLocal++;

    const bulk = bulkPhotos[flickrId];
    const detail = tagsDetail[flickrId];
    const albums = albumData.photoToAlbums[flickrId] || [];

    const entry = {
      flickrId,
      filePath: local.filePath,
      filename: local.filename,
      relativePath: local.relativePath,
      albums,

      // Данные из Flickr API
      title: bulk?.title || '',
      description: bulk?.description || '',

      // ДАТА СЪЁМКИ (приоритет):
      // 1. EXIF DateTimeOriginal из самого файла (добавим при записи EXIF)
      // 2. Flickr API dates.taken (дата съёмки камерой)
      // НЕ используем dates.posted (дата загрузки на Flickr)
      dateTaken: detail?.dateTaken || bulk?.dateTaken || null,
      dateGranularity: detail?.dateGranularity ?? null,

      // GPS из Flickr (если в файле нет — допишем)
      geo: bulk?.hasGeo ? { lat: bulk.latitude, lon: bulk.longitude } : null,

      // Теги: raw-формат из getInfo (если доступен)
      tags: detail?.tags || [],

      // Ссылка на Flickr (для логов и Description)
      flickrUrl: detail?.flickrUrl || `https://www.flickr.com/photos/${FLICKR_USER_ID}/${flickrId}/`,

      // Детекция Lightroom (проверяется позже через EXIF)
      isLightroom: false,
    };

    // Статистика
    if (bulk) {
      mapping.stats.matchedWithApi++;
    } else {
      mapping.stats.noApiMatch++;
    }
    if (entry.geo) mapping.stats.withGeo++;
    if (entry.tags.length > 0) mapping.stats.withTags++;
    if (entry.description) mapping.stats.withDescription++;
    if (albums.length > 0) mapping.stats.withAlbum++;

    mapping.photos.push(entry);
  }

  return mapping;
}

// ─── Шаг 4: Детекция Lightroom через EXIF ──────────────────────
function detectLightroom(mapping) {
  console.log(chalk.bold('\n🖥  Шаг 4: Детекция Lightroom через EXIF\n'));

  let lrCount = 0;
  const sampleSize = Math.min(mapping.photos.length, 500);

  // Проверяем пакетами через exiftool (намного быстрее, чем по одному)
  const batch = mapping.photos.slice(0, sampleSize).map(p => p.filePath);

  try {
    const result = execSync(
      `exiftool -json -CreatorTool ${batch.map(f => `"${f}"`).join(' ')}`,
      { maxBuffer: 100 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const exifData = JSON.parse(result.toString());
    const lrMap = {};

    for (const item of exifData) {
      const tool = item.CreatorTool || '';
      if (tool.toLowerCase().includes('lightroom')) {
        const src = item.SourceFile;
        lrMap[src] = true;
      }
    }

    for (const photo of mapping.photos) {
      if (lrMap[photo.filePath]) {
        photo.isLightroom = true;
        lrCount++;
      }
    }
  } catch (err) {
    console.log(chalk.yellow('   ⚠️ Не удалось проверить EXIF пакетно, пропускаем'));
  }

  mapping.stats.isLightroom = lrCount;
  console.log(chalk.cyan(`   Фото из Lightroom: ${lrCount}`));

  // Для фото свыше sample — заполним при записи EXIF (Stage 2)
  if (mapping.photos.length > sampleSize) {
    console.log(chalk.yellow(`   ⚠️ Проверены только первые ${sampleSize}. Остальные будут проверены на этапе Metadata Writer`));
  }
}

// ─── Печать статистики ──────────────────────────────────────────
function printStats(mapping) {
  const s = mapping.stats;
  const albumCount = Object.keys(mapping.albums).length;

  console.log(chalk.bold('\n' + '═'.repeat(50)));
  console.log(chalk.bold('📊 СТАТИСТИКА ИЗВЛЕЧЕНИЯ'));
  console.log('═'.repeat(50));
  console.log(`   Локальных медиа-файлов:  ${chalk.bold(s.totalLocal)}`);
  console.log(`   Найдено в Flickr API:    ${chalk.green(s.matchedWithApi)}`);
  console.log(`   Не найдено в API:        ${chalk.yellow(s.noApiMatch)}`);
  console.log('─'.repeat(50));
  console.log(`   С геолокацией (Flickr):  ${chalk.green(s.withGeo)} (${pct(s.withGeo, s.totalLocal)})`);
  console.log(`   С тегами:               ${chalk.green(s.withTags)} (${pct(s.withTags, s.totalLocal)})`);
  console.log(`   С описанием:            ${chalk.green(s.withDescription)} (${pct(s.withDescription, s.totalLocal)})`);
  console.log(`   В альбомах:             ${chalk.green(s.withAlbum)} (${pct(s.withAlbum, s.totalLocal)})`);
  console.log(`   Из Lightroom:           ${chalk.blue(s.isLightroom)} (${pct(s.isLightroom, s.totalLocal)})`);
  console.log('─'.repeat(50));
  console.log(`   Альбомов:               ${chalk.bold(albumCount)}`);
  console.log('═'.repeat(50));

  if (albumCount > 0 && albumCount <= 30) {
    console.log(chalk.bold('\n📁 Альбомы:\n'));
    for (const [name, ids] of Object.entries(mapping.albums)) {
      console.log(`   ${name}: ${ids.length} фото`);
    }
  } else if (albumCount > 30) {
    console.log(chalk.bold(`\n📁 Альбомов слишком много (${albumCount}). Первые 20:\n`));
    const entries = Object.entries(mapping.albums).slice(0, 20);
    for (const [name, ids] of entries) {
      console.log(`   ${name}: ${ids.length} фото`);
    }
    console.log(chalk.yellow(`   ... и ещё ${albumCount - 20}`));
  }
}

function pct(part, total) {
  if (total === 0) return '0%';
  return Math.round((part / total) * 100) + '%';
}

// ─── Рекурсивный обход директории ──────────────────────────────
function getAllFiles(dir) {
  const results = [];
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

// ─── MAIN ───────────────────────────────────────────────────────
export async function extractAll() {
  console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════╗
║  FLICKR EXTRACTOR — Stage 1                   ║
║  Извлечение и сбор метаданных                 ║
╚════════════════════════════════════════════════╝`));

  if (!FLICKR_API_KEY || !FLICKR_USER_ID) {
    console.log(chalk.red('❌ Не найдены FLICKR_API_KEY или FLICKR_USER_ID в .env'));
    process.exit(1);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Шаг 0: Распаковка
  unzipArchives();

  // Шаг 1: Сканирование файлов на диске
  const localIndex = scanLocalFiles();

  // Шаг 2a: Bulk-метаданные (дата СЪЁМКИ, GPS, описание)
  const bulkPhotos = await fetchBulkPhotos();

  // Шаг 2b: Альбомы
  const albumData = await fetchAlbums();

  // Шаг 2c: Детальные raw-теги (для фото с тегами)
  const tagsDetail = await fetchDetailedTags(bulkPhotos);

  // Шаг 3: Финальный маппинг
  const mapping = buildFinalMapping(localIndex, bulkPhotos, albumData, tagsDetail);

  // Шаг 4: Детекция Lightroom
  detectLightroom(mapping);

  // Сохранение
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));
  console.log(chalk.green(`\n✅ Маппинг сохранён: ${MAPPING_PATH}`));

  // Статистика
  printStats(mapping);

  return mapping;
}

// Запуск напрямую
const currentFile = path.resolve(process.argv[1] || '');
if (currentFile === path.resolve('src/extractor.js')) {
  extractAll()
    .then(() => {
      console.log(chalk.bold.green('\n🎉 Stage 1 (Extraction) завершён!\n'));
      process.exit(0);
    })
    .catch((err) => {
      console.error(chalk.red('\n❌ Фатальная ошибка:'), err);
      process.exit(1);
    });
}
