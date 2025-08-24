const { 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus,
  StreamType 
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');
const { CONFIG } = require('../config/config');
const { CrossfadeManager } = require('./crossfadeManager');

class MusicQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.currentPlayer = null;
    this.nextPlayer = null;
    this.isLooping = false;
    this.connection = null;
    this.currentSong = null;
    this.currentMessage = null;
    this.messageChannel = null;
    this.leaveTimeout = null;
    this.crossfadeTimeout = null;
    this.isCrossfading = false;
    this.crossfadeManager = new CrossfadeManager();
    
    // Nowe właściwości dla zaawansowanego crossfade
    this.fadeVolume = 1.0;
    this.crossfadeData = null;
    this.isPreparingNext = false;
  }

  addSong(songData) {
    this.queue.push(songData);
  }

  removeSong(index) {
    if (index >= 0 && index < this.queue.length) {
      return this.queue.splice(index, 1)[0];
    }
    return null;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  clear() {
    this.queue = [];
    this.clearCrossfadeTimeout();
  }

  clearCrossfadeTimeout() {
    if (this.crossfadeTimeout) {
      clearTimeout(this.crossfadeTimeout);
      this.crossfadeTimeout = null;
    }
  }

  clearLeaveTimeout() {
    if (this.leaveTimeout) {
      clearTimeout(this.leaveTimeout);
      this.leaveTimeout = null;
    }
  }

  scheduleLeave() {
    this.clearLeaveTimeout();
    
    this.leaveTimeout = setTimeout(() => {
      if (this.connection) {
        this.connection.destroy();
        this.connection = null;
      }
      this.leaveTimeout = null;
      
      if (this.messageChannel) {
        this.messageChannel.send('👋 Opuszczam kanał po 5 minutach bezczynności.').catch(() => {});
      }
    }, CONFIG.leaveTimeout);
  }

  createFilteredResource(filePath, filterName, speed = 1.5) {
    const filterMap = {
      '8d': ['-af', 'apulsator=hz=0.125'],
      'echo': ['-af', 'aecho=0.8:0.9:1000:0.3'],
      'rate': ['-filter:a', `atempo=${speed}`],
      'pitch': ['-filter:a', 'asetrate=48000*1.2,aresample=48000'],
      'speed': ['-filter:a', `atempo=${speed}`],
      'bass': ['-af', 'equalizer=f=60:width_type=h:width=50:g=10,equalizer=f=170:width_type=h:width=50:g=10,volume=1.2'],
      'bassboost': ['-af', 'equalizer=f=60:width_type=h:width=50:g=15,equalizer=f=170:width_type=h:width=50:g=12,equalizer=f=310:width_type=h:width=50:g=8,volume=1.5']
    };

    let ffmpegArgs = ['-i', filePath, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
    
    if (filterName && filterMap[filterName]) {
      ffmpegArgs = ['-i', filePath, ...filterMap[filterName], '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
    }

    const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
    return createAudioResource(ffmpegProcess.stdout, { 
      inputType: StreamType.Raw,
      inlineVolume: true
    });
  }

  async prepareNextTrack() {
    if (this.queue.length === 0 || this.isPreparingNext) return null;
    
    this.isPreparingNext = true;
    const nextSong = this.queue[0];
    
    try {
      // Sprawdź czy crossfade jest możliwy
      if (this.crossfadeManager.shouldUseCrossfade(this.currentSong, nextSong)) {
        this.crossfadeData = await this.crossfadeManager.prepareCrossfadeData(
          this.currentSong.path,
          nextSong.path
        );
        
        if (this.crossfadeData.canCrossfade) {
          // Zaplanuj crossfade
          this.crossfadeTimeout = setTimeout(async () => {
            await this.executeCrossfade();
          }, this.crossfadeData.crossfadeStartTime);
          
          console.log(`Crossfade zaplanowany za ${this.crossfadeData.crossfadeStartTime}ms`);
        }
      }
    } catch (error) {
      console.error('Błąd przygotowania następnego utworu:', error);
    } finally {
      this.isPreparingNext = false;
    }
  }

  async executeCrossfade() {
    if (this.queue.length === 0 || this.isCrossfading) return;
    
    this.isCrossfading = true;
    const nextSong = this.queue.shift();
    
    try {
      console.log(`Rozpoczynam crossfade: ${this.currentSong.name} -> ${nextSong.name}`);
      
      // Tworzenie następnego playera z fade in
      const nextPlayer = createAudioPlayer();
      let nextResource;
      
      if (nextSong.filter || nextSong.speed !== 1.0) {
        nextResource = this.createFilteredResource(nextSong.path, nextSong.filter, nextSong.speed);
      } else {
        nextResource = await this.crossfadeManager.createAdvancedCrossfadeResource(
          nextSong.path,
          this.crossfadeData?.crossfadeType || this.crossfadeManager.settings.type,
          this.crossfadeData?.optimalCrossfadeTime || this.crossfadeManager.settings.duration,
          true, // isIntro
          this.crossfadeData?.nextAnalysis
        );
      }
      
      this.nextPlayer = nextPlayer;
      this.connection.subscribe(nextPlayer);
      nextPlayer.play(nextResource);
      
      // Zastosuj fade out do obecnego playera (jeśli obsługuje filtry)
      if (this.currentPlayer && this.currentSong && !this.currentSong.filter) {
        try {
          // Twórz fade out resource dla obecnego utworu
          const fadeOutDuration = this.crossfadeData?.optimalCrossfadeTime || this.crossfadeManager.settings.duration;
          const fadeOutResource = await this.crossfadeManager.createAdvancedCrossfadeResource(
            this.currentSong.path,
            this.crossfadeManager.settings.type,
            fadeOutDuration,
            false, // isFadeOut
            this.crossfadeData?.currentAnalysis
          );
          
          // Opcjonalnie: stopniowo zmniejszaj głośność obecnego playera
          if (this.currentPlayer.state.resource?.volume) {
            this.fadeOutCurrentTrack(fadeOutDuration);
          }
        } catch (error) {
          console.error('Błąd fade out:', error);
        }
      }
      
      // Po zakończeniu crossfade, zamień playery
      const crossfadeDuration = (this.crossfadeData?.optimalCrossfadeTime || this.crossfadeManager.settings.duration) * 1000;
      
      setTimeout(() => {
        this.completeCrossfade(nextSong);
      }, crossfadeDuration);
      
    } catch (error) {
      console.error('Błąd podczas crossfade:', error);
      this.isCrossfading = false;
      // Fallback do normalnego odtwarzania
      this.queue.unshift(nextSong);
    }
  }

  fadeOutCurrentTrack(duration) {
    if (!this.currentPlayer?.state.resource?.volume) return;
    
    const steps = 20;
    const stepDuration = (duration * 1000) / steps;
    const volumeStep = 1.0 / steps;
    let currentVolume = 1.0;
    
    const fadeInterval = setInterval(() => {
      currentVolume -= volumeStep;
      if (currentVolume <= 0) {
        currentVolume = 0;
        clearInterval(fadeInterval);
      }
      
      try {
        this.currentPlayer.state.resource.volume.setVolume(currentVolume);
      } catch (error) {
        clearInterval(fadeInterval);
      }
    }, stepDuration);
  }

  completeCrossfade(nextSong) {
    console.log(`Zakończono crossfade, teraz gra: ${nextSong.name}`);
    
    // Zatrzymaj poprzedni player
    if (this.currentPlayer) {
      this.currentPlayer.stop();
    }
    
    // Zamień playery
    this.currentPlayer = this.nextPlayer;
    this.nextPlayer = null;
    this.currentSong = nextSong;
    this.isCrossfading = false;
    this.crossfadeData = null;
    
    // Wyczyść stare wiadomości i wyślij nową
    if (this.currentMessage) {
      this.currentMessage.delete().catch(() => {});
      this.currentMessage = null;
    }
    
    // Event listeners dla nowego playera
    this.setupPlayerEvents();
    
    // Przygotuj następny utwór jeśli istnieje
    if (this.queue.length > 0) {
      this.prepareNextTrack();
    }
  }

  setupPlayerEvents() {
    if (!this.currentPlayer) return;
    
    this.currentPlayer.on(AudioPlayerStatus.Idle, () => {
      this.handleTrackEnd();
    });
    
    this.currentPlayer.on('error', error => {
      console.error('Błąd audio playera:', error);
      this.handleTrackEnd();
    });
  }

  handleTrackEnd() {
    this.clearCrossfadeTimeout();
    
    if (this.currentSong?.isTemp) {
      this.cleanupTempFile(this.currentSong);
    }
    
    if (this.isLooping && this.currentSong) {
      this.queue.unshift(this.currentSong);
    }
    
    // Jeśli nie ma aktywnego crossfade, przejdź do następnego utworu
    if (!this.isCrossfading) {
      if (this.queue.length === 0) {
        this.currentSong = null;
        this.currentPlayer = null;
        this.nextPlayer = null;
        this.scheduleLeave();
      }
      // Następny utwór zostanie obsłużony przez główny playNextInQueue
    }
  }

  cleanupTempFile(songData) {
    if (songData.isTemp && fs.existsSync(songData.path)) {
      setTimeout(() => {
        fs.unlink(songData.path, (err) => {
          if (err) console.error('Błąd usuwania pliku tymczasowego:', err);
          else console.log('Usunięto plik tymczasowy:', songData.path);
        });
      }, 5000);
    }
  }

  reset(destroyConnection = true) {
    this.queue = [];
    this.currentSong = null;
    this.isLooping = false;
    this.messageChannel = null;
    this.isCrossfading = false;
    this.isPreparingNext = false;
    this.crossfadeData = null;
    
    this.clearLeaveTimeout();
    this.clearCrossfadeTimeout();
    
    if (this.currentPlayer) {
      this.currentPlayer.stop();
      this.currentPlayer = null;
    }
    
    if (this.nextPlayer) {
      this.nextPlayer.stop();
      this.nextPlayer = null;
    }
    
    if (this.connection && destroyConnection) {
      this.connection.destroy();
      this.connection = null;
    }
    
    if (this.currentMessage) {
      this.currentMessage.delete().catch(() => {});
      this.currentMessage = null;
    }
  }

  // Gettery dla kompatybilności
  get length() {
    return this.queue.length;
  }

  getCurrentSong() {
    return this.currentSong;
  }

  getQueue() {
    return [...this.queue];
  }

  getStatus() {
    return {
      isPlaying: this.currentPlayer?.state.status === AudioPlayerStatus.Playing,
      isPaused: this.currentPlayer?.state.status === AudioPlayerStatus.Paused,
      isCrossfading: this.isCrossfading,
      isLooping: this.isLooping,
      queueLength: this.queue.length,
      currentSong: this.currentSong
    };
  }
}

// Singleton manager dla wszystkich kolejek
class MusicQueueManager {
  constructor() {
    this.queues = new Map();
  }

  getQueue(guildId) {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, new MusicQueue(guildId));
    }
    return this.queues.get(guildId);
  }

  resetQueue(guildId, destroyConnection = true) {
    const queue = this.getQueue(guildId);
    queue.reset(destroyConnection);
  }

  getAllQueues() {
    return this.queues;
  }
}

module.exports = { MusicQueue, MusicQueueManager };