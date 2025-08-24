const { EmbedBuilder } = require('discord.js');
const { CONFIG } = require('../config/config');
const { loadJSON, saveJSON } = require('../utils/fileUtils');
const { SoundManager } = require('./soundManager');
const { CommandHandler } = require('./commandHandler');

class MessageHandler {
  constructor(client, voiceManager, statusManager) {
    this.client = client;
    this.voiceManager = voiceManager;
    this.statusManager = statusManager;
    this.soundManager = new SoundManager();
    this.commandHandler = new CommandHandler(voiceManager, statusManager, this.soundManager);
  }

  async handleMessage(message) {
    if (message.author.bot) return;
    
    const username = message.author.username;
    const content = message.content.toLowerCase();

    // Obsługa specjalnych odpowiedzi dla użytkowników
    if (await this.handleSpecialResponses(message, username, content)) {
      return;
    }

    // Obsługa komend muzycznych i innych
    if (content.startsWith('.') || content.startsWith('!') || content.startsWith('/')) {
      await this.commandHandler.handleCommand(message);
      return;
    }

    // Obsługa reakcji na słowa kluczowe
    await this.handleKeywordReactions(message, content);
  }

  async handleSpecialResponses(message, username, content) {
    // Odpowiedzi dla Patryka
    if (username === CONFIG.users.patryk) {
      const patrykMessages = [
        'wypierdalaj', 'patryk cwel', 'patryk jest lgbt',
        'mieszkam na osiedlu debowym', 'patryk jest murzynem'
      ];
      await message.reply(patrykMessages[Math.floor(Math.random() * patrykMessages.length)]);
      return true;
    }

    // Specjalne komendy z odpowiedziami
    const specialCommands = {
      'kto jest najlepszym botem muzycznym?': async () => {
        await message.reply('ja');
        const targetMember = message.guild.members.cache.get('411916947773587456');
        if (targetMember?.voice.channel) {
          try {
            await targetMember.voice.disconnect();
            console.log(`Wyrzucono użytkownika ${targetMember.user.username}`);
          } catch (error) {
            console.error('Błąd przy wyrzucaniu:', error);
          }
        }
      },
      'czy patryk jest cwelem?': () => message.reply('https://tenor.com/view/boxdel-tak-gif-26735455'),
      'dlaczego patryk to cwel?': () => message.reply('https://pl.wikipedia.org/wiki/Cwel'),
    };

    if (specialCommands[content]) {
      await specialCommands[content]();
      return true;
    }

    return false;
  }

  async handleKeywordReactions(message, content) {
    // Reakcje na słowa kluczowe
    const keywordReactions = {
      'faza': () => message.reply('❌ baza lepsza.'),
      'kto': () => message.reply('PYTAL🤣🤣😂😂😂'),
      'kto?': () => message.reply('PYTAL🤣🤣😂😂😂'),
    };

    // Sprawdź czy wiadomość zaczyna się od słowa kluczowego
    for (const [keyword, reaction] of Object.entries(keywordReactions)) {
      if (content.startsWith(keyword)) {
        await reaction();
        return;
      }
    }

    // Sprawdź czy wiadomość zawiera słowa kluczowe
    const containsKeywords = {
      'siema': () => message.reply('https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif'),
      'strzałeczka': () => message.reply('https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif'),
      'slava ukraina': () => this.handleSlavaUkraina(message),
    };

    for (const [keyword, reaction] of Object.entries(containsKeywords)) {
      if (content.includes(keyword)) {
        await reaction();
        return;
      }
    }

    // Specjalna obsługa dla "cwel"
    if (content.startsWith('cwel')) {
      if (message.author.username === CONFIG.users.pardi) {
        await message.reply('pardi krol');
      } else {
        const cwelMessages = ['sam jestes cwel', 'patryk cwel', 'jestem lgbt', 'niggers', 'pideras'];
        await message.reply(cwelMessages[Math.floor(Math.random() * cwelMessages.length)]);
      }
      return;
    }

    // Sprawdź czy to link do strzałeczki
    if (content === 'https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif') {
      await message.reply('https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif');
    }
  }

  async handleSlavaUkraina(message) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return;

    // Tylko gdy nie ma aktywnej muzyki
    const queueData = this.voiceManager.queueManager.getQueue(message.guild.id);
    if (queueData.currentPlayer?.state.status === 'Playing') return;

    await this.soundManager.playRandomFromFolder('slava', voiceChannel);
  }

  async sendAnnouncementMessage() {
    try {
      const channel = this.client.channels.cache.get(CONFIG.channels.announcement);
      if (!channel) {
        console.error('Nie znaleziono kanału ogłoszeń');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setDescription('JEBAC WAS KURWY');
      
      await channel.send({ embeds: [embed] });
      console.log('Wiadomość ogłoszenia została wysłana!');
    } catch (error) {
      console.error('Błąd podczas wysyłania wiadomości ogłoszenia:', error);
    }
  }
}

module.exports = { MessageHandler };