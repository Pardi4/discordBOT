require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  StreamType
} = require('@discordjs/voice');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

// === KONFIGURACJA ===
const CONFIG = {
  dataFile: path.join(__dirname, 'data.json'),
  usersFile: path.join(__dirname, 'users.json'),
  tempDir: path.join(__dirname, 'temp'),
  soundsDir: path.join(__dirname, 'sounds'),
  users: {
    patryk: 'freerice900',
    lotus: '._lotus',
    kaktus: 'kaktucat',
    pardi: 'pardi1'
  },
  avgSongLength: 30000, // średnia długość utworu w ms (30s)
  validFilters: ['8d', 'echo', 'rate', 'pitch', 'bass', 'bassboost', 'speed']
};

// === ZMIENNE GLOBALNE ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL']
});

const musicQueues = new Map();
let lastJoinTimestamp = null;
let status = { name: 'muzykę 🎵', type: ActivityType.Playing };
let dynamicStatusInterval = null;

// === FUNKCJE POMOCNICZE ===
const createTempDir = () => {
  if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
  }
};

const loadJSON = (filePath, defaultValue = {}) => {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath));
  } catch (err) {
    console.error(`Błąd wczytywania ${filePath}:`, err);
    return defaultValue;
  }
};

const saveJSON = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Błąd zapisu ${filePath}:`, err);
  }
};

const loadData = () => loadJSON(CONFIG.dataFile);
const saveData = (data) => saveJSON(CONFIG.dataFile, data);
const loadUsers = () => loadJSON(CONFIG.usersFile);
const saveUsers = (users) => saveJSON(CONFIG.usersFile, users);

// === FUNKCJE STATUSU ===
const setOnlineStatus = () => {
  status = { name: `${CONFIG.users.patryk} jest na kanale`, type: ActivityType.Playing };
  clearInterval(dynamicStatusInterval);
  dynamicStatusInterval = null;
  client.user.setPresence({ status: 'online', activities: [status] });
  saveData({ lastJoinTimestamp, status });
};

const startDynamicOfflineStatus = () => {
  if (!lastJoinTimestamp) lastJoinTimestamp = Date.now();
  clearInterval(dynamicStatusInterval);

  const updateDynamicStatus = () => {
    const diff = Date.now() - lastJoinTimestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    
    client.user.setPresence({
      status: 'online',
      activities: [{ name: `Patryk offline: ${days}d ${hours}h ${minutes}m`, type: ActivityType.Playing }]
    });
  };

  updateDynamicStatus();
  dynamicStatusInterval = setInterval(updateDynamicStatus, 60 * 1000);
  status = { name: 'dynamic', type: 0 };
  saveData({ lastJoinTimestamp, status });
};

// === FUNKCJE KOLEJKI MUZYCZNEJ ===
const getQueue = (guildId) => {
  if (!musicQueues.has(guildId)) {
    musicQueues.set(guildId, {
      queue: [],
      currentPlayer: null,
      isLooping: false,
      connection: null,
      currentSong: null,
      currentMessage: null
    });
  }
  return musicQueues.get(guildId);
};

const resetQueue = (guildId) => {
  const queueData = getQueue(guildId);
  queueData.queue = [];
  queueData.currentSong = null;
  queueData.isLooping = false;
  
  if (queueData.currentPlayer) {
    queueData.currentPlayer.stop();
    queueData.currentPlayer = null;
  }
  
  if (queueData.connection) {
    queueData.connection.destroy();
    queueData.connection = null;
  }
  
  if (queueData.currentMessage) {
    queueData.currentMessage.delete().catch(() => {});
    queueData.currentMessage = null;
  }
  
  console.log(`Zresetowano kolejkę dla serwera ${guildId}`);
};

const formatTime = (ms) => {
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
};

const calculateQueueTime = (queue) => {
  return queue.length * CONFIG.avgSongLength;
};

// === FUNKCJE DŹWIĘKU ===
const levenshteinDistance = (str1, str2) => {
  const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str2.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

const findClosestSound = (searchName, soundsFolder) => {
  try {
    const files = fs.readdirSync(soundsFolder).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return null;
    
    return files.reduce((closest, file) => {
      const fileName = file.replace('.mp3', '').toLowerCase();
      const distance = levenshteinDistance(searchName.toLowerCase(), fileName);
      return distance < closest.distance ? { file: file.replace('.mp3', ''), distance } : closest;
    }, { file: files[0].replace('.mp3', ''), distance: Infinity }).file;
  } catch (err) {
    console.error('Błąd wyszukiwania plików:', err);
    return null;
  }
};

const downloadFile = (url, filename) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(CONFIG.tempDir, filename);
    const file = fs.createWriteStream(filePath);
    const httpModule = url.startsWith('https:') ? https : http;
    
    httpModule.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Błąd pobierania: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filePath);
      });
      file.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
};

const createFilteredResource = (file, filterName, speed = 1.5) => {
  const filterMap = {
    '8d': ['-af', 'apulsator=hz=0.125'],
    'echo': ['-af', 'aecho=0.8:0.9:1000:0.3'],
    'rate': ['-filter:a', `atempo=${speed}`],
    'pitch': ['-filter:a', 'asetrate=48000*1.2,aresample=48000'],
    'speed': ['-filter:a', `atempo=${speed}`],
    'bass': ['-af', 'equalizer=f=60:width_type=h:width=50:g=10,equalizer=f=170:width_type=h:width=50:g=10,volume=1.2'],
    'bassboost': ['-af', 'equalizer=f=60:width_type=h:width=50:g=15,equalizer=f=170:width_type=h:width=50:g=12,equalizer=f=310:width_type=h:width=50:g=8,volume=1.5']
  };

  let ffmpegArgs = ['-i', file, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
  
  if (filterName && filterMap[filterName]) {
    ffmpegArgs = ['-i', file, ...filterMap[filterName], '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
  }

  const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  return createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
};

const sendNowPlayingMessage = async (guildId, channel, messageChannel = null) => {
  const queueData = getQueue(guildId);
  if (!queueData.currentSong) return;

  let filterText = '';
  if (queueData.currentSong.filter === 'speed') {
    filterText = ` (${queueData.currentSong.speed}x speed)`;
  } else if (queueData.currentSong.filter) {
    filterText = ` (${queueData.currentSong.filter})`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('🎵 Teraz gra')
    .setDescription(`**${queueData.currentSong.name}${filterText}**`)
    .addFields(
      { name: '👤 Dodane przez', value: queueData.currentSong.requestedBy, inline: true },
      { name: '📝 W kolejce', value: queueData.queue.length.toString(), inline: true },
      { name: '🔄 Loop', value: queueData.isLooping ? 'Włączony' : 'Wyłączony', inline: true }
    )
    .setTimestamp();

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
        .setStyle(ButtonStyle.Secondary)
    );

  try {
    // Usuń poprzednią wiadomość jeśli istnieje
    if (queueData.currentMessage) {
      await queueData.currentMessage.delete().catch(() => {});
    }

    // Użyj kanału z którego wysłano komendę, lub znajdź pierwszy dostępny kanał tekstowy
    const textChannel = messageChannel || channel.guild.channels.cache.find(ch => ch.type === 0 && ch.permissionsFor(channel.guild.members.me).has(['SendMessages', 'ViewChannel']));
    if (textChannel) {
      queueData.currentMessage = await textChannel.send({ embeds: [embed], components: [row] });
      
      // Collector dla przycisków
      const collector = queueData.currentMessage.createMessageComponentCollector({ time: 300000 });
      
      collector.on('collect', async (interaction) => {
        const voiceChannel = interaction.member?.voice?.channel;
        
        switch (interaction.customId) {
          case 'music_skip':
            if (!queueData.currentPlayer) {
              return interaction.reply({ content: '❌ Nie ma aktualnie odtwarzanej muzyki.', ephemeral: true });
            }
            queueData.currentPlayer.stop();
            await interaction.reply({ content: '⏭️ Pominięto utwór.', ephemeral: true });
            break;
            
          case 'music_stop':
            resetQueue(guildId);
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
        }
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
};

const playNextInQueue = (guildId, channel, messageChannel = null) => {
  const queueData = getQueue(guildId);
  
  if (queueData.queue.length === 0) {
    queueData.currentSong = null;
    queueData.currentPlayer = null;
    if (queueData.connection) {
      queueData.connection.destroy();
      queueData.connection = null;
    }
    if (queueData.currentMessage) {
      queueData.currentMessage.delete().catch(() => {});
      queueData.currentMessage = null;
    }
    return;
  }

  const nextSong = queueData.queue.shift();
  queueData.currentSong = nextSong;

  try {
    if (!queueData.connection || queueData.connection.state.status === 'disconnected') {
      queueData.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
    }
  } catch (error) {
    console.error('Błąd połączenia z kanałem głosowym:', error);
    resetQueue(guildId);
    return;
  }

  const player = createAudioPlayer();
  const resource = createFilteredResource(nextSong.path, nextSong.filter, nextSong.speed);

  queueData.currentPlayer = player;
  queueData.connection.subscribe(player);
  player.play(resource);

  // Wyślij wiadomość o aktualnie granym utworze - przekaż messageChannel
  sendNowPlayingMessage(guildId, channel, messageChannel);

  queueData.connection.on('stateChange', (oldState, newState) => {
    if (newState.status === 'disconnected') {
      console.log('Bot został rozłączony z kanału głosowego - resetowanie kolejki');
      resetQueue(guildId);
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    if (queueData.currentSong?.isTemp) {
      cleanupTempFile(queueData.currentSong);
    }
    
    if (queueData.isLooping && queueData.currentSong) {
      queueData.queue.unshift(queueData.currentSong);
    }
    playNextInQueue(guildId, channel, messageChannel);
  });

  player.on('error', error => {
    console.error('Błąd audio:', error);
    playNextInQueue(guildId, channel, messageChannel);
  });
};

const cleanupTempFile = (songData) => {
  if (songData.isTemp && fs.existsSync(songData.path)) {
    setTimeout(() => {
      fs.unlink(songData.path, (err) => {
        if (err) console.error('Błąd usuwania pliku tymczasowego:', err);
        else console.log('Usunięto plik tymczasowy:', songData.path);
      });
    }, 5000);
  }
};

const playJoinSound = (userName, channel, guild) => {
  const users = loadUsers();
  if (users[userName]?.soundsDisabled) return;

  const queueData = getQueue(guild.id);
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
};

// === INICJALIZACJA ===
createTempDir();
const loadedData = loadData();
if (loadedData.lastJoinTimestamp) lastJoinTimestamp = loadedData.lastJoinTimestamp;
if (loadedData.status) status = loadedData.status;

client.once('ready', () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
  if (status.name === 'dynamic') startDynamicOfflineStatus();
  else client.user.setPresence({ status: 'online', activities: [status] });
});

// === OBSŁUGA WIADOMOŚCI ===
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const username = message.author.username;

  // Odpowiedzi dla Patryka
  if (username === CONFIG.users.patryk) {
    const patrykMsgTable = [
      'wypierdalaj', 'patryk cwel', 'patryk jest lgbt',
      'mieszkam na osiedlu debowym', 'patryk jest murzynem'
    ];
    return message.reply(patrykMsgTable[Math.floor(Math.random() * patrykMsgTable.length)]);
  }

  // Komendy specjalne
  const specialCommands = {
    'kto jest najlepszym botem muzycznym?': async () => {
      message.reply('ja');
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

  const cmd = message.content.toLowerCase();
  if (specialCommands[cmd]) return specialCommands[cmd]();

  // Reakcje na słowa kluczowe
  if (cmd.startsWith('faza')) return message.reply('❌ baza lepsza.');
  if (['kto', 'kto?'].includes(cmd)) return message.reply('PYTAL🤣🤣😂😂😂');
  if (cmd.includes('siema') || cmd.includes('strzałeczka')) {
    return message.reply('https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif');
  }
  if (cmd.includes('cwel')) {
    if (username === CONFIG.users.pardi) return message.reply('pardi krol');
    const cwelMsgTable = ['sam jestes cwel', 'patryk cwel', 'jestem lgbt', 'niggers', 'pideras'];
    return message.reply(cwelMsgTable[Math.floor(Math.random() * cwelMsgTable.length)]);
  }

  // Komenda wyłączania dźwięków
  if (cmd === '!jestem cwelem') {
    const users = loadUsers();
    if (!users[username]) users[username] = {};
    users[username].soundsDisabled = !users[username].soundsDisabled;
    saveUsers(users);
    return message.reply(users[username].soundsDisabled ? 
      '🔇 Dźwięki przy dołączaniu/odłączaniu zostały wyłączone.' : 
      '🔊 Dźwięki przy dołączaniu/odłączaniu zostały włączone.');
  }

  // === KOMENDY MUZYCZNE ===
  
  // Help - zaktualizowana lista komend
  if (['.help', '.radio'].includes(cmd)) {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('🎵 Komendy Muzyczne')
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
            '`.skip` - Pomiń aktualny utwór',
            '`.stop` - Zatrzymaj muzykę i wyczyść kolejkę',
            '`.pause` - Wstrzymaj odtwarzanie',
            '`.resume` - Wznów odtwarzanie'
          ].join('\n'),
          inline: false
        },
        {
          name: '🔄 Kolejka',
          value: [
            '`.queue` / `.q` - Pokaż kolejkę z czasem',
            '`.loop` - Włącz/wyłącz zapętlanie',
            '`.shuffle` - Wymieszaj kolejkę',
            '`.clear` - Wyczyść kolejkę',
            '`.randomplaylist` / `.rp` - Losowa playlista wszystkich dźwięków'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎛️ Informacje',
          value: [
            '`.np` - Aktualnie grający utwór',
            '`.sounds` / `.dzwieki` - Lista wszystkich dźwięków z przyciskami',
            '`.help` - Ta pomoc'
          ].join('\n'),
          inline: false
        },
        {
          name: '⚙️ Ustawienia',
          value: [
            '`!jestem cwelem` - Wyłącz/włącz dźwięki join/leave',
            '`.status <nazwa> <typ>` - Ustaw status bota',
            '`/czas` - Czas od ostatniego wejścia Patryka',
            '`.spam @user` - Spam użytkownika (tylko Pardi)'
          ].join('\n'),
          inline: false
        }
      )
      .setFooter({ text: 'Filtry: 8d, echo, rate, pitch, bass, bassboost | Speed: 0.1-5.0' })
      .setTimestamp();
    
    return message.reply({ embeds: [helpEmbed] });
  }

  // Queue - ulepszona komenda z czasem
  if (['.queue', '.q'].includes(cmd)) {
    const queueData = getQueue(message.guild.id);
    
    if (!queueData.currentSong && queueData.queue.length === 0) {
      return message.reply('📭 Kolejka jest pusta.');
    }

    const queueTime = calculateQueueTime(queueData.queue);
    
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('🎵 Kolejka Muzyczna')
      .setTimestamp();

    if (queueData.currentSong) {
      let filterText = '';
      if (queueData.currentSong.filter === 'speed') {
        filterText = ` (${queueData.currentSong.speed}x speed)`;
      } else if (queueData.currentSong.filter) {
        filterText = ` (${queueData.currentSong.filter})`;
      }
      
      embed.addFields({
        name: '🎵 Aktualnie gra',
        value: `**${queueData.currentSong.name}${filterText}**\n👤 Dodane przez: ${queueData.currentSong.requestedBy}`,
        inline: false
      });
    }

    if (queueData.queue.length > 0) {
      const queueList = queueData.queue.slice(0, 10).map((song, index) => {
        let filterText = '';
        if (song.filter === 'speed') {
          filterText = ` (${song.speed}x speed)`;
        } else if (song.filter) {
          filterText = ` (${song.filter})`;
        }
        return `${index + 1}. **${song.name}${filterText}**\n👤 ${song.requestedBy}`;
      }).join('\n\n');
      
      embed.addFields({
        name: `📜 W kolejce (${queueData.queue.length} utworów)`,
        value: queueList + (queueData.queue.length > 10 ? `\n\n... i ${queueData.queue.length - 10} więcej` : ''),
        inline: false
      });
    }

    const infoFields = [];
    if (queueData.queue.length > 0) {
      infoFields.push(`⏱️ **Czas kolejki:** ~${formatTime(queueTime)}`);
    }
    if (queueData.isLooping) {
      infoFields.push('🔄 **Zapętlanie włączone**');
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

  // Random playlist - ulepszona komenda
  if (['.randomplaylist', '.rp'].includes(cmd)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ Musisz być na kanale głosowym, aby uruchomić losową playlistę.');
    }

    const soundsFolder = path.join(CONFIG.soundsDir, 'sounds');
    if (!fs.existsSync(soundsFolder)) {
      return message.reply('❌ Folder z dźwiękami nie istnieje.');
    }

    try {
      const files = fs.readdirSync(soundsFolder)
        .filter(f => f.endsWith('.mp3'))
        .map(f => f.replace('.mp3', ''));

      if (files.length === 0) {
        return message.reply('❌ Brak plików dźwiękowych w folderze.');
      }

      // Wymieszaj pliki
      const shuffledFiles = [...files];
      for (let i = shuffledFiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledFiles[i], shuffledFiles[j]] = [shuffledFiles[j], shuffledFiles[i]];
      }

      const queueData = getQueue(message.guild.id);
      
      // Dodaj wszystkie pliki do kolejki
      shuffledFiles.forEach(soundName => {
        const soundPath = path.join(soundsFolder, `${soundName}.mp3`);
        const songData = {
          name: soundName,
          path: soundPath,
          filter: null,
          speed: 1.0,
          requestedBy: message.author.username,
          isTemp: false
        };
        queueData.queue.push(songData);
      });

      // Uruchom odtwarzanie jeśli nic aktualnie nie gra
      if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
        playNextInQueue(message.guild.id, voiceChannel, message.channel);
      }

      const totalTime = calculateQueueTime(queueData.queue);
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎲 Losowa Playlista Uruchomiona!')
        .addFields(
          { name: '📊 Utwory', value: files.length.toString(), inline: true },
          { name: '⏱️ Szacowany czas', value: `~${formatTime(totalTime)}`, inline: true },
          { name: '🔀 Status', value: 'Wymieszano losowo', inline: true }
        )
        .addFields({
          name: '🎵 Pierwszych 5 utworów',
          value: shuffledFiles.slice(0, 5).map((name, i) => `${i + 1}. ${name}`).join('\n'),
          inline: false
        })
        .setTimestamp();

      return message.reply({ embeds: [embed] });

    } catch (err) {
      console.error('Błąd tworzenia losowej playlisty:', err);
      return message.reply('❌ Błąd podczas tworzenia losowej playlisty.');
    }
  }

  // Komendy kontroli muzyki
  const musicCommands = {
    '.skip': () => {
      const queueData = getQueue(message.guild.id);
      if (!queueData.currentPlayer) {
        return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
      }
      queueData.currentPlayer.stop();
      return message.reply('⏭️ Pomijam aktualny utwór.');
    },
    
    '.stop': () => {
      resetQueue(message.guild.id);
      return message.reply('⏹️ Zatrzymano muzykę i wyczyszczono kolejkę.');
    },
    
    '.pause': () => {
      const queueData = getQueue(message.guild.id);
      if (!queueData.currentPlayer) {
        return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
      }
      queueData.currentPlayer.pause();
      return message.reply('⏸️ Wstrzymano odtwarzanie.');
    },
    
    '.resume': () => {
      const queueData = getQueue(message.guild.id);
      if (!queueData.currentPlayer) {
        return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
      }
      queueData.currentPlayer.unpause();
      return message.reply('▶️ Wznowiono odtwarzanie.');
    },
    
    '.loop': () => {
      const queueData = getQueue(message.guild.id);
      queueData.isLooping = !queueData.isLooping;
      return message.reply(`🔄 Zapętlanie ${queueData.isLooping ? 'włączone' : 'wyłączone'}.`);
    },
    
    '.clear': () => {
      const queueData = getQueue(message.guild.id);
      queueData.queue = [];
      return message.reply('🗑️ Wyczyszczono kolejkę.');
    },
    
    '.shuffle': () => {
      const queueData = getQueue(message.guild.id);
      if (queueData.queue.length < 2) {
        return message.reply('❌ W kolejce musi być co najmniej 2 utwory do wymieszania.');
      }
      
      for (let i = queueData.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queueData.queue[i], queueData.queue[j]] = [queueData.queue[j], queueData.queue[i]];
      }
      
      return message.reply('🔀 Wymieszano kolejkę.');
    },
    
    '.np': () => {
      const queueData = getQueue(message.guild.id);
      if (!queueData.currentSong) {
        return message.reply('❌ Aktualnie nic nie gra.');
      }
      
      let filterText = '';
      if (queueData.currentSong.filter === 'speed') {
        filterText = ` (${queueData.currentSong.speed}x speed)`;
      } else if (queueData.currentSong.filter) {
        filterText = ` (filtr: ${queueData.currentSong.filter})`;
      }
      
      return message.reply(`🎵 **Aktualnie gra:** ${queueData.currentSong.name}${filterText}`);
    }
  };

  if (musicCommands[cmd]) {
    return musicCommands[cmd]();
  }

  // Komenda .sounds z przyciskami - ulepszona
  if (['.sounds', '.dzwieki'].includes(cmd)) {
    const soundsFolder = path.join(CONFIG.soundsDir, 'sounds');
    
    if (!fs.existsSync(soundsFolder)) {
      return message.reply('❌ Folder z dźwiękami nie istnieje.');
    }

    try {
      const files = fs.readdirSync(soundsFolder)
        .filter(f => f.endsWith('.mp3'))
        .map(f => f.replace('.mp3', ''))
        .sort();

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

        return new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('🎵 Dostępne Dźwięki')
          .setDescription(`Lista wszystkich dostępnych dźwięków (${files.length} łącznie)`)
          .addFields({
            name: `📜 Strona ${page + 1}/${totalPages}`,
            value: pageSounds.map((sound, index) => 
              `\`${start + index + 1}.\` ${sound}`
            ).join('\n'),
            inline: false
          })
          .setFooter({ 
            text: 'Użyj przycisków aby nawigować lub odtworzyć dźwięk • Kliknij "🎲 Losowy" dla przypadkowego dźwięku' 
          })
          .setTimestamp();
      };

      const generateButtons = (page, sounds) => {
        const rows = [];
        
        // Pierwszy rząd - nawigacja
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
          
          const randomSound = files[Math.floor(Math.random() * files.length)];
          const soundPath = path.join(soundsFolder, `${randomSound}.mp3`);
          
          const queueData = getQueue(interaction.guild.id);
          const songData = {
            name: randomSound,
            path: soundPath,
            filter: null,
            speed: 1.0,
            requestedBy: interaction.user.username,
            isTemp: false
          };

          queueData.queue.push(songData);

          if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
            playNextInQueue(interaction.guild.id, voiceChannel, message.channel);
            await interaction.reply({ 
              content: `🎲 Losowy dźwięk: **${randomSound}.mp3**`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `🎲 Dodano losowy dźwięk do kolejki: **${randomSound}.mp3** (pozycja: ${queueData.queue.length})`, 
              ephemeral: true 
            });
          }
        } else if (interaction.customId.startsWith('play_')) {
          if (!voiceChannel) {
            return interaction.reply({ 
              content: '❌ Musisz być na kanale głosowym, aby puścić dźwięk.', 
              ephemeral: true 
            });
          }
          
          const soundName = interaction.customId.replace('play_', '');
          const soundPath = path.join(soundsFolder, `${soundName}.mp3`);
          
          if (!fs.existsSync(soundPath)) {
            return interaction.reply({ 
              content: `❌ Nie znaleziono pliku: ${soundName}.mp3`, 
              ephemeral: true 
            });
          }

          const queueData = getQueue(interaction.guild.id);
          const songData = {
            name: soundName,
            path: soundPath,
            filter: null,
            speed: 1.0,
            requestedBy: interaction.user.username,
            isTemp: false
          };

          queueData.queue.push(songData);

          if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
            playNextInQueue(interaction.guild.id, voiceChannel);
            await interaction.reply({ 
              content: `▶️ Odtwarzam: **${soundName}.mp3**`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `➕ Dodano do kolejki: **${soundName}.mp3** (pozycja: ${queueData.queue.length})`, 
              ephemeral: true 
            });
          }
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
    } catch (err) {
      console.error('Błąd odczytywania foldera:', err);
      return message.reply('❌ Błąd podczas odczytywania listy dźwięków.');
    }
  }

  // Spam command
  if (cmd.startsWith('.spam')) {
    if (username !== CONFIG.users.pardi) {
      return message.reply("wypierdalaj");
    }

    message.delete().catch(() => {});
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Oznacz użytkownika, którego chcesz spamować.');
    for (let i = 0; i < 5; i++) message.channel.send(`<@${user.id}>`);
    return;
  }

  // Czas command
  if (message.content === '/czas') {
    if (!lastJoinTimestamp) return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');

    const diff = Date.now() - lastJoinTimestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    return message.reply(`freerice900 nie był na kanale od: ${days}d ${hours}h ${minutes}min`);
  }

  // Status command
  if (cmd.startsWith('.status')) {
    const parts = message.content.split(' ');
    if (parts.length === 2 && parts[1] === '0') {
      if (!lastJoinTimestamp) return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');
      clearInterval(dynamicStatusInterval);
      startDynamicOfflineStatus();
      return message.reply('✅ Dynamiczny status z czasem od ostatniego wejścia Patryka został ustawiony.');
    }

    if (parts.length < 3) return message.reply('Użycie: .status <nazwa> <typ>\nPrzykład: .status Gra 0\nLub: .status 0 dla dynamicznego czasu');

    const name = parts.slice(1, -1).join(' ');
    const type = parseInt(parts[parts.length - 1]);
    if (isNaN(type) || type < 0 || type > 5) return message.reply('Typ aktywności musi być liczbą od 0 do 5.');

    clearInterval(dynamicStatusInterval);
    dynamicStatusInterval = null;

    status = { name, type };
    client.user.setPresence({ status: 'online', activities: [status] });
    saveData({ lastJoinTimestamp, status });
    return message.reply(`✅ Status ustawiony: ${name} (typ ${type})`);
  }

  // Komenda .graj z kolejką i obsługą załączników
  if (message.content.startsWith('.graj') || (message.content === '.graj' && message.attachments.size > 0)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ Musisz być na kanale głosowym, aby puścić dźwięk.');

    // Obsługa załączników
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      
      // Sprawdź czy to plik audio
      const audioFormats = ['.mp3', '.wav', '.ogg', '.m4a'];
      if (!audioFormats.some(format => attachment.name.toLowerCase().endsWith(format))) {
        return message.reply('❌ Obsługiwane formaty: mp3, wav, ogg, m4a');
      }

      // Parsuj argumenty z komendy dla załączników
      const args = message.content.split(' ').slice(1);
      const { filter, speed } = parseFilterArgs(args);

      if (filter === 'error') {
        return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
      }

      try {
        const filename = `${Date.now()}-${attachment.name}`;
        const filePath = await downloadFile(attachment.url, filename);
        
        const queueData = getQueue(message.guild.id);
        const songData = {
          name: attachment.name,
          path: filePath,
          filter: filter,
          speed: speed,
          requestedBy: message.author.username,
          isTemp: true
        };

        queueData.queue.push(songData);

        const filterText = getFilterText(filter, speed);
        
        if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
          playNextInQueue(message.guild.id, voiceChannel);
          return message.reply(`▶️ Odtwarzam: ${attachment.name}${filterText}`);
        } else {
          return message.reply(`➕ Dodano do kolejki: ${attachment.name}${filterText} (pozycja: ${queueData.queue.length})`);
        }
      } catch (error) {
        console.error('Błąd pobierania pliku:', error);
        return message.reply('❌ Nie udało się pobrać pliku.');
      }
    }

    const args = message.content.split(' ').slice(1);
    if (args.length === 0) return message.reply('❌ Podaj nazwę pliku do odtworzenia lub wyślij plik jako załącznik.');

    const { filter, speed, soundParts } = parseFilterArgs(args, true);
    if (filter === 'error') {
      return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
    }

    const soundName = soundParts.join(' ');
    const soundsFolder = path.join(CONFIG.soundsDir, 'sounds');
    let soundPath = path.join(soundsFolder, `${soundName}.mp3`);
    let actualSoundName = soundName;

    // Jeśli nie znaleziono dokładnego dopasowania, znajdź najbliższy
    if (!fs.existsSync(soundPath)) {
      const closestSound = findClosestSound(soundName, soundsFolder);
      if (closestSound) {
        soundPath = path.join(soundsFolder, `${closestSound}.mp3`);
        actualSoundName = closestSound;
      } else {
        return message.reply(`❌ Nie znaleziono pliku: ${soundName}.mp3\nUżyj komendy \`.sounds\` aby zobaczyć dostępne dźwięki.`);
      }
    }

    const queueData = getQueue(message.guild.id);
    const songData = {
      name: actualSoundName,
      path: soundPath,
      filter: filter,
      speed: speed,
      requestedBy: message.author.username,
      isTemp: false
    };

    queueData.queue.push(songData);

    const filterText = getFilterText(filter, speed);
    let responseText;
    
    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
      playNextInQueue(message.guild.id, voiceChannel);
      responseText = `▶️ Odtwarzam: ${actualSoundName}.mp3${filterText}`;
    } else {
      responseText = `➕ Dodano do kolejki: ${actualSoundName}.mp3${filterText} (pozycja: ${queueData.queue.length})`;
    }
    
    if (actualSoundName !== soundName) {
      responseText += `\n💡 Nie znaleziono "${soundName}", użyto najbliższego: "${actualSoundName}"`;
    }
    
    return message.reply(responseText);
  }

  // Slava Ukraina - tylko gdy nie ma aktywnej muzyki
  if (cmd.includes('slava ukraina')) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ Musisz być na kanale głosowym, aby puścić dźwięk.');

    const queueData = getQueue(message.guild.id);
    if (queueData.currentPlayer?.state.status === AudioPlayerStatus.Playing) return;

    const folderPath = path.join(CONFIG.soundsDir, 'slava');
    if (!fs.existsSync(folderPath)) return;
    
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return;
    
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const soundPath = path.join(folderPath, randomFile);

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createAudioResource(soundPath);
    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      const conn = getVoiceConnection(voiceChannel.guild.id);
      if (conn) conn.destroy();
    });

    return;
  }
});

// === FUNKCJE POMOCNICZE ===
const parseFilterArgs = (args, returnSoundParts = false) => {
  let filter = null;
  let speed = 1.0;
  let soundParts = args;

  // Sprawdź czy ostatni argument to speed z wartością
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
    // Sprawdź czy ostatni argument to zwykły filtr
    const possibleFilter = args[args.length - 1].toLowerCase();
    if (CONFIG.validFilters.includes(possibleFilter)) {
      filter = possibleFilter;
      soundParts = args.slice(0, -1);
      if (filter === 'rate') speed = 1.5; // domyślna prędkość dla rate
    }
  }

  return returnSoundParts ? { filter, speed, soundParts } : { filter, speed };
};

const getFilterText = (filter, speed) => {
  if (filter === 'speed') {
    return ` z prędkością: ${speed}x`;
  } else if (filter) {
    return ` z filtrem: ${filter}`;
  }
  return '';
};

// === OBSŁUGA KANAŁÓW GŁOSOWYCH ===
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const userName = member.user.username;

  // Wejście lub przełączenie kanału
  if ((!oldState.channel && newState.channel) || (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id)) {
    if (userName === CONFIG.users.patryk) setOnlineStatus();
    playJoinSound(userName, newState.channel, newState.guild);
  }

  // Wyjście z kanału lub wyrzucenie
  if (oldState.channel && !newState.channel) {
    const users = loadUsers();
    if (!users[userName]?.soundsDisabled) {
      playJoinSound('Quit', oldState.channel, oldState.guild);
    }
    
    if (userName === CONFIG.users.patryk) {
      lastJoinTimestamp = Date.now();
      saveData({ lastJoinTimestamp, status });
      startDynamicOfflineStatus();
      console.log(`${userName} opuścił kanał. Timestamp: ${new Date(lastJoinTimestamp).toLocaleString()}`);
    }
    
    // Resetuj kolejkę jeśli bot zostanie rozłączony
    if (member.user.id === client.user.id) {
      console.log('Bot został rozłączony z kanału głosowego - resetowanie kolejki');
      resetQueue(oldState.guild.id);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);