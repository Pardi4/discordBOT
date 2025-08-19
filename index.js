require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
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

// === ŚCIEŻKA DO PLIKU Z DANYMI ===
const dataFile = path.join(__dirname, 'data.json');

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

// === FUNKCJE DŹWIĘKU ===
function playJoinSound(userName, channel, guild) {
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
    if (conn) conn.destroy();
  });

  player.on('error', error => {
    console.error('Błąd audio:', error);
    const conn = getVoiceConnection(guild.id);
    if (conn) conn.destroy();
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
      'ty patryk lepiej juz sie nie odzywaj',
      'patryk czemu jestes cwelem?',
      'szkoda slow',
      'zamknij morde',
      'żałosne',
      'bądź moim super hero',
      'morda psie',
      'parada czeka',
      'basia dyma sobotaxa',
      'co sie robi w kinie?',
      'w co gramy?',
      'dolacz na kanal frajerze',
      'basia to świnia'
    ];
    message.reply(patrykMsgTable[Math.floor(Math.random() * patrykMsgTable.length)]);
    return;
  }

  if (message.content.toLowerCase().startsWith('.spam')) {
    if (username !== pardiNick) {
      message.reply("tylko patryk tak moze");
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

  // Komenda .graj <nazwa>
  if (message.content.startsWith('.graj ')) {
    const voiceChannel = message.member?.voice?.channel;
if (!voiceChannel) return message.reply('Musisz być na kanale głosowym, aby puścić dźwięk.');

const args = message.content.split(' ').slice(1); // wszystko po .graj
if (args.length === 0) return message.reply('Podaj nazwę pliku do odtworzenia.');

// Sprawdzenie, czy ostatni argument to filtr
const possibleFilter = args[args.length - 1].toLowerCase();
const validFilters = ['8d', 'echo', 'rate', 'pitch', 'speed'];
let filter = null;
let soundParts = args;

if (validFilters.includes(possibleFilter)) {
  filter = possibleFilter;
  soundParts = args.slice(0, -1); // reszta to nazwa pliku
}

// Łączymy nazwę pliku w jeden string (obsługa spacji)
const soundName = soundParts.join(' ');
const soundPath = path.join(__dirname, 'sounds', 'sounds', `${soundName}.mp3`);

if (!fs.existsSync(soundPath)) return message.reply(`Nie znaleziono pliku: ${soundName}.mp3`);

// Funkcja tworzenia zasobu audio z filtrami FFmpeg
function createFilteredResource(file, filterName) {
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
        ffmpegArgs = ['-i', file, '-filter:a', 'atempo=1.5', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'pitch':
        ffmpegArgs = ['-i', file, '-filter:a', 'asetrate=48000*1.2,aresample=48000', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
      case 'speed':
        ffmpegArgs = ['-i', file, '-filter:a', 'atempo=1.5', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
        break;
    }
  }

  const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  return createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
}

// Reszta kodu odtwarzania pozostaje bez zmian


    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createFilteredResource(soundPath, filter);

    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      const conn = getVoiceConnection(voiceChannel.guild.id);
      if (conn) conn.destroy();
    });

    player.on('error', error => {
      console.error('Błąd audio:', error);
      const conn = getVoiceConnection(voiceChannel.guild.id);
      if (conn) conn.destroy();
    });

    return message.reply(`▶️ Odtwarzam: ${soundName}.mp3${filter ? ` z filtrem: ${filter}` : ''}`);
  }


  // slava ukraina
  if (message.content.toLowerCase().includes('slava ukraina')) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Musisz być na kanale głosowym, aby puścić dźwięk.');

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

    return; // <- dodany return
  }
});

// === OBSŁUGA KANAŁÓW GŁOSOWYCH ===
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return; // <- ignorujemy bota
  const userName = member.user.username;

  // Wejście lub przełączenie kanału
  if ((!oldState.channel && newState.channel) || (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id)) {
    if (userName === patrykNick) setOnlineStatus();
    playJoinSound(userName, newState.channel, newState.guild);
  }

  // Wyjście z kanału
  if (oldState.channel && !newState.channel) {
    playJoinSound('Quit', oldState.channel, oldState.guild);
    handleUserLeaveChannel(userName);
  }
});

client.login(process.env.DISCORD_TOKEN);