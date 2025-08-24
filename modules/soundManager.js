const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config/config');
const { levenshteinDistance } = require('../utils/stringUtils');

class SoundManager {
  constructor() {
    this.soundsFolder = path.join(CONFIG.soundsDir, 'sounds');
  }

  getAllSounds() {
    try {
      if (!fs.existsSync(this.soundsFolder)) {
        return [];
      }
      
      return fs.readdirSync(this.soundsFolder)
        .filter(f => f.endsWith('.mp3'))
        .map(f => f.replace('.mp3', ''))
        .sort();
    } catch (err) {
      console.error('Błąd odczytywania foldera dźwięków:', err);
      return [];
    }
  }

  findClosestSound(searchName) {
    const files = this.getAllSounds();
    if (files.length === 0) return null;
    
    return files.reduce((closest, file) => {
      const distance = levenshteinDistance(searchName.toLowerCase(), file.toLowerCase());
      return distance < closest.distance ? { file, distance } : closest;
    }, { file: files[0], distance: Infinity }).file;
  }

  createSongData(soundName, requestedBy, filter = null, speed = 1.0, isTemp = false) {
    const soundPath = path.join(this.soundsFolder, `${soundName}.mp3`);
    
    return {
      name: soundName,
      path: soundPath,
      filter: filter,
      speed: speed,
      requestedBy: requestedBy,
      isTemp: isTemp
    };
  }

  findAndCreateSongData(searchName, requestedBy, filter = null, speed = 1.0) {
    let soundPath = path.join(this.soundsFolder, `${searchName}.mp3`);
    let actualSoundName = searchName;

    // Jeśli nie znaleziono dokładnego dopasowania, znajdź najbliższy
    if (!fs.existsSync(soundPath)) {
      const closestSound = this.findClosestSound(searchName);
      if (closestSound) {
        soundPath = path.join(this.soundsFolder, `${closestSound}.mp3`);
        actualSoundName = closestSound;
      } else {
        return null;
      }
    }

    return this.createSongData(actualSoundName, requestedBy, filter, speed);
  }

  async playRandomFromFolder(folderName, voiceChannel) {
    const folderPath = path.join(CONFIG.soundsDir, folderName);
    
    if (!fs.existsSync(folderPath)) return false;
    
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return false;
    
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const soundPath = path.join(folderPath, randomFile);

    // To będzie obsługiwane przez AudioPlayer
    return { path: soundPath, name: randomFile.replace('.mp3', '') };
  }

  async showSoundsWithButtons(message) {
    const files = this.getAllSounds();
    
    if (files.length === 0) {
      return message.reply('❌ Brak plików dźwiękowych w folderze.');
    }

    const soundsPerPage = 15;
    const totalPages = Math.ceil(files.length / soundsPerPage);
    let currentPage = 0;

    const generateEmbed = (page) => {
      const start = page * soundsPerPage;
      const end = Math.min(start + soundsPerPage, files.length);
      const pageSounds = files.slice(start, end);

      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🎵 Dostępne Dźwięki 2.0')
        .setDescription(`Lista wszystkich dostępnych dźwięków (${files.length} łącznie)`)
        .addFields({
          name: `📜 Strona ${page + 1}/${totalPages}`,
          value: pageSounds.map((sound, index) => 
            `\`${start + index + 1}.\` ${sound}`
          ).join('\n'),
          inline: false
        });

      embed.addFields({
        name: '🎛️ Crossfade Info',
        value: 'Wszystkie lokalne pliki MP3 obsługują zaawansowany crossfade DJ Mode',
        inline: true
      });

      embed.setFooter({ 
        text: 'Użyj przycisków aby nawigować lub odtworzyć dźwięk • Kliknij "🎲 Losowy" dla przypadkowego dźwięku' 
      })
      .setTimestamp();

      return embed;
    };

    const generateButtons = (page, sounds) => {
      const rows = [];
      
      // Pierwszy rząd - nawigacja i opcje specjalne
      const navRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('sounds_prev')
            .setLabel('◀️ Poprzednia')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('sounds_random')
            .setLabel('🎲 Losowy')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('sounds_random_playlist')
            .setLabel('🔀 Losowa Playlista')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('sounds_next')
            .setLabel('▶️ Następna')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages - 1)
        );

      rows.push(navRow);

      // Pozostałe rzędy - dźwięki z aktualnej strony (max 5 na rząd)
      const start = page * soundsPerPage;
      const pageSounds = sounds.slice(start, Math.min(start + soundsPerPage, sounds.length));
      
      for (let i = 0; i < pageSounds.length; i += 5) {
        const soundRow = new ActionRowBuilder();
        const rowSounds = pageSounds.slice(i, Math.min(i + 5, pageSounds.length));
        
        rowSounds.forEach((sound, index) => {
          const globalIndex = start + i + index;
          soundRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`play_${sound}`)
              .setLabel(`${globalIndex + 1}. ${sound.length > 15 ? sound.substring(0, 12) + '...' : sound}`)
              .setStyle(ButtonStyle.Secondary)
          );
        });
        
        rows.push(soundRow);
      }

      return rows;
    };

    const embed = generateEmbed(currentPage);
    const components = generateButtons(currentPage, files);

    const reply = await message.reply({ 
      embeds: [embed], 
      components: components 
    });

    // Collector dla przycisków
    const collector = reply.createMessageComponentCollector({ 
      time: 300000 // 5 minut
    });

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ 
          content: '❌ Tylko osoba która wywołała komendę może używać tych przycisków.', 
          ephemeral: true 
        });
      }

      const voiceChannel = interaction.member?.voice?.channel;
      
      if (interaction.customId === 'sounds_prev') {
        currentPage = Math.max(0, currentPage - 1);
        const newEmbed = generateEmbed(currentPage);
        const newComponents = generateButtons(currentPage, files);
        await interaction.update({ embeds: [newEmbed], components: newComponents });
        
      } else if (interaction.customId === 'sounds_next') {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
        const newEmbed = generateEmbed(currentPage);
        const newComponents = generateButtons(currentPage, files);
        await interaction.update({ embeds: [newEmbed], components: newComponents });
        
      } else if (interaction.customId === 'sounds_random') {
        if (!voiceChannel) {
          return interaction.reply({ 
            content: '❌ Musisz być na kanale głosowym, aby puścić dźwięk.', 
            ephemeral: true 
          });
        }
        
        await this.handleRandomSound(interaction, files, voiceChannel, message);
        
      } else if (interaction.customId === 'sounds_random_playlist') {
        if (!voiceChannel) {
          return interaction.reply({ 
            content: '❌ Musisz być na kanale głosowym, aby uruchomić playlistę.', 
            ephemeral: true 
          });
        }
        
        await this.handleRandomPlaylist(interaction, files, voiceChannel, message);
        
      } else if (interaction.customId.startsWith('play_')) {
        if (!voiceChannel) {
          return interaction.reply({ 
            content: '❌ Musisz być na kanale głosowym, aby puścić dźwięk.', 
            ephemeral: true 
          });
        }
        
        const soundName = interaction.customId.replace('play_', '');
        await this.handleSoundPlay(interaction, soundName, voiceChannel, message);
      }
    });

    collector.on('end', () => {
      const disabledComponents = components.map(row => {
        const newRow = new ActionRowBuilder();
        row.components.forEach(button => {
          newRow.addComponents(
            ButtonBuilder.from(button).setDisabled(true)
          );
        });
        return newRow;
      });

      reply.edit({ components: disabledComponents }).catch(() => {});
    });

    return;
  }

  async handleRandomSound(interaction, files, voiceChannel, originalMessage) {
    const randomSound = files[Math.floor(Math.random() * files.length)];
    const songData = this.createSongData(randomSound, interaction.user.username);
    
    // Import AudioPlayer dynamically to avoid circular dependency
    const { AudioPlayer } = require('./audioPlayer');
    const { MusicQueueManager } = require('./musicQueue');
    
    const queueManager = new MusicQueueManager();
    const audioPlayer = new AudioPlayer(queueManager);
    const queueData = queueManager.getQueue(interaction.guild.id);
    
    queueData.messageChannel = originalMessage.channel;
    queueData.addSong(songData);

    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === 'Idle') {
      await audioPlayer.playNextInQueue(interaction.guild.id, voiceChannel);
      await interaction.reply({ 
        content: `🎲 Losowy dźwięk: **${randomSound}.mp3**`, 
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: `🎲 Dodano losowy dźwięk do kolejki: **${randomSound}.mp3** (pozycja: ${queueData.length})`, 
        ephemeral: true 
      });
    }
  }

  async handleRandomPlaylist(interaction, files, voiceChannel, originalMessage) {
    // Wymieszaj pliki
    const shuffledFiles = [...files];
    for (let i = shuffledFiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledFiles[i], shuffledFiles[j]] = [shuffledFiles[j], shuffledFiles[i]];
    }

    // Import AudioPlayer dynamically to avoid circular dependency
    const { AudioPlayer } = require('./audioPlayer');
    const { MusicQueueManager } = require('./musicQueue');
    
    const queueManager = new MusicQueueManager();
    const audioPlayer = new AudioPlayer(queueManager);
    const queueData = queueManager.getQueue(interaction.guild.id);
    
    queueData.messageChannel = originalMessage.channel;
    
    // Dodaj wszystkie pliki do kolejki
    shuffledFiles.forEach(soundName => {
      const songData = this.createSongData(soundName, interaction.user.username);
      queueData.addSong(songData);
    });

    // Uruchom odtwarzanie
    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === 'Idle') {
      await audioPlayer.playNextInQueue(interaction.guild.id, voiceChannel);
    }

    const totalTime = queueData.length * CONFIG.avgSongLength;
    
    await interaction.reply({
      content: [
        `🔀 **Uruchomiono losową playlistę!**`,
        `📊 **Utwory:** ${files.length}`,
        `⏱️ **Szacowany czas:** ~${this.formatTime(totalTime)}`,
        `🎛️ **Crossfade:** ${queueData.crossfadeManager.settings.enabled ? 'Włączony' : 'Wyłączony'}`,
        `🎵 **Pierwsze 3:** ${shuffledFiles.slice(0, 3).join(', ')}`
      ].join('\n'),
      ephemeral: true
    });
  }

  async handleSoundPlay(interaction, soundName, voiceChannel, originalMessage) {
    const soundPath = path.join(this.soundsFolder, `${soundName}.mp3`);
    
    if (!fs.existsSync(soundPath)) {
      return interaction.reply({ 
        content: `❌ Nie znaleziono pliku: ${soundName}.mp3`, 
        ephemeral: true 
      });
    }

    const songData = this.createSongData(soundName, interaction.user.username);
    
    // Import AudioPlayer dynamically to avoid circular dependency
    const { AudioPlayer } = require('./audioPlayer');
    const { MusicQueueManager } = require('./musicQueue');
    
    const queueManager = new MusicQueueManager();
    const audioPlayer = new AudioPlayer(queueManager);
    const queueData = queueManager.getQueue(interaction.guild.id);
    
    queueData.messageChannel = originalMessage.channel;
    queueData.addSong(songData);

    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === 'Idle') {
      await audioPlayer.playNextInQueue(interaction.guild.id, voiceChannel);
      await interaction.reply({ 
        content: `▶️ Odtwarzam: **${soundName}.mp3**`, 
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: `➕ Dodano do kolejki: **${soundName}.mp3** (pozycja: ${queueData.length})`, 
        ephemeral: true 
      });
    }
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getSoundInfo(soundName) {
    const soundPath = path.join(this.soundsFolder, `${soundName}.mp3`);
    
    if (!fs.existsSync(soundPath)) {
      return null;
    }

    try {
      const stats = fs.statSync(soundPath);
      return {
        name: soundName,
        path: soundPath,
        size: stats.size,
        modified: stats.mtime,
        exists: true
      };
    } catch (error) {
      console.error('Błąd pobierania informacji o pliku:', error);
      return null;
    }
  }

  // Metody do obsługi różnych folderów dźwięków
  getJoinSoundPath(userName) {
    const soundFolders = {
      [CONFIG.users.patryk]: 'patrykJoin',
      [CONFIG.users.lotus]: 'lotusJoin',
      [CONFIG.users.pardi]: 'pardiJoin',
      [CONFIG.users.kaktus]: 'kaktucatJoin',
      'Quit': 'Quit'
    };

    const folderName = soundFolders[userName] || 'randomJoin';
    const folderPath = path.join(CONFIG.soundsDir, folderName);

    if (!fs.existsSync(folderPath)) return null;

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return null;

    const randomFile = files[Math.floor(Math.random() * files.length)];
    return path.join(folderPath, randomFile);
  }

  getAvailableFolders() {
    try {
      return fs.readdirSync(CONFIG.soundsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch (error) {
      console.error('Błąd odczytywania folderów:', error);
      return [];
    }
  }

  getSoundsFromFolder(folderName) {
    const folderPath = path.join(CONFIG.soundsDir, folderName);
    
    if (!fs.existsSync(folderPath)) return [];
    
    try {
      return fs.readdirSync(folderPath)
        .filter(f => f.endsWith('.mp3'))
        .map(f => f.replace('.mp3', ''));
    } catch (error) {
      console.error(`Błąd odczytywania folderu ${folderName}:`, error);
      return [];
    }
  }

  // Utility metoda do statystyk
  getLibraryStats() {
    const stats = {
      totalSounds: 0,
      folders: {},
      totalSize: 0
    };

    try {
      const folders = this.getAvailableFolders();
      
      folders.forEach(folder => {
        const sounds = this.getSoundsFromFolder(folder);
        stats.folders[folder] = sounds.length;
        stats.totalSounds += sounds.length;

        // Dodaj rozmiar plików (opcjonalnie)
        sounds.forEach(sound => {
          try {
            const soundPath = path.join(CONFIG.soundsDir, folder, `${sound}.mp3`);
            const stat = fs.statSync(soundPath);
            stats.totalSize += stat.size;
          } catch (error) {
            // Ignoruj błędy dla poszczególnych plików
          }
        });
      });

      return stats;
    } catch (error) {
      console.error('Błąd pobierania statystyk biblioteki:', error);
      return stats;
    }
  }
}

module.exports = { SoundManager };