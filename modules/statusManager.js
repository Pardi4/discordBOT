const { ActivityType } = require('discord.js');
const { CONFIG } = require('../config/config');
const { loadJSON, saveJSON } = require('../utils/fileUtils');

class StatusManager {
  constructor(client) {
    this.client = client;
    this.lastJoinTimestamp = null;
    this.status = { name: 'muzykę 🎵', type: ActivityType.Playing };
    this.dynamicStatusInterval = null;
  }

  initialize() {
    const loadedData = loadJSON(CONFIG.dataFile);
    if (loadedData.lastJoinTimestamp) {
      this.lastJoinTimestamp = loadedData.lastJoinTimestamp;
    }
    if (loadedData.status) {
      this.status = loadedData.status;
    }

    if (this.status.name === 'dynamic') {
      this.startDynamicOfflineStatus();
    } else {
      this.client.user.setPresence({ 
        status: 'online', 
        activities: [this.status] 
      });
    }
  }

  setOnlineStatus() {
    this.status = { 
      name: `${CONFIG.users.patryk} jest na kanale`, 
      type: ActivityType.Playing 
    };
    
    this.clearDynamicInterval();
    
    this.client.user.setPresence({ 
      status: 'online', 
      activities: [this.status] 
    });
    
    this.saveData();
  }

  setPatrykOfflineStatus() {
    this.lastJoinTimestamp = Date.now();
    this.saveData();
    this.startDynamicOfflineStatus();
  }

  startDynamicOfflineStatus() {
    if (!this.lastJoinTimestamp) {
      this.lastJoinTimestamp = Date.now();
    }
    
    this.clearDynamicInterval();

    const updateDynamicStatus = () => {
      const diff = Date.now() - this.lastJoinTimestamp;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      
      this.client.user.setPresence({
        status: 'online',
        activities: [{
          name: `Patryk liże stopy basi od: ${days}d ${hours}h ${minutes}m`,
          type: ActivityType.Playing
        }]
      });
    };

    updateDynamicStatus();
    this.dynamicStatusInterval = setInterval(updateDynamicStatus, 60 * 1000);
    this.status = { name: 'dynamic', type: 0 };
    this.saveData();
  }

  setCustomStatus(name, type) {
    this.clearDynamicInterval();
    
    this.status = { name, type };
    this.client.user.setPresence({ 
      status: 'online', 
      activities: [this.status] 
    });
    
    this.saveData();
  }

  setMusicStatus(songName, isPlaying = true) {
    if (this.status.name === 'dynamic') return; // Nie zmieniaj jeśli jest dynamiczny

    const musicStatus = {
      name: isPlaying ? `🎵 ${songName}` : 'muzykę 🎵',
      type: ActivityType.Playing
    };

    this.client.user.setPresence({
      status: 'online',
      activities: [musicStatus]
    });

    // Nie zapisuj statusu muzycznego - to jest tymczasowe
  }

  setCrossfadeStatus(fromSong, toSong) {
    if (this.status.name === 'dynamic') return;

    const crossfadeStatus = {
      name: `🎛️ ${fromSong} ↔️ ${toSong}`,
      type: ActivityType.Playing
    };

    this.client.user.setPresence({
      status: 'online',
      activities: [crossfadeStatus]
    });
  }

  setIdleStatus() {
    if (this.status.name === 'dynamic') return;

    const idleStatus = {
      name: 'w trybie oczekiwania 💤',
      type: ActivityType.Playing
    };

    this.client.user.setPresence({
      status: 'idle',
      activities: [idleStatus]
    });
  }

  restoreMainStatus() {
    if (this.status.name === 'dynamic') {
      // Jeśli był dynamiczny, nie przywracaj
      return;
    }

    this.client.user.setPresence({
      status: 'online',
      activities: [this.status]
    });
  }

  clearDynamicInterval() {
    if (this.dynamicStatusInterval) {
      clearInterval(this.dynamicStatusInterval);
      this.dynamicStatusInterval = null;
    }
  }

  saveData() {
    const data = {
      lastJoinTimestamp: this.lastJoinTimestamp,
      status: this.status
    };
    saveJSON(CONFIG.dataFile, data);
  }

  // Gettery
  getLastJoinTimestamp() {
    return this.lastJoinTimestamp;
  }

  getCurrentStatus() {
    return this.status;
  }

  isDynamicStatus() {
    return this.status.name === 'dynamic';
  }

  // Metody pomocnicze dla statystyk
  getUptimeInfo() {
    if (!this.lastJoinTimestamp) {
      return {
        hasTimestamp: false,
        message: 'Patryk nie był na kanale od restartu bota'
      };
    }

    const diff = Date.now() - this.lastJoinTimestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);

    return {
      hasTimestamp: true,
      days,
      hours,
      minutes,
      totalMinutes: Math.floor(diff / (1000 * 60)),
      message: `${days}d ${hours}h ${minutes}m`
    };
  }

  // Cleanup przy wyłączaniu bota
  cleanup() {
    this.clearDynamicInterval();
    this.saveData();
  }
}

module.exports = { StatusManager };