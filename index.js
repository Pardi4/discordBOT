require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { VoiceManager } = require('./modules/voiceManager');
const { MessageHandler } = require('./modules/messageHandler');
const { StatusManager } = require('./modules/statusManager');
const { CONFIG } = require('./config/config');
const { createTempDir } = require('./utils/fileUtils');

// === INICJALIZACJA ===
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

// Inicjalizuj moduły
const statusManager = new StatusManager(client);
const voiceManager = new VoiceManager(client, statusManager);
const messageHandler = new MessageHandler(client, voiceManager, statusManager);

// === WYDARZENIA ===
client.once('ready', () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
  createTempDir();
  statusManager.initialize();
});

client.on('messageCreate', (message) => {
  messageHandler.handleMessage(message);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  voiceManager.handleVoiceStateUpdate(oldState, newState);
});

// === LOGOWANIE ===
client.login(process.env.DISCORD_TOKEN);