const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { CONFIG } = require('../config/config');
const { loadJSON, saveJSON, downloadFile } = require('../utils/fileUtils');
const path = require('path');
const fs = require('fs');

class CommandHandler {
  constructor(voiceManager, statusManager, soundManager) {
    this.voiceManager = voiceManager;
    this.statusManager = statusManager;
    this.soundManager = soundManager;
  }

  async handleCommand(message) {
    const content = message.content;
    const cmd = content.toLowerCase();
    const args = content.split(' ').slice(1);

    // === KOMENDY CROSSFADE ===
    if (cmd.startsWith('.crossfade')) {
      return await this.handleCrossfadeCommand(message, args);
    }

    // === KOMENDY MUZYCZNE ===
    if (cmd === '.help' || cmd === '.radio') {
      return await this.sendHelpMessage(message);
    }

    if (cmd === '.queue' || cmd === '.q') {
      return await this.showQueue(message);
    }

    if (cmd === '.randomplaylist' || cmd === '.rp') {
      return await this.playRandomPlaylist(message);
    }

    if (cmd === '.sounds' || cmd === '.dzwieki') {
      return await this.showSoundsWithButtons(message);
    }

    if (content.startsWith('.graj') || (cmd === '.graj' && message.attachments.size > 0)) {
      return await this.handlePlayCommand(message);
    }

    // Kontrola muzyki
    const musicCommands = {
      '.skip': () => this.skipTrack(message),
      '.s': () => this.skipTrack(message),
      '.stop': () => this.stopMusic(message),
      '.pause': () => this.pauseMusic(message),
      '.resume': () => this.resumeMusic(message),
      '.loop': () => this.toggleLoop(message),
      '.clear': () => this.clearQueue(message),
      '.shuffle': () => this.shuffleQueue(message),
      '.np': () => this.nowPlaying(message),
    };

    if (musicCommands[cmd]) {
      return await musicCommands[cmd]();
    }

    // === INNE KOMENDY ===
    if (cmd === '!jestem cwelem') {
      return await this.toggleUserSounds(message);
    }

    if (cmd.startsWith('.spam')) {
      return await this.handleSpamCommand(message);
    }

    if (content === '/czas') {
      return await this.showPatrykTime(message);
    }

    if (cmd.startsWith('.status')) {
      return await this.handleStatusCommand(message, args);
    }
  }

  async handleCrossfadeCommand(message, args) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    const crossfadeManager = queueData.crossfadeManager;

    if (args.length === 0) {
      return await this.showCrossfadeSettings(message, crossfadeManager);
    }

    const subCommand = args[0].toLowerCase();
    const value = args[1];

    switch (subCommand) {
      case 'on':
      case 'off':
        crossfadeManager.updateSettings({ enabled: subCommand === 'on' });
        return message.reply(`🎛️ Crossfade ${subCommand === 'on' ? 'włączony' : 'wyłączony'}.`);

      case 'duration':
        const duration = parseInt(value);
        if (crossfadeManager.setDuration(duration)) {
          return message.reply(`⏱️ Czas crossfade ustawiony na ${duration} sekund.`);
        } else {
          return message.reply('❌ Czas przejścia musi być między 1 a 15 sekundami.');
        }

      case 'type':
        if (crossfadeManager.setType(value?.toLowerCase())) {
          return message.reply(`📈 Typ krzywej crossfade ustawiony na: ${value}`);
        } else {
          return message.reply('❌ Dostępne typy: dj, linear, exponential, logarithmic');
        }

      case 'dj':
        const djEnabled = crossfadeManager.toggleDJMode();
        return message.reply(`🎛️ DJ Mode ${djEnabled ? 'włączony - profesjonalne przejścia!' : 'wyłączony'}`);

      case 'minlength':
        const minLength = parseInt(value);
        if (minLength >= 5 && minLength <= 60) {
          crossfadeManager.updateSettings({ minTrackLength: minLength });
          return message.reply(`📏 Minimalna długość utworu ustawiona na ${minLength} sekund.`);
        } else {
          return message.reply('❌ Minimalna długość musi być między 5 a 60 sekundami.');
        }

      default:
        return message.reply('❌ Nieznana opcja. Użyj `.crossfade` aby zobaczyć dostępne komendy.');
    }
  }

  async showCrossfadeSettings(message, crossfadeManager) {
    const settings = crossfadeManager.getSettingsEmbed();

    const embed = new EmbedBuilder()
      .setColor(0x9932CC)
      .setTitle('🎛️ Ustawienia Crossfade')
      .addFields(
        { name: '🔧 Status', value: settings.enabled ? '✅ Włączony' : '❌ Wyłączony', inline: true },
        { name: '⏱️ Czas przejścia', value: `${settings.duration} sekund`, inline: true },
        { name: '📈 Typ krzywej', value: settings.djMode.enabled ? 'DJ Mode' : settings.type, inline: true },
        { name: '📏 Min. długość utworu', value: `${settings.minTrackLength} sekund`, inline: true },
        { name: '🎚️ Auto Gain', value: settings.autoGain ? '✅' : '❌', inline: true },
        { name: '🎛️ EQ Crossfade', value: settings.eqCrossfade ? '✅' : '❌', inline: true }
      );

    if (settings.djMode.enabled) {
      embed.addFields({
        name: '🎧 DJ Mode Features',
        value: [
          `🔊 Low Cut: ${settings.djMode.lowCut ? '✅' : '❌'}`,
          `📢 High Boost: ${settings.djMode.highBoost ? '✅' : '❌'}`,
          `🎵 Stereo Spread: ${settings.djMode.stereoSpread ? '✅' : '❌'}`
        ].join('\n'),
        inline: false
      });
    }

    embed.addFields({
      name: '⚙️ Dostępne komendy',
      value: [
        '`.crossfade on/off` - włącz/wyłącz',
        '`.crossfade duration <1-15>` - ustaw czas (sekundy)',
        '`.crossfade type <dj/linear/exponential/logarithmic>` - typ krzywej',
        '`.crossfade dj` - przełącz DJ Mode',
        '`.crossfade minlength <5-60>` - min. długość utworu'
      ].join('\n'),
      inline: false
    })
    .setFooter({ text: 'DJ Mode oferuje profesjonalne przejścia z EQ i dynamicznym miksowaniem' })
    .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async sendHelpMessage(message) {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('🎵 Komendy Muzyczne - Wersja 2.0')
      .addFields(
        {
          name: '▶️ Odtwarzanie',
          value: [
            '`.graj <nazwa>` - Dodaj plik do kolejki',
            '`.graj <nazwa> [filtr]` - Z filtrem (8d, echo, rate, pitch, bass, bassboost)',
            '`.graj <nazwa> speed <0.1-5.0>` - Z prędkością',
            '`.graj` + załącznik - Odtwórz wysłany plik'
          ].join('\n'),
          inline: false
        },
        {
          name: '⏯️ Kontrola',
          value: [
            '`.skip/.s` - Pomiń aktualny utwór',
            '`.stop` - Zatrzymaj muzykę i wyczyść kolejkę',
            '`.pause` - Wstrzymaj odtwarzanie',
            '`.resume` - Wznów odtwarzanie'
          ].join('\n'),
          inline: false
        },
        {
          name: '🔄 Kolejka',
          value: [
            '`.queue/.q` - Pokaż kolejkę z czasem i crossfade info',
            '`.loop` - Włącz/wyłącz zapętlanie',
            '`.shuffle` - Wymieszaj kolejkę',
            '`.clear` - Wyczyść kolejkę',
            '`.randomplaylist/.rp` - Losowa playlista wszystkich dźwięków'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎛️ Crossfade 2.0 - DJ Edition',
          value: [
            '`.crossfade` - Pokaż zaawansowane ustawienia',
            '`.crossfade on/off` - Włącz/wyłącz płynne przejścia',
            '`.crossfade dj` - Przełącz DJ Mode (profesjonalne miksowanie)',
            '`.crossfade duration <1-15>` - Czas przejścia (sekundy)',
            '`.crossfade type <dj/linear/exp/log>` - Typ krzywej przejścia'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎚️ Informacje',
          value: [
            '`.np` - Aktualnie grający utwór',
            '`.sounds/.dzwieki` - Lista wszystkich dźwięków z przyciskami',
            '`.help` - Ta pomoc'
          ].join('\n'),
          inline: false
        }
      )
      .addFields({
        name: '🆕 Nowe funkcje 2.0',
        value: [
          '• **DJ Mode Crossfade** - Profesjonalne przejścia z EQ, stereo spread i auto gain',
          '• **Inteligentne przejścia** - Automatyczna analiza i optymalizacja czasu crossfade',
          '• **Real-time kontrola** - Panel crossfade z przyciskami w wiadomości now playing',
          '• **Zaawansowane filtry audio** - Low cut, high boost, stereo enhancement',
          '• **Przygotowanie na YouTube** - Modularna struktura gotowa na rozszerzenia'
        ].join('\n'),
        inline: false
      })
      .setFooter({ 
        text: 'DJ Mode: Basy fade out, wysokie fade in, stereo spread • Crossfade: 1-15s • Auto-gain normalization' 
      })
      .setTimestamp();
    
    return message.reply({ embeds: [helpEmbed] });
  }

  async showQueue(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    
    if (!queueData.currentSong && queueData.length === 0) {
      return message.reply('📭 Kolejka jest pusta.');
    }

    const queueTime = queueData.length * CONFIG.avgSongLength;
    const settings = queueData.crossfadeManager.getSettingsEmbed();
    
    const embed = new EmbedBuilder()
      .setColor(queueData.isCrossfading ? 0xFF6B35 : 0x0099FF)
      .setTitle('🎵 Kolejka Muzyczna')
      .setTimestamp();

    if (queueData.currentSong) {
      let filterText = this.getFilterText(queueData.currentSong);
      let statusText = queueData.isCrossfading ? ' 🎛️ (crossfade aktywny)' : '';
      
      embed.addFields({
        name: queueData.isCrossfading ? '🎛️ Aktualnie w crossfade' : '🎵 Aktualnie gra',
        value: `**${queueData.currentSong.name}${filterText}**${statusText}\n👤 Dodane przez: ${queueData.currentSong.requestedBy}`,
        inline: false
      });
    }

    if (queueData.length > 0) {
      const queueList = queueData.getQueue().slice(0, 8).map((song, index) => {
        let filterText = this.getFilterText(song);
        return `${index + 1}. **${song.name}${filterText}**\n👤 ${song.requestedBy}`;
      }).join('\n\n');
      
      embed.addFields({
        name: `📜 W kolejce (${queueData.length} utworów)`,
        value: queueList + (queueData.length > 8 ? `\n\n... i ${queueData.length - 8} więcej` : ''),
        inline: false
      });
    }

    const infoFields = [];
    if (queueData.length > 0) {
      infoFields.push(`⏱️ **Czas kolejki:** ~${this.formatTime(queueTime)}`);
    }
    if (queueData.isLooping) {
      infoFields.push('🔄 **Zapętlanie włączone**');
    }
    if (settings.enabled) {
      const crossfadeInfo = `🎛️ **Crossfade:** ${settings.duration}s ${settings.djMode.enabled ? 'DJ Mode' : settings.type}`;
      infoFields.push(crossfadeInfo);
    }
    
    if (infoFields.length > 0) {
      embed.addFields({
        name: 'ℹ️ Informacje',
        value: infoFields.join('\n'),
        inline: false
      });
    }

    return message.reply({ embeds: [embed] });
  }

  async playRandomPlaylist(message) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ Musisz być na kanale głosowym, aby uruchomić losową playlistę.');
    }

    try {
      const files = await this.soundManager.getAllSounds();
      if (files.length === 0) {
        return message.reply('❌ Brak plików dźwiękowych w folderze.');
      }

      // Wymieszaj pliki
      const shuffledFiles = [...files];
      for (let i = shuffledFiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledFiles[i], shuffledFiles[j]] = [shuffledFiles[j], shuffledFiles[i]];
      }

      const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
      queueData.messageChannel = message.channel;
      
      // Dodaj wszystkie pliki do kolejki
      shuffledFiles.forEach(soundName => {
        const songData = this.soundManager.createSongData(soundName, message.author.username);
        queueData.addSong(songData);
      });

      // Uruchom odtwarzanie
      if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
        await this.voiceManager.audioPlayer.playNextInQueue(message.guild.id, voiceChannel);
      }

      const totalTime = queueData.length * CONFIG.avgSongLength;
      const settings = queueData.crossfadeManager.getSettingsEmbed();
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎲 Losowa Playlista 2.0 Uruchomiona!')
        .addFields(
          { name: '📊 Utwory', value: files.length.toString(), inline: true },
          { name: '⏱️ Szacowany czas', value: `~${this.formatTime(totalTime)}`, inline: true },
          { name: '🔀 Status', value: 'Wymieszano losowo', inline: true }
        )
        .addFields({
          name: '🎵 Pierwszych 5 utworów',
          value: shuffledFiles.slice(0, 5).map((name, i) => `${i + 1}. ${name}`).join('\n'),
          inline: false
        });

      if (settings.enabled) {
        embed.addFields({
          name: '🎛️ Crossfade',
          value: `${settings.djMode.enabled ? 'DJ Mode' : 'Standard'} - ${settings.duration}s płynne przejścia`,
          inline: false
        });
      }

      embed.setTimestamp();
      return message.reply({ embeds: [embed] });

    } catch (err) {
      console.error('Błąd tworzenia losowej playlisty:', err);
      return message.reply('❌ Błąd podczas tworzenia losowej playlisty.');
    }
  }

  async handlePlayCommand(message) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ Musisz być na kanale głosowym, aby puścić dźwięk.');
    }

    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    queueData.messageChannel = message.channel;

    // Obsługa załączników
    if (message.attachments.size > 0) {
      return await this.handleAttachmentPlay(message, voiceChannel, queueData);
    }

    // Obsługa zwykłych plików
    const args = message.content.split(' ').slice(1);
    if (args.length === 0) {
      return message.reply('❌ Podaj nazwę pliku do odtworzenia lub wyślij plik jako załącznik.');
    }

    return await this.handleLocalFilePlay(message, args, voiceChannel, queueData);
  }

  async handleAttachmentPlay(message, voiceChannel, queueData) {
    const attachment = message.attachments.first();
    const audioFormats = ['.mp3', '.wav', '.ogg', '.m4a'];
    
    if (!audioFormats.some(format => attachment.name.toLowerCase().endsWith(format))) {
      return message.reply('❌ Obsługiwane formaty: mp3, wav, ogg, m4a');
    }

    const args = message.content.split(' ').slice(1);
    const { filter, speed } = this.parseFilterArgs(args);

    if (filter === 'error') {
      return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
    }

    try {
      const filename = `${Date.now()}-${attachment.name}`;
      const filePath = await downloadFile(attachment.url, filename);
      
      const songData = {
        name: attachment.name,
        path: filePath,
        filter: filter,
        speed: speed,
        requestedBy: message.author.username,
        isTemp: true
      };

      queueData.addSong(songData);
      const filterText = this.getFilterText(songData);
      
      if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
        await this.voiceManager.audioPlayer.playNextInQueue(message.guild.id, voiceChannel);
        return message.reply(`▶️ Odtwarzam: ${attachment.name}${filterText}`);
      } else {
        return message.reply(`➕ Dodano do kolejki: ${attachment.name}${filterText} (pozycja: ${queueData.length})`);
      }
    } catch (error) {
      console.error('Błąd pobierania pliku:', error);
      return message.reply('❌ Nie udało się pobrać pliku.');
    }
  }

  async handleLocalFilePlay(message, args, voiceChannel, queueData) {
    const { filter, speed, soundParts } = this.parseFilterArgs(args, true);
    if (filter === 'error') {
      return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
    }

    const soundName = soundParts.join(' ');
    const songData = this.soundManager.findAndCreateSongData(soundName, message.author.username, filter, speed);

    if (!songData) {
      return message.reply(`❌ Nie znaleziono pliku: ${soundName}.mp3\nUżyj komendy \`.sounds\` aby zobaczyć dostępne dźwięki.`);
    }

    queueData.addSong(songData);
    const filterText = this.getFilterText(songData);
    
    let responseText;
    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
      await this.voiceManager.audioPlayer.playNextInQueue(message.guild.id, voiceChannel);
      responseText = `▶️ Odtwarzam: ${songData.name}.mp3${filterText}`;
    } else {
      responseText = `➕ Dodano do kolejki: ${songData.name}.mp3${filterText} (pozycja: ${queueData.length})`;
    }
    
    if (songData.name !== soundName) {
      responseText += `\n💡 Nie znaleziono "${soundName}", użyto najbliższego: "${songData.name}"`;
    }
    
    return message.reply(responseText);
  }

  // Pozostałe metody kontroli muzyki
  async skipTrack(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    
    queueData.clearCrossfadeTimeout();
    queueData.currentPlayer.stop();
    return message.reply('⏭️ Pomijam aktualny utwór.');
  }

  async stopMusic(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    queueData.reset();
    return message.reply('⏹️ Zatrzymano muzykę i wyczyszczono kolejkę.');
  }

  async pauseMusic(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    queueData.currentPlayer.pause();
    return message.reply('⏸️ Wstrzymano odtwarzanie.');
  }

  async resumeMusic(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    queueData.currentPlayer.unpause();
    return message.reply('▶️ Wznowiono odtwarzanie.');
  }

  async toggleLoop(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    queueData.isLooping = !queueData.isLooping;
    return message.reply(`🔄 Zapętlanie ${queueData.isLooping ? 'włączone' : 'wyłączone'}.`);
  }

  async clearQueue(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    queueData.clear();
    return message.reply('🗑️ Wyczyszczono kolejkę.');
  }

  async shuffleQueue(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (queueData.length < 2) {
      return message.reply('❌ W kolejce musi być co najmniej 2 utwory do wymieszania.');
    }
    queueData.shuffle();
    return message.reply('🔀 Wymieszano kolejkę.');
  }

  async nowPlaying(message) {
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (!queueData.currentSong) {
      return message.reply('❌ Aktualnie nic nie gra.');
    }
    
    const filterText = this.getFilterText(queueData.currentSong);
    let crossfadeText = queueData.isCrossfading ? ' 🎛️ (crossfade w toku)' : '';
    
    return message.reply(`🎵 **Aktualnie gra:** ${queueData.currentSong.name}${filterText}${crossfadeText}`);
  }

  // Utility methods
  parseFilterArgs(args, returnSoundParts = false) {
    let filter = null;
    let speed = 1.0;
    let soundParts = args;

    // Sprawdź speed z wartością
    if (args.length >= 2 && args[args.length - 2].toLowerCase() === 'speed') {
      const speedValue = parseFloat(args[args.length - 1]);
      if (speedValue >= 0.1 && speedValue <= 5.0) {
        filter = 'speed';
        speed = speedValue;
        soundParts = args.slice(0, -2);
      } else {
        return { filter: 'error' };
      }
    } else if (args.length > 0) {
      const possibleFilter = args[args.length - 1].toLowerCase();
      if (CONFIG.validFilters.includes(possibleFilter)) {
        filter = possibleFilter;
        soundParts = args.slice(0, -1);
        if (filter === 'rate') speed = 1.5;
      }
    }

    return returnSoundParts ? { filter, speed, soundParts } : { filter, speed };
  }

  getFilterText(song) {
    if (song.filter === 'speed') {
      return ` (${song.speed}x speed)`;
    } else if (song.filter) {
      return ` (${song.filter})`;
    }
    return '';
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

  // Pozostałe komendy będą dodane w następnej części...
  async toggleUserSounds(message) {
    const username = message.author.username;
    const users = loadJSON(CONFIG.usersFile);
    
    if (!users[username]) users[username] = {};
    users[username].soundsDisabled = !users[username].soundsDisabled;
    saveJSON(CONFIG.usersFile, users);
    
    return message.reply(users[username].soundsDisabled ? 
      '🔇 Dźwięki przy dołączaniu/odłączaniu zostały wyłączone.' : 
      '🔊 Dźwięki przy dołączaniu/odłączaniu zostały włączone.');
  }

  async handleSpamCommand(message) {
    const username = message.author.username;
    if (username !== CONFIG.users.pardi) {
      return message.reply("wypierdalaj");
    }

    message.delete().catch(() => {});
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Oznacz użytkownika, którego chcesz spamować.');
    
    for (let i = 0; i < 5; i++) {
      message.channel.send(`<@${user.id}>`);
    }
  }

  async showPatrykTime(message) {
    const timestamp = this.statusManager.getLastJoinTimestamp();
    if (!timestamp) {
      return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');
    }

    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    
    return message.reply(`freerice900 nie był na kanale od: ${days}d ${hours}h ${minutes}min`);
  }

  async handleStatusCommand(message, args) {
    if (args.length === 1 && args[0] === '0') {
      const timestamp = this.statusManager.getLastJoinTimestamp();
      if (!timestamp) {
        return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');
      }
      
      this.statusManager.startDynamicOfflineStatus();
      return message.reply('✅ Dynamiczny status z czasem od ostatniego wejścia Patryka został ustawiony.');
    }

    if (args.length < 2) {
      return message.reply('Użycie: .status <nazwa> <typ>\nPrzykład: .status Gra 0\nLub: .status 0 dla dynamicznego czasu');
    }

    const name = args.slice(0, -1).join(' ');
    const type = parseInt(args[args.length - 1]);
    
    if (isNaN(type) || type < 0 || type > 5) {
      return message.reply('Typ aktywności musi być liczbą od 0 do 5.');
    }

    this.statusManager.setCustomStatus(name, type);
    return message.reply(`✅ Status ustawiony: ${name} (typ ${type})`);
  }

  async showSoundsWithButtons(message) {
    // Ta metoda będzie zaimplementowana w SoundManager
    return await this.soundManager.showSoundsWithButtons(message);
  }
}

module.exports = { CommandHandler };