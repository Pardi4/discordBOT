const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { CONFIG } = require('../config/config');

// === FUNKCJE JSON ===
const loadJSON = (filePath, defaultValue = {}) => {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Błąd wczytywania ${filePath}:`, err);
    return defaultValue;
  }
};

const saveJSON = (filePath, data) => {
  try {
    // Upewnij się, że katalog istnieje
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Błąd zapisu ${filePath}:`, err);
  }
};

// === FUNKCJE KATALOGÓW ===
const createTempDir = () => {
  if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
    console.log(`Utworzono katalog tymczasowy: ${CONFIG.tempDir}`);
  }
};

const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
};

const cleanupTempDirectory = () => {
  try {
    if (!fs.existsSync(CONFIG.tempDir)) return;
    
    const files = fs.readdirSync(CONFIG.tempDir);
    let cleanedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(CONFIG.tempDir, file);
      try {
        const stats = fs.statSync(filePath);
        const ageInMs = Date.now() - stats.mtime.getTime();
        const ageInHours = ageInMs / (1000 * 60 * 60);
        
        // Usuń pliki starsze niż 1 godzina
        if (ageInHours > 1) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch (err) {
        console.error(`Błąd czyszczenia pliku ${filePath}:`, err);
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`Wyczyszczono ${cleanedCount} starych plików tymczasowych`);
    }
  } catch (err) {
    console.error('Błąd czyszczenia katalogu tymczasowego:', err);
  }
};

// === POBIERANIE PLIKÓW ===
const downloadFile = (url, filename) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(CONFIG.tempDir, filename);
    const file = fs.createWriteStream(filePath);
    const httpModule = url.startsWith('https:') ? https : http;
    
    const request = httpModule.get(url, (response) => {
      // Obsługa przekierowań
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, filename)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(filePath, () => {});
        reject(new Error(`Błąd pobierania: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      // Sprawdź rozmiar pliku (max 50MB)
      const contentLength = parseInt(response.headers['content-length']);
      if (contentLength && contentLength > 50 * 1024 * 1024) {
        file.close();
        fs.unlink(filePath, () => {});
        reject(new Error('Plik jest zbyt duży (max 50MB)'));
        return;
      }
      
      let downloadedBytes = 0;
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        // Sprawdź rozmiar w trakcie pobierania
        if (downloadedBytes > 50 * 1024 * 1024) {
          file.close();
          fs.unlink(filePath, () => {});
          reject(new Error('Plik przekroczył limit rozmiaru podczas pobierania'));
          return;
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`Pobrano plik: ${filename} (${downloadedBytes} bytes)`);
        resolve(filePath);
      });
    });
    
    request.on('error', (err) => {
      file.close();
      fs.unlink(filePath, () => {});
      reject(err);
    });
    
    file.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
    
    // Timeout dla pobierania (30 sekund)
    request.setTimeout(30000, () => {
      request.abort();
      file.close();
      fs.unlink(filePath, () => {});
      reject(new Error('Timeout pobierania pliku'));
    });
  });
};

// === FUNKCJE PLIKÓW AUDIO ===
const getAudioFileInfo = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    return {
      path: filePath,
      name: path.basename(filePath, ext),
      extension: ext,
      size: stats.size,
      sizeFormatted: formatFileSize(stats.size),
      modified: stats.mtime,
      isAudioFile: ['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(ext)
    };
  } catch (err) {
    console.error(`Błąd pobierania informacji o pliku ${filePath}:`, err);
    return null;
  }
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const isValidAudioFile = (filePath) => {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
  const ext = path.extname(filePath).toLowerCase();
  return audioExtensions.includes(ext);
};

const sanitizeFilename = (filename) => {
  // Usuń niebezpieczne znaki z nazw plików
  return filename
    .replace(/[<>:"/\\|?*]/g, '_') // Zastąp niebezpieczne znaki
    .replace(/\s+/g, '_') // Zastąp spacje podkreśleniami
    .substring(0, 100); // Ogranicz długość
};

// === FUNKCJE BACKUP I RESTORE ===
const createBackup = (backupName = null) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');
  const backupFileName = backupName || `backup_${timestamp}`;
  const backupPath = path.join(backupDir, `${backupFileName}.json`);
  
  try {
    ensureDirectoryExists(backupDir);
    
    const backupData = {
      timestamp: new Date().toISOString(),
      data: loadJSON(CONFIG.dataFile),
      users: loadJSON(CONFIG.usersFile),
      crossfade: loadJSON(CONFIG.crossfadeFile),
      version: '2.0'
    };
    
    saveJSON(backupPath, backupData);
    console.log(`Utworzono backup: ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error('Błąd tworzenia backupu:', err);
    return null;
  }
};

const restoreFromBackup = (backupPath) => {
  try {
    if (!fs.existsSync(backupPath)) {
      throw new Error('Plik backup nie istnieje');
    }
    
    const backupData = loadJSON(backupPath);
    
    if (!backupData.timestamp || !backupData.data) {
      throw new Error('Nieprawidłowy format backupu');
    }
    
    // Przywróć pliki
    if (backupData.data) saveJSON(CONFIG.dataFile, backupData.data);
    if (backupData.users) saveJSON(CONFIG.usersFile, backupData.users);
    if (backupData.crossfade) saveJSON(CONFIG.crossfadeFile, backupData.crossfade);
    
    console.log(`Przywrócono backup z: ${backupData.timestamp}`);
    return true;
  } catch (err) {
    console.error('Błąd przywracania backupu:', err);
    return false;
  }
};

const listBackups = () => {
  const backupDir = path.join(__dirname, '..', 'backups');
  
  try {
    if (!fs.existsSync(backupDir)) return [];
    
    return fs.readdirSync(backupDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        
        return {
          name: file,
          path: filePath,
          size: stats.size,
          created: stats.mtime,
          formatted: {
            size: formatFileSize(stats.size),
            created: stats.mtime.toLocaleString()
          }
        };
      })
      .sort((a, b) => b.created - a.created);
  } catch (err) {
    console.error('Błąd listowania backupów:', err);
    return [];
  }
};

// === MONITOROWANIE PLIKÓW ===
const watchConfigFiles = (callback) => {
  const filesToWatch = [CONFIG.dataFile, CONFIG.usersFile, CONFIG.crossfadeFile];
  const watchers = [];
  
  filesToWatch.forEach(file => {
    try {
      // Upewnij się, że plik istnieje
      if (!fs.existsSync(file)) {
        saveJSON(file, {});
      }
      
      const watcher = fs.watch(file, (eventType, filename) => {
        if (eventType === 'change') {
          console.log(`Plik konfiguracyjny został zmieniony: ${file}`);
          if (callback) callback(file, eventType);
        }
      });
      
      watchers.push(watcher);
    } catch (err) {
      console.error(`Błąd obserwowania pliku ${file}:`, err);
    }
  });
  
  return watchers;
};

// === CLEANUP FUNKCJA ===
const performMaintenance = () => {
  console.log('Rozpoczynam maintenance plików...');
  
  // Wyczyść stare pliki tymczasowe
  cleanupTempDirectory();
  
  // Stwórz automatyczny backup (jeden dziennie)
  const today = new Date().toISOString().split('T')[0];
  const dailyBackupPath = path.join(__dirname, '..', 'backups', `daily_${today}.json`);
  
  if (!fs.existsSync(dailyBackupPath)) {
    createBackup(`daily_${today}`);
  }
  
  // Usuń stare backupy (starsze niż 30 dni)
  const backups = listBackups();
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  backups.forEach(backup => {
    if (backup.created.getTime() < thirtyDaysAgo) {
      try {
        fs.unlinkSync(backup.path);
        console.log(`Usunięto stary backup: ${backup.name}`);
      } catch (err) {
        console.error(`Błąd usuwania backupu ${backup.name}:`, err);
      }
    }
  });
  
  console.log('Maintenance zakończony.');
};

module.exports = {
  // JSON
  loadJSON,
  saveJSON,
  
  // Katalogi
  createTempDir,
  ensureDirectoryExists,
  cleanupTempDirectory,
  
  // Pobieranie plików
  downloadFile,
  
  // Pliki audio
  getAudioFileInfo,
  formatFileSize,
  isValidAudioFile,
  sanitizeFilename,
  
  // Backup & Restore
  createBackup,
  restoreFromBackup,
  listBackups,
  
  // Monitoring
  watchConfigFiles,
  
  // Maintenance
  performMaintenance
};