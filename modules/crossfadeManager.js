const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const ffmpeg = require('ffmpeg-static');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { loadJSON, saveJSON } = require('../utils/fileUtils');
const { CONFIG } = require('../config/config');

class CrossfadeManager {
  constructor() {
    this.settings = this.loadSettings();
  }

  loadSettings() {
    return loadJSON(CONFIG.crossfadeFile, CONFIG.crossfade);
  }

  saveSettings(settings) {
    saveJSON(CONFIG.crossfadeFile, settings);
    this.settings = settings;
  }

  async getAudioDuration(filePath) {
    try {
      const { stdout } = await execFile('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath
      ]);
      return parseFloat(stdout.trim());
    } catch (error) {
      console.error('Błąd pobierania długości audio:', error);
      return CONFIG.avgSongLength / 1000;
    }
  }

  async getAudioAnalysis(filePath) {
    try {
      // Analiza RMS, peak i spektrum dla lepszego crossfade
      const { stdout } = await execFile('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'frame=pkt_dts_time',
        '-select_streams', 'a:0',
        '-of', 'csv=p=0',
        '-read_intervals', '%+#50',
        filePath
      ]);
      
      // Podstawowa analiza - w przyszłości można rozszerzyć o beat detection
      return {
        hasBeats: false, // placeholder dla przyszłego beat detection
        avgRMS: 0.5, // placeholder
        peakLevel: 0.8 // placeholder
      };
    } catch (error) {
      console.error('Błąd analizy audio:', error);
      return { hasBeats: false, avgRMS: 0.5, peakLevel: 0.8 };
    }
  }

  createDJCrossfadeFilter(fadeType, fadeTime, isIntro = false, analysis = null) {
    const baseFilters = [];
    
    if (this.settings.djMode.enabled) {
      if (isIntro) {
        // Fade IN - DJ style
        baseFilters.push(`afade=t=in:st=0:d=${fadeTime}:curve=exp`);
        
        if (this.settings.djMode.highBoost) {
          // Wzmocnij wysokie częstotliwości na początku
          baseFilters.push('equalizer=f=8000:width_type=h:width=1000:g=3');
        }
        
        if (this.settings.djMode.stereoSpread) {
          // Rozszerzenie stereo
          baseFilters.push('extrastereo=m=2.5');
        }
        
        if (this.settings.autoGain && analysis) {
          // Automatyczne wyrównanie głośności
          const gainAdjust = Math.max(0.5, 1.0 / analysis.peakLevel);
          baseFilters.push(`volume=${gainAdjust}`);
        }
        
      } else {
        // Fade OUT - DJ style
        baseFilters.push(`afade=t=out:st=${fadeTime}:d=${fadeTime}:curve=log`);
        
        if (this.settings.djMode.lowCut) {
          // Przytnij basy przed końcem
          baseFilters.push('highpass=f=100');
        }
        
        if (this.settings.eqCrossfade) {
          // Delikatne EQ podczas fade out
          baseFilters.push('equalizer=f=2000:width_type=h:width=500:g=-2');
        }
      }
    } else {
      // Klasyczne fade modes
      const fadeMap = {
        linear: isIntro ? `afade=t=in:st=0:d=${fadeTime}` : `afade=t=out:st=${fadeTime}:d=${fadeTime}`,
        exponential: isIntro ? `afade=t=in:st=0:d=${fadeTime}:curve=exp` : `afade=t=out:st=${fadeTime}:d=${fadeTime}:curve=exp`,
        logarithmic: isIntro ? `afade=t=in:st=0:d=${fadeTime}:curve=log` : `afade=t=out:st=${fadeTime}:d=${fadeTime}:curve=log`,
        dj: isIntro ? `afade=t=in:st=0:d=${fadeTime}:curve=exp` : `afade=t=out:st=${fadeTime}:d=${fadeTime}:curve=log`
      };
      
      baseFilters.push(fadeMap[fadeType] || fadeMap.dj);
    }
    
    return baseFilters.join(',');
  }

  async createAdvancedCrossfadeResource(filePath, fadeType, fadeTime, isIntro = false, analysis = null) {
    const filterComplex = this.createDJCrossfadeFilter(fadeType, fadeTime, isIntro, analysis);
    
    const ffmpegArgs = [
      '-i', filePath,
      '-af', filterComplex,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ];

    const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { 
      stdio: ['ignore', 'pipe', 'ignore'] 
    });
    
    return createAudioResource(ffmpegProcess.stdout, { 
      inputType: StreamType.Raw,
      inlineVolume: true // Pozwala na kontrolę głośności w real-time
    });
  }

  shouldUseCrossfade(currentSong, nextSong) {
    if (!this.settings.enabled) return false;
    if (!currentSong || !nextSong) return false;
    if (currentSong.isTemp || nextSong.isTemp) return false;
    if (currentSong.filter || nextSong.filter) return false;
    
    // Dodatkowe sprawdzenia dla DJ mode
    if (this.settings.djMode.enabled) {
      // Można dodać sprawdzenie BPM, gatunku, itp.
      return true;
    }
    
    return true;
  }

  calculateOptimalCrossfadeTime(currentDuration, nextDuration) {
    const minDuration = Math.min(currentDuration, nextDuration);
    const maxCrossfade = Math.floor(minDuration / 4); // max 1/4 długości krótszego utworu
    
    if (this.settings.djMode.enabled) {
      // W trybie DJ, crossfade może być dłuższy
      return Math.min(this.settings.duration, maxCrossfade, 10);
    }
    
    return Math.min(this.settings.duration, maxCrossfade);
  }

  async prepareCrossfadeData(currentPath, nextPath) {
    const [currentDuration, nextDuration, currentAnalysis, nextAnalysis] = await Promise.all([
      this.getAudioDuration(currentPath),
      this.getAudioDuration(nextPath),
      this.getAudioAnalysis(currentPath),
      this.getAudioAnalysis(nextPath)
    ]);

    const optimalCrossfadeTime = this.calculateOptimalCrossfadeTime(currentDuration, nextDuration);
    const crossfadeStartTime = Math.max(0, (currentDuration - optimalCrossfadeTime) * 1000);

    return {
      currentDuration,
      nextDuration,
      currentAnalysis,
      nextAnalysis,
      optimalCrossfadeTime,
      crossfadeStartTime,
      canCrossfade: currentDuration > this.settings.minTrackLength && nextDuration > this.settings.minTrackLength
    };
  }

  // Metody do aktualizacji ustawień
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings(this.settings);
  }

  toggleDJMode() {
    this.settings.djMode.enabled = !this.settings.djMode.enabled;
    this.saveSettings(this.settings);
    return this.settings.djMode.enabled;
  }

  setDuration(duration) {
    if (duration >= 1 && duration <= 15) { // Zwiększony limit dla DJ mode
      this.settings.duration = duration;
      this.saveSettings(this.settings);
      return true;
    }
    return false;
  }

  setType(type) {
    const validTypes = ['dj', 'linear', 'exponential', 'logarithmic'];
    if (validTypes.includes(type)) {
      this.settings.type = type;
      this.saveSettings(this.settings);
      return true;
    }
    return false;
  }

  getSettingsEmbed() {
    return {
      enabled: this.settings.enabled,
      duration: this.settings.duration,
      type: this.settings.type,
      minTrackLength: this.settings.minTrackLength,
      djMode: this.settings.djMode,
      eqCrossfade: this.settings.eqCrossfade,
      autoGain: this.settings.autoGain,
      beatMatching: this.settings.beatMatching
    };
  }
}

module.exports = { CrossfadeManager };