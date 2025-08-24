const { AudioPlayer } = require('./audioPlayer');
const { MusicQueueManager } = require('./musicQueue');
const { SoundManager } = require('./soundManager');
const { CONFIG } = require('../config/config');
const { loadJSON } = require('../utils/fileUtils');

class VoiceManager {
  constructor(client, statusManager) {
    this.client = client;
    this.statusManager = statusManager;
    this.queueManager = new MusicQueueManager();
    this.audioPlayer = new AudioPlayer(this.queueManager);
    this.soundManager = new SoundManager();
  }

  async handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    
    const userName = member.user.username;

    // Wejście lub przełączenie kanału
    if ((!oldState.channel && newState.channel) || 
        (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id)) {
      
      await this.handleUserJoin(userName, newState.channel, newState.guild);
    }

    // Wyjście z kanału lub wyrzucenie
    if (oldState.channel && !newState.channel) {
      await this.handleUserLeave(userName, oldState.channel, oldState.guild);
    }

    // Bot został rozłączony
    if (member.user.id === this.client.user.id && oldState.channel && !newState.channel) {
      console.log('Bot został rozłączony z kanału głosowego - resetowanie kolejki');
      this.queueManager.resetQueue(oldState.guild.id, false);
    }
  }

  async handleUserJoin(userName, channel, guild) {
    // Aktualizuj status dla Patryka
    if (userName === CONFIG.users.patryk) {
      this.statusManager.setOnlineStatus();
    }

    // Odtwórz dźwięk join
    await this.playJoinSound(userName, channel, guild);
  }

  async handleUserLeave(userName, channel, guild) {
    const users = loadJSON(CONFIG.usersFile);
    
    // Odtwórz dźwięk quit jeśli nie jest wyłączony
    if (!users[userName]?.soundsDisabled) {
      await this.playQuitSound(channel, guild);
    }
    
    // Zaktualizuj status dla Patryka
    if (userName === CONFIG.users.patryk) {
      this.statusManager.setPatrykOfflineStatus();
      console.log(`${userName} opuścił kanał. Timestamp: ${new Date().toLocaleString()}`);
    }
  }

  async playJoinSound(userName, channel, guild) {
    const users = loadJSON(CONFIG.usersFile);
    if (users[userName]?.soundsDisabled) return;

    const queueData = this.queueManager.getQueue(guild.id);
    if (queueData.currentPlayer?.state.status === 'Playing') return;

    const joinSoundPath = this.soundManager.getJoinSoundPath(userName);
    if (!joinSoundPath) return;

    await this.audioPlayer.playJoinSound(userName, channel, guild);
  }

  async playQuitSound(channel, guild) {
    const queueData = this.queueManager.getQueue(guild.id);
    if (queueData.currentPlayer?.state.status === 'Playing') return;

    const quitSoundPath = this.soundManager.getJoinSoundPath('Quit');
    if (!quitSoundPath) return;

    await this.audioPlayer.playJoinSound('Quit', channel, guild);
  }

  // Metody dostępowe dla innych modułów
  getQueue(guildId) {
    return this.queueManager.getQueue(guildId);
  }

  resetQueue(guildId, destroyConnection = true) {
    return this.queueManager.resetQueue(guildId, destroyConnection);
  }

  getAllQueues() {
    return this.queueManager.getAllQueues();
  }

  // Statystyki voice managera
  getVoiceStats() {
    const allQueues = this.getAllQueues();
    const stats = {
      activeQueues: 0,
      totalSongsInQueues: 0,
      playingQueues: 0,
      crossfadingQueues: 0
    };

    allQueues.forEach((queue) => {
      if (queue.length > 0 || queue.currentSong) {
        stats.activeQueues++;
        stats.totalSongsInQueues += queue.length;
        
        if (queue.currentPlayer?.state.status === 'Playing') {
          stats.playingQueues++;
        }
        
        if (queue.isCrossfading) {
          stats.crossfadingQueues++;
        }
      }
    });

    return stats;
  }
}

module.exports = { VoiceManager };