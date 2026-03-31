import fs from 'fs';
import path from 'path';
import http from 'http';
import { google } from 'googleapis';
import open from 'open';

const CREDENTIALS_PATH = path.resolve('credentials.json');
const TOKEN_PATH = path.resolve('token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.appendonly',           // Загрузка фото + создание альбомов
  'https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata', // Управление альбомами (добавление фото)
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata', // Чтение загруженных фото (верификация)
];
const REDIRECT_PORT = 3333;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

/**
 * Загружает или создает OAuth2 клиент с валидным токеном.
 * При первом запуске откроет браузер для авторизации.
 */
export async function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  
  // Google Cloud Desktop credentials используют "installed" ключ
  const { client_id, client_secret } = credentials.installed || credentials.web;
  
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  // Если токен уже есть — загружаем
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);
    
    // Проверяем, не истек ли токен
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log('🔄 Токен истек, обновляю...');
      const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCreds);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(newCreds, null, 2));
      console.log('✅ Токен обновлен');
    }
    
    return oauth2Client;
  }

  // Первый запуск — нужна авторизация через браузер
  return authorizeInteractive(oauth2Client);
}

/**
 * Открывает браузер для OAuth и ловит callback на локальном сервере
 */
async function authorizeInteractive(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        const code = url.searchParams.get('code');
        
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>❌ Ошибка: код авторизации не получен</h1>');
          return;
        }

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>✅ Авторизация прошла успешно!</h1><p>Можете закрыть эту вкладку.</p>');
        
        console.log('✅ Авторизация завершена, токен сохранен в token.json');
        server.close();
        resolve(oauth2Client);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>❌ Ошибка авторизации</h1><pre>${err.message}</pre>`);
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`\n🔐 Открываю браузер для авторизации Google Photos...`);
      console.log(`   Если браузер не открылся, перейдите вручную:\n   ${authUrl}\n`);
      open(authUrl);
    });
  });
}

// Если запущен напрямую — выполняем авторизацию
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('src/auth.js')) {
  getAuthClient()
    .then(() => {
      console.log('🎉 Готово! OAuth клиент настроен.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Ошибка авторизации:', err.message);
      process.exit(1);
    });
}
