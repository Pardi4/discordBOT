require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// === ŚCIEŻKA DO PLIKU Z DANYMI ===
const dataFile = path.join(__dirname, 'data.json');
const usersFile = path.join(__dirname, 'users.json');
const tempDir = path.join(__dirname, 'temp');

// === KOLEJKA MUZYKI ===
const musicQueues = new Map(); // guildId -> { queue: [], currentPlayer: null, isLooping: false, connection: null }

// Utwórz folder temp jeśli nie istnieje
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// === Funkcje pomocnicze do zapisu/odczytu ===
function loadData() {
  try {
    if (!fs.existsSync(dataFile)) return {};
    const raw = fs.readFileSync(dataFile);
    return JSON.parse(raw);
  } catch (err) {
    console.error('Błąd wczytywania danych:', err);
    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Błąd zapisu danych:', err);
  }
}

function loadUsers() {
  try {
    if (!fs.existsSync(usersFile)) return {};
    const raw = fs.readFileSync(usersFile);
    return JSON.parse(raw);
  } catch (err) {
    console.error('Błąd wczytywania użytkowników:', err);
    return {};
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Błąd zapisu użytkowników:', err);
  }
}

// === Funkcja podobieństwa stringów (Levenshtein distance) ===
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
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
}

function findClosestSound(searchName, soundsFolder) {
  try {
    const files = fs.readdirSync(soundsFolder).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return null;
    
    let closestFile = files[0];
    let minDistance = levenshteinDistance(searchName.toLowerCase(), files[0].replace('.mp3', '').toLowerCase());
    
    for (const file of files) {
      const fileName = file.replace('.mp3', '').toLowerCase();
      const distance = levenshteinDistance(searchName.toLowerCase(), fileName);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestFile = file;
      }
    }
    
    return closestFile.replace('.mp3', '');
  } catch (err) {
    console.error('Błąd wyszukiwania plików:', err);
    return null;
  }
}

// === Funkcja do pobierania plików ===
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(tempDir, filename);
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
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// === GLOBALNE ZMIENNE ===
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

const patrykNick = 'freerice900';
const lotusNick = '._lotus';
const kaktusNick = 'kaktucat';
const pardiNick = 'pardi1';

let lastJoinTimestamp = null;
let status = {
  name: 'muzykę 🎵',
  type: ActivityType.Playing,
};
let dynamicStatusInterval = null;

// === FUNKCJE STATUSU ===
const setOnlineStatus = () => {
  status = { name: `${patrykNick} jest na kanale`, type: ActivityType.Playing };

  if (dynamicStatusInterval) {
    clearInterval(dynamicStatusInterval);
    dynamicStatusInterval = null;
  }

  client.user.setPresence({
    status: 'online',
    activities: [status]
  });

  saveData({ lastJoinTimestamp, status });
};

const startDynamicOfflineStatus = () => {
  if (!lastJoinTimestamp) lastJoinTimestamp = Date.now();

  if (dynamicStatusInterval) clearInterval(dynamicStatusInterval);

  const updateDynamicStatus = () => {
    const now = Date.now();
    const diff = now - lastJoinTimestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);

    const dynamicText = `Patryk offline: ${days}d ${hours}h ${minutes}m`;

    client.user.setPresence({
      status: 'online',
      activities: [{ name: dynamicText, type: ActivityType.Playing }]
    });
  };

  updateDynamicStatus();
  dynamicStatusInterval = setInterval(updateDynamicStatus, 60 * 1000);

  status = { name: 'dynamic', type: 0 };
  saveData({ lastJoinTimestamp, status });
};

// === FUNKCJE KOLEJKI MUZYCZNEJ ===
function getQueue(guildId) {
  if (!musicQueues.has(guildId)) {
    musicQueues.set(guildId, {
      queue: [],
      currentPlayer: null,
      isLooping: false,
      connection: null,
      currentSong: null
    });
  }
  return musicQueues.get(guildId);
}

function resetQueue(guildId) {
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
  
  console.log(`Zresetowano kolejkę dla serwera ${guildId}`);
}

function createFilteredResource(file, filterName, speed = 1.5) {
  let ffmpegArgs = ['-i', file, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];

  if (filterName) {
    switch (filterName) {
      case '8d':
        ffmpegArgs = ['-i', file, '-af', 'apulsator=hz=0.125', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'echo':
        ffmpegArgs = ['-i', file, '-af', 'aecho=0.8:0.9:1000:0.3', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'rate':
        ffmpegArgs = ['-i', file, '-filter:a', `atempo=${speed}`, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'pitch':
        ffmpegArgs = ['-i', file, '-filter:a', 'asetrate=48000*1.2,aresample=48000', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'speed':
        ffmpegArgs = ['-i', file, '-filter:a', `atempo=${speed}`, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'bass':
        ffmpegArgs = ['-i', file, '-af', 'equalizer=f=60:width_type=h:width=50:g=10,equalizer=f=170:width_type=h:width=50:g=10,volume=1.2', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'bassboost':
        ffmpegArgs = ['-i', file, '-af', 'equalizer=f=60:width_type=h:width=50:g=15,equalizer=f=170:width_type=h:width=50:g=12,equalizer=f=310:width_type=h:width=50:g=8,volume=1.5', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
    }
  }

  const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  return createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
}

function playNextInQueue(guildId, channel) {
  const queueData = getQueue(guildId);
  
  if (queueData.queue.length === 0) {
    queueData.currentSong = null;
    queueData.currentPlayer = null;
    if (queueData.connection) {
      queueData.connection.destroy();
      queueData.connection = null;
    }
    return;
  }

  const nextSong = queueData.queue.shift();
  queueData.currentSong = nextSong;

  // Sprawdź czy kanał głosowy nadal istnieje i bot ma do niego dostęp
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
    // Wyczyść kolejkę jeśli nie można połączyć się z kanałem
    resetQueue(guildId);
    return;
  }

  const player = createAudioPlayer();
  const resource = createFilteredResource(nextSong.path, nextSong.filter, nextSong.speed);

  queueData.currentPlayer = player;
  queueData.connection.subscribe(player);
  player.play(resource);

  // Obsługa rozłączenia
  queueData.connection.on('stateChange', (oldState, newState) => {
    if (newState.status === 'disconnected') {
      console.log('Bot został rozłączony z kanału głosowego - resetowanie kolejki');
      resetQueue(guildId);
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    if (queueData.isLooping && queueData.currentSong) {
      // Dodaj ponownie na początek kolejki jeśli loop jest włączony
      queueData.queue.unshift(queueData.currentSong);
    }
    playNextInQueue(guildId, channel);
  });

  player.on('error', error => {
    console.error('Błąd audio:', error);
    playNextInQueue(guildId, channel);
  });
}

// === FUNKCJE DŹWIĘKU ===
function playJoinSound(userName, channel, guild) {
  // Sprawdź czy użytkownik ma wyłączone dźwięki
  const users = loadUsers();
  if (users[userName] && users[userName].soundsDisabled) {
    return; // Nie odtwarzaj dźwięków dla tego użytkownika
  }

  // Sprawdź czy nie ma aktywnej kolejki muzycznej
  const queueData = getQueue(guild.id);
  if (queueData.currentPlayer && queueData.currentPlayer.state.status === AudioPlayerStatus.Playing) {
    return; // Nie przerywaj muzyki
  }

  let folderPath;

  if (userName === patrykNick) folderPath = path.join(__dirname, 'sounds', 'patrykJoin');
  else if (userName === lotusNick) folderPath = path.join(__dirname, 'sounds', 'lotusJoin');
  else if (userName === pardiNick) folderPath = path.join(__dirname, 'sounds', 'pardiJoin');
  else if (userName === kaktusNick) folderPath = path.join(__dirname, 'sounds', 'kaktucatJoin');
  else if (userName === 'Quit') folderPath = path.join(__dirname, 'sounds', 'Quit');
  else folderPath = path.join(__dirname, 'sounds', 'randomJoin');

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

// Funkcja przy opuszczeniu kanału przez freerice900
function handleUserLeaveChannel(userName) {
  if (userName === patrykNick) {
    lastJoinTimestamp = Date.now();
    saveData({ lastJoinTimestamp, status });
    startDynamicOfflineStatus();
    console.log(`${userName} opuścił kanał. Timestamp: ${new Date(lastJoinTimestamp).toLocaleString()}`);
  }
}

// === Wczytaj dane przy starcie ===
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

  if (username === patrykNick) {
    const patrykMsgTable = [
      'wypierdalaj',
      'patryk cwel',
      'patryk jest lgbt',
      'mieszkam na osiedlu debowym',
      'patryk jest murzynem' 
    ];
    message.reply(patrykMsgTable[Math.floor(Math.random() * patrykMsgTable.length)]);
    return;
  }

  if (message.content.toLowerCase() === 'kto jest najlepszym botem muzycznym?') {
    message.reply('ja');
    
    // Znajdź użytkownika o ID 411916947773587456
    const targetUserId = '411916947773587456';
    const targetMember = message.guild.members.cache.get(targetUserId);
    
    if (targetMember && targetMember.voice.channel) {
      try {
        await targetMember.voice.disconnect();
        console.log(`Wyrzucono użytkownika ${targetMember.user.username} z kanału głosowego`);
      } catch (error) {
        console.error('Błąd przy wyrzucaniu użytkownika:', error);
      }
    }
    return;
  }

  if (message.content.toLowerCase().startsWith('faza')) {
    return message.reply('❌ baza lepsza.');
  }

  // Komenda do wyłączania dźwięków
  if (message.content.toLowerCase() === '!jestem cwelem') {
    const users = loadUsers();
    if (!users[username]) users[username] = {};
    
    users[username].soundsDisabled = !users[username].soundsDisabled;
    saveUsers(users);
    
    if (users[username].soundsDisabled) {
      return message.reply('🔇 Dźwięki przy dołączaniu/odłączaniu zostały wyłączone.');
    } else {
      return message.reply('🔊 Dźwięki przy dołączaniu/odłączaniu zostały włączone.');
    }
  }

  // Komenda do wyświetlania wszystkich dźwięków z przyciskami
  if (message.content.toLowerCase() === '.sounds' || message.content.toLowerCase() === '.dzwieki') {
    const soundsFolder = path.join(__dirname, 'sounds', 'sounds');
    
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

        const embed = {
          color: 0x0099FF,
          title: '🎵 Dostępne Dźwięki',
          description: `Lista wszystkich dostępnych dźwięków (${files.length} łącznie)`,
          fields: [
            {
              name: `📜 Strona ${page + 1}/${totalPages}`,
              value: pageSounds.map((sound, index) => 
                `\`${start + index + 1}.\` ${sound}`
              ).join('\n'),
              inline: false
            }
          ],
          footer: { 
            text: 'Użyj przycisków aby nawigować lub odtworzyć dźwięk • Kliknij "🎲 Losowy" dla przypadkowego dźwięku' 
          }
        };

        return embed;
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
            playNextInQueue(interaction.guild.id, voiceChannel);
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
        // Usuń przyciski po zakończeniu collectora
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

  // === KOMENDY MUZYCZNE ===
  
  // Pomoc dla komend muzycznych
  if (message.content === '.help' || message.content === '.radio') {
    const helpEmbed = {
      color: 0x0099FF,
      title: '🎵 Komendy Muzyczne',
      fields: [
        {
          name: '▶️ Odtwarzanie',
          value: '`.graj <nazwa>` - Dodaj plik do kolejki\n`.graj <nazwa> [filtr]` - Z filtrem (8d, echo, rate, pitch)\n`.graj <nazwa> speed <0.1-5.0>` - Z prędkością\n`.graj` + załącznik - Odtwórz wysłany plik',
          inline: false
        },
        {
          name: '⏯️ Kontrola',
          value: '`.skip` - Pomiń aktualny utwór\n`.stop` - Zatrzymaj muzykę i wyczyść kolejkę\n`.pause` - Wstrzymaj odtwarzanie\n`.resume` - Wznów odtwarzanie',
          inline: false
        },
        {
          name: '🔄 Kolejka',
          value: '`.queue` - Pokaż kolejkę\n`.loop` - Włącz/wyłącz zapętlanie\n`.shuffle` - Wymieszaj kolejkę\n`.clear` - Wyczyść kolejkę',
          inline: false
        },
        {
          name: '🎛️ Inne',
          value: '`.np` - Aktualnie grający utwór\n`.sounds` - Lista wszystkich dźwięków\n`!jestem cwelem` - Wyłącz/włącz dźwięki join/leave',
          inline: false
        }
      ],
      footer: { text: 'Filtry: 8d, echo, rate, pitch | Speed: 0.1-5.0' }
    };
    return message.reply({ embeds: [helpEmbed] });
  }

  // Skip - pomiń utwór
  if (message.content === '.skip') {
    const queueData = getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    
    queueData.currentPlayer.stop();
    return message.reply('⏭️ Pomijam aktualny utwór.');
  }

  // Stop - zatrzymaj wszystko
  if (message.content === '.stop') {
    resetQueue(message.guild.id);
    return message.reply('⏹️ Zatrzymano muzykę i wyczyszczono kolejkę.');
  }

  // Pause - wstrzymaj
  if (message.content === '.pause') {
    const queueData = getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    
    queueData.currentPlayer.pause();
    return message.reply('⏸️ Wstrzymano odtwarzanie.');
  }

  // Resume - wznów
  if (message.content === '.resume') {
    const queueData = getQueue(message.guild.id);
    if (!queueData.currentPlayer) {
      return message.reply('❌ Nie ma aktualnie odtwarzanej muzyki.');
    }
    
    queueData.currentPlayer.unpause();
    return message.reply('▶️ Wznowiono odtwarzanie.');
  }

  // Loop - zapętl
  if (message.content === '.loop') {
    const queueData = getQueue(message.guild.id);
    queueData.isLooping = !queueData.isLooping;
    return message.reply(`🔄 Zapętlanie ${queueData.isLooping ? 'włączone' : 'wyłączone'}.`);
  }

  // Queue - pokaż kolejkę
  if (message.content === '.queue' || message.content === '.q') {
    const queueData = getQueue(message.guild.id);
    
    if (!queueData.currentSong && queueData.queue.length === 0) {
      return message.reply('📭 Kolejka jest pusta.');
    }

    let queueText = '';
    
    if (queueData.currentSong) {
      let filterText = '';
      if (queueData.currentSong.filter === 'speed') {
        filterText = ` (${queueData.currentSong.speed}x speed)`;
      } else if (queueData.currentSong.filter) {
        filterText = ` (${queueData.currentSong.filter})`;
      }
      queueText += `🎵 **Aktualnie gra:** ${queueData.currentSong.name}${filterText}\n\n`;
    }

    if (queueData.queue.length > 0) {
      queueText += '📜 **Kolejka:**\n';
      queueData.queue.slice(0, 10).forEach((song, index) => {
        let filterText = '';
        if (song.filter === 'speed') {
          filterText = ` (${song.speed}x speed)`;
        } else if (song.filter) {
          filterText = ` (${song.filter})`;
        }
        queueText += `${index + 1}. ${song.name}${filterText}\n`;
      });
      
      if (queueData.queue.length > 10) {
        queueText += `... i ${queueData.queue.length - 10} więcej`;
      }
    }

    if (queueData.isLooping) {
      queueText += '\n🔄 **Zapętlanie włączone**';
    }

    return message.reply(queueText || '📭 Kolejka jest pusta.');
  }

  // Clear - wyczyść kolejkę
  if (message.content === '.clear') {
    const queueData = getQueue(message.guild.id);
    queueData.queue = [];
    return message.reply('🗑️ Wyczyszczono kolejkę.');
  }

  // Shuffle - wymieszaj kolejkę
  if (message.content === '.shuffle') {
    const queueData = getQueue(message.guild.id);
    if (queueData.queue.length < 2) {
      return message.reply('❌ W kolejce musi być co najmniej 2 utwory do wymieszania.');
    }
    
    for (let i = queueData.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queueData.queue[i], queueData.queue[j]] = [queueData.queue[j], queueData.queue[i]];
    }
    
    return message.reply('🔀 Wymieszano kolejkę.');
  }

  // Now playing
  if (message.content === '.np') {
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

  // Spam command
  if (message.content.toLowerCase().startsWith('.spam')) {
    if (username !== pardiNick) {
      message.reply("wypierdalaj");
      return;
    }

    message.delete().catch(() => { });
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Oznacz użytkownika, którego chcesz spamować.');
    for (let i = 0; i < 5; i++) message.channel.send(`<@${user.id}>`);
    return;
  }

  if (message.content.toLowerCase() === 'czy patryk jest cwelem?') {
    message.reply('https://tenor.com/view/boxdel-tak-gif-26735455');
    return;
  }

  if (['kto', 'kto?'].includes(message.content.toLowerCase())) {
    message.reply('PYTAŁ🤣🤣😂😂😂');
    return;
  }

  if (message.content.toLowerCase() === 'dlaczego patryk to cwel?') {
    message.reply('https://pl.wikipedia.org/wiki/Cwel');
    return;
  }

  if (message.content.toLowerCase().includes('siema') || message.content.toLowerCase().includes('strzałeczka')) {
    message.reply('https://media.discordapp.net/attachments/1071549071833182290/1201192468310392933/strzaeczka.gif');
    return;
  }

  if (message.content.toLowerCase().includes('cwel')) {
    if (username === pardiNick) return message.reply('pardi krol');

    const cwelMsgTable = ['sam jestes cwel', 'patryk cwel', 'jestem lgbt', 'niggers', 'pideras'];
    message.reply(cwelMsgTable[Math.floor(Math.random() * cwelMsgTable.length)]);
    return;
  }

  if (message.content === '/czas') {
    if (!lastJoinTimestamp) return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');

    const diff = Date.now() - lastJoinTimestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    return message.reply(`freerice900 nie był na kanale od: ${days}d ${hours}h ${minutes}min`);
  }

  if (message.content.toLowerCase().startsWith('.status')) {
    const parts = message.content.split(' ');
    if (parts.length === 2 && parts[1] === '0') {
      if (!lastJoinTimestamp) return message.reply('freerice900 jeszcze nie był na kanale od restartu bota.');
      if (dynamicStatusInterval) clearInterval(dynamicStatusInterval);
      startDynamicOfflineStatus();
      return message.reply('✅ Dynamiczny status z czasem od ostatniego wejścia Patryka został ustawiony.');
    }

    if (parts.length < 3) return message.reply('Użycie: /status <nazwa> <typ>\nPrzykład: /status Gra 0\nLub: /status 0 dla dynamicznego czasu');

    const name = parts.slice(1, -1).join(' ');
    const type = parseInt(parts[parts.length - 1]);
    if (isNaN(type) || type < 0 || type > 5) return message.reply('Typ aktywności musi być liczbą od 0 do 5.');

    if (dynamicStatusInterval) {
      clearInterval(dynamicStatusInterval);
      dynamicStatusInterval = null;
    }

    status = { name, type };
    client.user.setPresence({ status: 'online', activities: [status] });
    saveData({ lastJoinTimestamp, status });
    return message.reply(`✅ Status ustawiony: ${name} (typ ${type})`);
  }

  // Komenda .graj z kolejką i obsługą załączników
  if (message.content.startsWith('.graj') || (message.content === '.graj' && message.attachments.size > 0)) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Musisz być na kanale głosowym, aby puścić dźwięk.');

    // Obsługa załączników
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      
      // Sprawdź czy to plik audio
      if (!attachment.name.toLowerCase().endsWith('.mp3') && 
          !attachment.name.toLowerCase().endsWith('.wav') && 
          !attachment.name.toLowerCase().endsWith('.ogg') &&
          !attachment.name.toLowerCase().endsWith('.m4a')) {
        return message.reply('❌ Obsługiwane formaty: mp3, wav, ogg, m4a');
      }

      // Parsuj argumenty z komendy dla załączników
      const args = message.content.split(' ').slice(1);
      let filter = null;
      let speed = 1.0;

      // Sprawdź czy ostatni argument to speed z wartością
      if (args.length >= 2 && args[args.length - 2].toLowerCase() === 'speed') {
        const speedValue = parseFloat(args[args.length - 1]);
        if (speedValue >= 0.1 && speedValue <= 5.0) {
          filter = 'speed';
          speed = speedValue;
        } else {
          return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
        }
      } else if (args.length > 0) {
        // Sprawdź czy ostatni argument to zwykły filtr
        const possibleFilter = args[args.length - 1].toLowerCase();
        const validFilters = ['8d', 'echo', 'rate', 'pitch', 'bass', 'bassboost'];
        if (validFilters.includes(possibleFilter)) {
          filter = possibleFilter;
          if (filter === 'rate') speed = 1.5; // domyślna prędkość dla rate
        }
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

        if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
          playNextInQueue(message.guild.id, voiceChannel);
          
          let filterText = '';
          if (filter === 'speed') {
            filterText = ` z prędkością: ${speed}x`;
          } else if (filter) {
            filterText = ` z filtrem: ${filter}`;
          }
          
          return message.reply(`▶️ Odtwarzam: ${attachment.name}${filterText}`);
        } else {
          let filterText = '';
          if (filter === 'speed') {
            filterText = ` z prędkością: ${speed}x`;
          } else if (filter) {
            filterText = ` z filtrem: ${filter}`;
          }
          
          return message.reply(`➕ Dodano do kolejki: ${attachment.name}${filterText} (pozycja: ${queueData.queue.length})`);
        }
      } catch (error) {
        console.error('Błąd pobierania pliku:', error);
        return message.reply('❌ Nie udało się pobrać pliku.');
      }
    }

    const args = message.content.split(' ').slice(1);
    if (args.length === 0) return message.reply('Podaj nazwę pliku do odtworzenia lub wyślij plik jako załącznik.');

    let filter = null;
    let speed = 1.5; // domyślna prędkość
    let soundParts = args;

    // Sprawdź czy ostatni argument to speed z wartością
    if (args.length >= 2 && args[args.length - 2].toLowerCase() === 'speed') {
      const speedValue = parseFloat(args[args.length - 1]);
      if (speedValue >= 0.1 && speedValue <= 5.0) {
        filter = 'speed';
        speed = speedValue;
        soundParts = args.slice(0, -2); // usuń "speed" i wartość
      } else {
        return message.reply('❌ Prędkość musi być między 0.1 a 5.0');
      }
    } else {
      // Sprawdź czy ostatni argument to zwykły filtr
      const possibleFilter = args[args.length - 1].toLowerCase();
      const validFilters = ['8d', 'echo', 'rate', 'pitch'];
      if (validFilters.includes(possibleFilter)) {
        filter = possibleFilter;
        soundParts = args.slice(0, -1);
      }
    }

    const soundName = soundParts.join(' ');
    const soundsFolder = path.join(__dirname, 'sounds', 'sounds');
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

    if (!queueData.currentPlayer || queueData.currentPlayer.state.status === AudioPlayerStatus.Idle) {
      playNextInQueue(message.guild.id, voiceChannel);
      let filterText = '';
      if (filter === 'speed') {
        filterText = ` z prędkością: ${speed}x`;
      } else if (filter) {
        filterText = ` z filtrem: ${filter}`;
      }
      
      let responseText = `▶️ Odtwarzam: ${actualSoundName}.mp3${filterText}`;
      if (actualSoundName !== soundName) {
        responseText += `\n💡 Nie znaleziono "${soundName}", odtwarzam najbliższy: "${actualSoundName}"`;
      }
      
      return message.reply(responseText);
    } else {
      let filterText = '';
      if (filter === 'speed') {
        filterText = ` z prędkością: ${speed}x`;
      } else if (filter) {
        filterText = ` z filtrem: ${filter}`;
      }
      
      let responseText = `➕ Dodano do kolejki: ${actualSoundName}.mp3${filterText} (pozycja: ${queueData.queue.length})`;
      if (actualSoundName !== soundName) {
        responseText += `\n💡 Nie znaleziono "${soundName}", dodano najbliższy: "${actualSoundName}"`;
      }
      
      return message.reply(responseText);
    }
  }

  // slava ukraina - tylko gdy nie ma aktywnej muzyki
  if (message.content.toLowerCase().includes('slava ukraina')) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Musisz być na kanale głosowym, aby puścić dźwięk.');

    // Sprawdź czy nie ma aktywnej kolejki muzycznej
    const queueData = getQueue(message.guild.id);
    if (queueData.currentPlayer && queueData.currentPlayer.state.status === AudioPlayerStatus.Playing) {
      return; // Nie przerywaj muzyki
    }

    const folderPath = path.join(__dirname, 'sounds', 'slava');
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));
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

// === OBSŁUGA KANAŁÓW GŁOSOWYCH ===
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const userName = member.user.username;

  // Wejście lub przełączenie kanału
  if ((!oldState.channel && newState.channel) || (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id)) {
    if (userName === patrykNick) setOnlineStatus();
    playJoinSound(userName, newState.channel, newState.guild);
  }

  // Wyjście z kanału lub wyrzucenie
  if (oldState.channel && !newState.channel) {
    // Sprawdź czy użytkownik ma wyłączone dźwięki przed odtworzeniem dźwięku Quit
    const users = loadUsers();
    if (!users[userName] || !users[userName].soundsDisabled) {
      playJoinSound('Quit', oldState.channel, oldState.guild);
    }
    handleUserLeaveChannel(userName);
    
    // Resetuj kolejkę jeśli bot zostanie rozłączony
    if (member.user.id === client.user.id) {
      console.log('Bot został rozłączony z kanału głosowego - resetowanie kolejki');
      resetQueue(oldState.guild.id);
    }
  }
});

// Funkcja czyszczenia plików tymczasowych przy zakończeniu utworu
function cleanupTempFile(songData) {
  if (songData.isTemp && fs.existsSync(songData.path)) {
    setTimeout(() => {
      fs.unlink(songData.path, (err) => {
        if (err) console.error('Błąd usuwania pliku tymczasowego:', err);
        else console.log('Usunięto plik tymczasowy:', songData.path);
      });
    }, 5000); // Czekaj 5 sekund przed usunięciem
  }
}

// Modyfikacja funkcji playNextInQueue aby obsługiwać czyszczenie plików tymczasowych
const originalPlayNextInQueue = playNextInQueue;
playNextInQueue = function(guildId, channel) {
  const queueData = getQueue(guildId);
  const previousSong = queueData.currentSong;
  
  // Wyczyść poprzedni plik tymczasowy
  if (previousSong && previousSong.isTemp) {
    cleanupTempFile(previousSong);
  }
  
  return originalPlayNextInQueue(guildId, channel);
};

client.login(process.env.DISCORD_TOKEN);