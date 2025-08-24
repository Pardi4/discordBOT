const path = require('path');

const CONFIG = {
  // Ścieżki plików
  dataFile: path.join(__dirname, '..', 'data.json'),
  usersFile: path.join(__dirname, '..', 'users.json'),
  crossfadeFile: path.join(__dirname, '..', 'crossfade.json'),
  tempDir: path.join(__dirname, '..', 'temp'),
  soundsDir: path.join(__dirname, '..', 'sounds'),
  
  // Użytkownicy
  users: {
    patryk: 'freerice900',
    lotus: '._lotus',
    kaktus: 'kaktucat',
    pardi: 'pardi1'
  },
  
  // Ustawienia muzyki
  avgSongLength: 30000, // średnia długość utworu w ms (30s)
  validFilters: ['8d', 'echo', 'rate', 'pitch', 'bass', 'bassboost', 'speed'],
  leaveTimeout: 5 * 60 * 1000, // 5 minut w milisekundach
  
  // Ustawienia crossfade (ulepszone dla DJ-skiego stylu)
  crossfade: {
    enabled: true,
    duration: 5, // sekundy
    type: 'dj', // dj, linear, exponential, logarithmic
    minTrackLength: 15, // minimalna długość utworu dla crossfade w sekundach
    eqCrossfade: true, // włącz EQ podczas crossfade
    beatMatching: false, // przyszła funkcja dla YouTube
    autoGain: true, // automatyczne wyrównanie głośności
    djMode: {
      enabled: true,
      lowCut: true, // przytnij basy podczas fade out
      highBoost: true, // wzmocnij wysokie częstotliwości podczas fade in
      stereoSpread: true // rozszerzenie stereo podczas przejścia
    }
  },

  // Kanały (dla przyszłych funkcji)
  channels: {
    announcement: '1399804703491231774'
  },

  // Ustawienia YouTube (przygotowanie na przyszłość)
  youtube: {
    enabled: false, // na razie wyłączone
    quality: 'highestaudio',
    maxDuration: 600, // 10 minut
    playlistLimit: 50
  }
};

module.exports = { CONFIG };