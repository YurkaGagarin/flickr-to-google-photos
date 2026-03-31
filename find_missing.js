import fs from 'fs';
import path from 'path';

const CACHE_DIR = 'flickr_cache';
const MAPPING_PATH = path.join(CACHE_DIR, 'photo_mapping.json');
const PROGRESS_PATH = path.join(CACHE_DIR, 'upload_progress.json');

const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'));
const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'));

const uploadedIds = progress.uploadedIds || {};
const missing = mapping.photos.filter(p => !uploadedIds[p.flickrId]);

console.log('--- MISSING PHOTOS ---');
missing.forEach(p => {
  console.log(`Flickr ID: ${p.flickrId}`);
  console.log(`Path: ${p.filePath}`);
  console.log(`Filename: ${p.filename}`);
  console.log('----------------------');
});
