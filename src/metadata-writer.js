import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import 'dotenv/config';

// ─── Конфигурация ───────────────────────────────────────────────
const CACHE_DIR = path.resolve('flickr_cache');
const MAPPING_PATH = path.resolve(CACHE_DIR, 'photo_mapping.json');
const PROGRESS_PATH = path.resolve(CACHE_DIR, 'metadata_progress.json');
const STATS_PATH = path.resolve(CACHE_DIR, 'metadata_stats.json');

// ─── Загрузка маппинга ─────────────────────────────────────────
function loadMapping() {
  if (!fs.existsSync(MAPPING_PATH)) {
    console.log(chalk.red('❌ Маппинг не найден. Сначала запустите: npm run extract'));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'));
}

// ─── Загрузка прогресса (для resume) ───────────────────────────
function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8')));
  }
  return new Set();
}

function saveProgress(processedIds) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify([...processedIds], null, 2));
}

// ─── Чтение EXIF одного файла ───────────────────────────────────
function readExif(filePath) {
  try {
    const result = execSync(
      `exiftool -json -CreatorTool -DateTimeOriginal -GPSLatitude -GPSLongitude -Keywords "${filePath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(result.toString());
    return data[0] || {};
  } catch {
    return {};
  }
}

// ─── Запись EXIF одного файла ───────────────────────────────────
/**
 * Формирует и выполняет команду exiftool для записи метаданных.
 *
 * Правила:
 * 1. ТЕГИ: Flickr API raw → каждый тег отдельной записью IPTC Keywords.
 *    Старые Keywords очищаются, если у нас есть данные из API.
 * 2. GPS: Записывается ТОЛЬКО если в файле его ещё нет, а в Flickr API есть.
 * 3. ДАТА: DateTimeOriginal записывается ТОЛЬКО если в файле его нет.
 *    Используется dates.taken (дата СЪЁМКИ), НЕ dates.posted (загрузки).
 * 4. ОПИСАНИЕ: Записывается если есть.
 * 5. #lightroom: Добавляется автоматически для фото из Lightroom.
 */
function writeExif(filePath, photo, existingExif) {
  const args = ['-overwrite_original'];

  // ── 1. ТЕГИ (Keywords) ──────────────────────────────────────
  const newTags = [];

  // Теги из Flickr API (raw формат — сохраняет многословные теги)
  if (photo.tags && photo.tags.length > 0) {
    for (const t of photo.tags) {
      newTags.push(t.raw || t.clean || '');
    }
  }

  // Детекция Lightroom: проверяем CreatorTool из текущего EXIF
  const creatorTool = String(existingExif.CreatorTool || '');
  const isLightroom = creatorTool.toLowerCase().includes('lightroom');
  if (isLightroom) {
    newTags.push('#lightroom');
    photo.isLightroom = true;
  }

  if (newTags.length > 0) {
    // Очищаем старые Keywords (могут быть слитные из Lightroom)
    args.push('-Keywords=');
    // Записываем каждый тег ОТДЕЛЬНО
    for (const tag of newTags) {
      if (tag.trim()) {
        args.push(`-Keywords+=${escapeExifArg(tag.trim())}`);
      }
    }
    // Дублируем в Subject (для совместимости с разными программами)
    args.push('-Subject=');
    for (const tag of newTags) {
      if (tag.trim()) {
        args.push(`-Subject+=${escapeExifArg(tag.trim())}`);
      }
    }
  }

  // ── 2. GPS ──────────────────────────────────────────────────
  // ПРАВИЛО: Если GPS уже в файле (iPhone) — НЕ ТРОГАЕМ.
  //          Если GPS нет, но есть из Flickr API — ЗАПИСЫВАЕМ.
  const hasExistingGps = existingExif.GPSLatitude && existingExif.GPSLongitude;

  if (!hasExistingGps && photo.geo) {
    const lat = photo.geo.lat;
    const lon = photo.geo.lon;
    const latRef = lat >= 0 ? 'N' : 'S';
    const lonRef = lon >= 0 ? 'E' : 'W';

    args.push(`-GPSLatitude=${Math.abs(lat)}`);
    args.push(`-GPSLatitudeRef=${latRef}`);
    args.push(`-GPSLongitude=${Math.abs(lon)}`);
    args.push(`-GPSLongitudeRef=${lonRef}`);
  }

  // ── 3. ДАТА СЪЁМКИ ─────────────────────────────────────────
  // ПРАВИЛО: Если DateTimeOriginal уже в файле — НЕ ТРОГАЕМ (камера точнее).
  //          Если нет — берём dates.taken из Flickr API.
  //          НИКОГДА не используем dates.posted (дата загрузки).
  const hasExistingDate = !!existingExif.DateTimeOriginal;

  if (!hasExistingDate && photo.dateTaken) {
    // Flickr отдаёт: "2010-09-01 11:02:31"
    // ExifTool ожидает: "2010:09:01 11:02:31"
    const exifDate = photo.dateTaken.replace(/-/g, ':');

    // Проверяем granularity: 0 = точная дата, >0 = приблизительная
    if (photo.dateGranularity === 0 || photo.dateGranularity === null) {
      args.push(`-DateTimeOriginal=${escapeExifArg(exifDate)}`);
      args.push(`-CreateDate=${escapeExifArg(exifDate)}`);
    }
  }

  // ── 4. ОПИСАНИЕ ─────────────────────────────────────────────
  if (photo.description && photo.description.trim()) {
    const desc = photo.description.trim();
    args.push(`-ImageDescription=${escapeExifArg(desc)}`);
    args.push(`-Description=${escapeExifArg(desc)}`);
  }

  // Если нечего писать — пропускаем
  if (args.length <= 1) {
    return { status: 'skipped', reason: 'no_metadata' };
  }

  // ── Выполнение exiftool ─────────────────────────────────────
  args.push(`"${filePath}"`);
  const cmd = `exiftool ${args.join(' ')}`;

  try {
    execSync(cmd, { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
    return { status: 'ok', isLightroom, gpsWritten: !hasExistingGps && !!photo.geo, dateWritten: !hasExistingDate && !!photo.dateTaken };
  } catch (err) {
    return { status: 'error', error: err.message.slice(0, 100) };
  }
}

// ─── Экранирование аргументов для exiftool ─────────────────────
function escapeExifArg(value) {
  // Оборачиваем в кавычки, экранируя внутренние кавычки
  return `"${value.replace(/"/g, '\\"')}"`;
}

// ─── MAIN ───────────────────────────────────────────────────────
export async function writeAllMetadata() {
  console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════╗
║  METADATA WRITER — Stage 2                    ║
║  Запись метаданных в EXIF                     ║
╚════════════════════════════════════════════════╝`));

  const mapping = loadMapping();
  const processedIds = loadProgress();

  // Фильтруем: обрабатываем только фото, у которых есть данные из API
  const photosToProcess = mapping.photos.filter(p => {
    // Пропускаем уже обработанные
    if (processedIds.has(p.flickrId)) return false;
    // Пропускаем фото без данных API (22К iPhone-фото без привязки)
    const hasApiData = p.tags.length > 0 || p.description || p.geo || p.dateTaken;
    return hasApiData;
  });

  const totalPhotos = mapping.photos.filter(p => {
    const hasApiData = p.tags.length > 0 || p.description || p.geo || p.dateTaken;
    return hasApiData;
  }).length;

  const alreadyDone = processedIds.size;

  console.log(chalk.cyan(`\n   Всего фото с метаданными:   ${totalPhotos}`));
  console.log(chalk.cyan(`   Уже обработано (resume):    ${alreadyDone}`));
  console.log(chalk.cyan(`   Осталось к обработке:       ${photosToProcess.length}\n`));

  if (photosToProcess.length === 0) {
    console.log(chalk.green('   ✅ Все фото уже обработаны!'));
    return;
  }

  // Статистика
  const stats = {
    processed: alreadyDone,
    skipped: 0,
    errors: 0,
    tagsWritten: 0,
    gpsWritten: 0,
    dateWritten: 0,
    lightroomDetected: 0,
  };

  const startTime = Date.now();

  for (let i = 0; i < photosToProcess.length; i++) {
    const photo = photosToProcess[i];
    const num = alreadyDone + i + 1;

    // Прогресс каждые 100 фото
    if (i % 100 === 0 && i > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = i / elapsed;
      const remaining = (photosToProcess.length - i) / speed;
      const mins = Math.ceil(remaining / 60);

      console.log(chalk.yellow(
        `   [${num}/${totalPhotos}] Обработано: ${i} | ` +
        `Скорость: ${speed.toFixed(1)} фото/сек | ` +
        `Осталось: ~${mins} мин`
      ));

      // Промежуточное сохранение прогресса
      saveProgress(processedIds);
    }

    // Проверяем существование файла
    if (!fs.existsSync(photo.filePath)) {
      stats.skipped++;
      processedIds.add(photo.flickrId);
      continue;
    }

    // Читаем текущий EXIF
    const existingExif = readExif(photo.filePath);

    // Записываем метаданные
    const result = writeExif(photo.filePath, photo, existingExif);

    if (result.status === 'ok') {
      stats.processed++;
      if (photo.tags.length > 0) stats.tagsWritten++;
      if (result.gpsWritten) stats.gpsWritten++;
      if (result.dateWritten) stats.dateWritten++;
      if (result.isLightroom) stats.lightroomDetected++;
    } else if (result.status === 'skipped') {
      stats.skipped++;
    } else {
      stats.errors++;
      // Логируем ошибку, но не останавливаем процесс
      if (stats.errors <= 10) {
        console.log(chalk.red(`   ✗ ${photo.filename}: ${result.error}`));
      }
    }

    processedIds.add(photo.flickrId);
  }

  // Финальное сохранение
  saveProgress(processedIds);
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  // ── Отчёт ────────────────────────────────────────────────────
  printReport(stats, totalPhotos);
}

function printReport(stats, total) {
  console.log(chalk.bold('\n' + '═'.repeat(50)));
  console.log(chalk.bold('📊 ОТЧЁТ ЗАПИСИ МЕТАДАННЫХ'));
  console.log('═'.repeat(50));
  console.log(`   Всего обработано:      ${chalk.bold(stats.processed)}`);
  console.log(`   Пропущено:             ${chalk.yellow(stats.skipped)}`);
  console.log(`   Ошибки:                ${chalk.red(stats.errors)}`);
  console.log('─'.repeat(50));
  console.log(`   Теги записаны:         ${chalk.green(stats.tagsWritten)}`);
  console.log(`   GPS записан (Flickr):  ${chalk.green(stats.gpsWritten)}`);
  console.log(`   Дата записана:         ${chalk.green(stats.dateWritten)}`);
  console.log(`   Lightroom обнаружен:   ${chalk.blue(stats.lightroomDetected)}`);
  console.log('═'.repeat(50));
}

// Запуск напрямую
const currentFile = path.resolve(process.argv[1] || '');
if (currentFile === path.resolve('src/metadata-writer.js')) {
  writeAllMetadata()
    .then(() => {
      console.log(chalk.bold.green('\n🎉 Stage 2 (Metadata Writer) завершён!\n'));
      process.exit(0);
    })
    .catch((err) => {
      console.error(chalk.red('\n❌ Фатальная ошибка:'), err);
      process.exit(1);
    });
}
