const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  getVoiceConnection 
} = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config/config');

class AudioPlayer {
  constructor(queueManager) {
    this.queueManager = queueManager;
  }

  async playNextInQueue(guildId, channel) {
    const queueData = this.queueManager.getQueue(guildId);
    
    if (queueData.length === 0) {
      queueData.reset(false);
      queueData.scheduleLeave();
      return;
    }

    queueData.clearLeaveTimeout();

    const nextSong = queueData.queue.shift();
    queueData.currentSong = nextSong;

    try {
      // Połącz z kanałem głosowym jeśli nie jest połączony
      if (!queueData.connection || queueData.connection.state.status === 'disconnected') {
        queueData.connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: guildId,
          adapterCreator: channel.guild.voiceAdapterCreator,
        });
      }
    } catch (error) {
      console.error('Błąd połączenia z kanałem głosowym:', error);
      queueData.reset();
      return;
    }

    // Utwórz nowy player
    const player = createAudioPlayer();
    let resource;

    // Stwórz resource z filtrami lub bez
    if (nextSong.filter || nextSong.speed !== 1.0) {
      resource = queueData.createFilteredResource(nextSong.path, nextSong.filter, nextSong.speed);
    } else {
      resource = createAudioResource(nextSong.path, { inlineVolume: true });
    }

    queueData.currentPlayer = player;
    queueData.connection.subscribe(player);
    player.play(resource);

    // Wyślij wiadomość o aktualnie granej muzyce
    await this.sendNowPlayingMessage(guildId, channel);

    // Przygotuj następny utwór dla crossfade
    await queueData.prepareNextTrack();

    // Event listenery dla connection
    queueData.connection.on('stateChange', (oldState, newState) => {
      if (newState.status === 'disconnected') {
        queueData.reset(false);
      }
    });

    // Event listenery dla playera
    queueData.setupPlayerEvents();
  }

  async sendNowPlayingMessage(guildId, channel) {
    const queueData = this.queueManager.getQueue(guildId);
    if (!queueData.currentSong) return;

    const crossfadeSettings = queueData.crossfadeManager.getSettingsEmbed();
    let filterText = '';
    
    if (queueData.currentSong.filter === 'speed') {
      filterText = ` (${queueData.currentSong.speed}x speed)`;
    } else if (queueData.currentSong.filter) {
      filterText = ` (${queueData.currentSong.filter})`;
    }

    const embed = new EmbedBuilder()
      .setColor(queueData.isCrossfading ? 0xFF6B35 : 0x0099FF) // Pomarańczowy dla crossfade
      .setTitle(queueData.isCrossfading ? '🎛️ Crossfade w toku' : '🎵 Teraz gra')
      .setDescription(`**${queueData.currentSong.name}${filterText}**`)
      .addFields(
        { name: '👤 Dodane przez', value: queueData.currentSong.requestedBy, inline: true },
        { name: '📝 W kolejce', value: queueData.length.toString(), inline: true },
        { name: '🔄 Loop', value: queueData.isLooping ? 'Włączony' : 'Wyłączony', inline: true }
      );

    // Dodaj informacje o crossfade
    if (crossfadeSettings.enabled) {
      const crossfadeInfo = [];
      crossfadeInfo.push(`${crossfadeSettings.duration}s ${crossfadeSettings.type}`);
      
      if (crossfadeSettings.djMode.enabled) {
        crossfadeInfo.push('DJ Mode');
      }
      
      if (queueData.crossfadeData) {
        crossfadeInfo.push(`Optymalne: ${queueData.crossfadeData.optimalCrossfadeTime}s`);
      }
      
      embed.addFields({
        name: '🎛️ Crossfade', 
        value: crossfadeInfo.join(' • '), 
        inline: true
      });
    }

    // Dodaj status crossfade jeśli aktywny
    if (queueData.isCrossfading) {
      embed.addFields({
        name: '🔄 Status',
        value: 'Płynne przejście między utworami...',
        inline: false
      });
    }

    embed.setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_skip')
          .setLabel('⏭️ Skip')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('music_stop')
          .setLabel('⏹️ Stop')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('music_pause')
          .setLabel('⏸️ Pause')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_crossfade')
          .setLabel('🎛️ Crossfade')
          .setStyle(ButtonStyle.Success)
      );

    try {
      // Usuń poprzednią wiadomość
      if (queueData.currentMessage) {
        await queueData.currentMessage.delete().catch(() => {});
      }

      const textChannel = queueData.messageChannel || 
        channel.guild.channels.cache.find(ch => 
          ch.type === 0 && 
          ch.permissionsFor(channel.guild.members.me).has(['SendMessages', 'ViewChannel'])
        );

      if (textChannel) {
        queueData.currentMessage = await textChannel.send({ embeds: [embed], components: [row] });
        
        const collector = queueData.currentMessage.createMessageComponentCollector({ time: 300000 });
        
        collector.on('collect', async (interaction) => {
          await this.handleMusicInteraction(interaction, queueData);
        });
        
        collector.on('end', () => {
          const disabledRow = new ActionRowBuilder()
            .addComponents(
              ...row.components.map(button => ButtonBuilder.from(button).setDisabled(true))
            );
          queueData.currentMessage?.edit({ components: [disabledRow] }).catch(() => {});
        });
      }
    } catch (error) {
      console.error('Błąd wysyłania wiadomości now playing:', error);
    }
  }

  async handleMusicInteraction(interaction, queueData) {
    switch (interaction.customId) {
      case 'music_skip':
        if (!queueData.currentPlayer) {
          return interaction.reply({ content: '❌ Nie ma aktualnie odtwarzanej muzyki.', ephemeral: true });
        }
        
        queueData.clearCrossfadeTimeout();
        queueData.currentPlayer.stop();
        await interaction.reply({ content: '⏭️ Pominięto utwór.', ephemeral: true });
        break;
        
      case 'music_stop':
        queueData.reset();
        await interaction.reply({ content: '⏹️ Zatrzymano muzykę i wyczyszczono kolejkę.', ephemeral: true });
        break;
        
      case 'music_pause':
        if (!queueData.currentPlayer) {
          return interaction.reply({ content: '❌ Nie ma aktualnie odtwarzanej muzyki.', ephemeral: true });
        }
        
        if (queueData.currentPlayer.state.status === AudioPlayerStatus.Playing) {
          queueData.currentPlayer.pause();
          await interaction.reply({ content: '⏸️ Wstrzymano odtwarzanie.', ephemeral: true });
        } else {
          queueData.currentPlayer.unpause();
          await interaction.reply({ content: '▶️ Wznowiono odtwarzanie.', ephemeral: true });
        }
        break;
        
      case 'music_crossfade':
        await this.handleCrossfadeInteraction(interaction, queueData);
        break;
    }
  }

  async handleCrossfadeInteraction(interaction, queueData) {
    const settings = queueData.crossfadeManager.getSettingsEmbed();
    
    const embed = new EmbedBuilder()
      .setColor(0x9932CC)
      .setTitle('🎛️ Crossfade - Szybkie ustawienia')
      .addFields(
        { name: '🔧 Status', value: settings.enabled ? '✅ Włączony' : '❌ Wyłączony', inline: true },
        { name: '⏱️ Czas', value: `${settings.duration}s`, inline: true },
        { name: '📈 Tryb', value: settings.djMode.enabled ? 'DJ Mode' : settings.type, inline: true }
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('cf_toggle')
          .setLabel(settings.enabled ? '🔇 Wyłącz' : '🔊 Włącz')
          .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cf_dj_mode')
          .setLabel(settings.djMode.enabled ? '🎚️ Normal' : '🎛️ DJ Mode')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('cf_shorter')
          .setLabel('⏪ Krócej')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(settings.duration <= 1),
        new ButtonBuilder()
          .setCustomId('cf_longer')
          .setLabel('⏩ Dłużej')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(settings.duration >= 15)
      );

    const response = await interaction.reply({ 
      embeds: [embed], 
      components: [row], 
      ephemeral: true 
    });

    const cfCollector = response.createMessageComponentCollector({ time: 60000 });
    
    cfCollector.on('collect', async (cfInteraction) => {
      if (cfInteraction.user.id !== interaction.user.id) {
        return cfInteraction.reply({ content: '❌ Tylko osoba która otworzyła panel może go używać.', ephemeral: true });
      }

      let updated = false;
      let message = '';

      switch (cfInteraction.customId) {
        case 'cf_toggle':
          queueData.crossfadeManager.updateSettings({ enabled: !settings.enabled });
          message = settings.enabled ? '🔇 Crossfade wyłączony' : '🔊 Crossfade włączony';
          updated = true;
          break;
          
        case 'cf_dj_mode':
          const djEnabled = queueData.crossfadeManager.toggleDJMode();
          message = djEnabled ? '🎛️ DJ Mode włączony - profesjonalne przejścia!' : '🎚️ Tryb normalny przywrócony';
          updated = true;
          break;
          
        case 'cf_shorter':
          if (queueData.crossfadeManager.setDuration(settings.duration - 1)) {
            message = `⏪ Czas crossfade: ${settings.duration - 1}s`;
            updated = true;
          }
          break;
          
        case 'cf_longer':
          if (queueData.crossfadeManager.setDuration(settings.duration + 1)) {
            message = `⏩ Czas crossfade: ${settings.duration + 1}s`;
            updated = true;
          }
          break;
      }

      if (updated) {
        const newSettings = queueData.crossfadeManager.getSettingsEmbed();
        const newEmbed = new EmbedBuilder()
          .setColor(0x9932CC)
          .setTitle('🎛️ Crossfade - Szybkie ustawienia')
          .addFields(
            { name: '🔧 Status', value: newSettings.enabled ? '✅ Włączony' : '❌ Wyłączony', inline: true },
            { name: '⏱️ Czas', value: `${newSettings.duration}s`, inline: true },
            { name: '📈 Tryb', value: newSettings.djMode.enabled ? 'DJ Mode' : newSettings.type, inline: true }
          );

        const newRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('cf_toggle')
              .setLabel(newSettings.enabled ? '🔇 Wyłącz' : '🔊 Włącz')
              .setStyle(newSettings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId('cf_dj_mode')
              .setLabel(newSettings.djMode.enabled ? '🎚️ Normal' : '🎛️ DJ Mode')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cf_shorter')
              .setLabel('⏪ Krócej')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newSettings.duration <= 1),
            new ButtonBuilder()
              .setCustomId('cf_longer')
              .setLabel('⏩ Dłużej')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newSettings.duration >= 15)
          );

        await cfInteraction.update({ embeds: [newEmbed], components: [newRow] });
      }

      if (message) {
        await interaction.followUp({ content: message, ephemeral: true });
      }
    });

    cfCollector.on('end', () => {
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          ...row.components.map(button => ButtonBuilder.from(button).setDisabled(true))
        );
      response.edit({ components: [disabledRow] }).catch(() => {});
    });
  }

  // Metoda do odtwarzania dźwięków join/leave
  playJoinSound(userName, channel, guild) {
    const queueData = this.queueManager.getQueue(guild.id);
    if (queueData.currentPlayer?.state.status === AudioPlayerStatus.Playing) return;

    const soundFolders = {
      [CONFIG.users.patryk]: 'patrykJoin',
      [CONFIG.users.lotus]: 'lotusJoin',
      [CONFIG.users.pardi]: 'pardiJoin',
      [CONFIG.users.kaktus]: 'kaktucatJoin',
      'Quit': 'Quit'
    };

    const folderName = soundFolders[userName] || 'randomJoin';
    const folderPath = path.join(CONFIG.soundsDir, folderName);

    if (!fs.existsSync(folderPath)) return;

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return;

    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(folderPath, randomFile);

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createAudioResource(filePath);
    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      const conn = getVoiceConnection(guild.id);
      if (conn && !queueData.currentPlayer) conn.destroy();
    });

    player.on('error', error => {
      console.error('Błąd audio:', error);
      const conn = getVoiceConnection(guild.id);
      if (conn && !queueData.currentPlayer) conn.destroy();
    });
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

  calculateQueueTime(queue) {
    return queue.length * CONFIG.avgSongLength;
  }
}

module.exports = { AudioPlayer };