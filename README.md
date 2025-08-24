# Discord Music Bot 2.0 🎵

Zaawansowany bot muzyczny Discord z profesjonalnym systemem crossfade w stylu DJ i modularną architekturą przygotowaną na przyszłe rozszerzenia (YouTube, Spotify itp.).

## 🚀 Nowe funkcje 2.0

### 🎛️ Profesjonalny Crossfade DJ Mode
- **Inteligentne przejścia** - automatyczna analiza i optymalizacja czasu crossfade
- **EQ podczas przejść** - przycinanie basów przy fade out, wzmacnianie wysokich przy fade in
- **Auto-gain normalization** - automatyczne wyrównanie głośności
- **Stereo spread enhancement** - rozszerzenie obrazu stereo podczas przejść
- **Real-time kontrola** - panel crossfade z przyciskami w wiadomości "now playing"

### 🏗️ Modularna Architektura
- **Łatwa rozbudowa** - gotowa struktura na YouTube, Spotify, SoundCloud
- **Niezależne moduły** - każda funkcja w osobnym pliku
- **Centralna konfiguracja** - wszystkie ustawienia w jednym miejscu
- **Zaawansowane utils** - narzędzia do stringów, plików, backupów

### 🎵 Ulepszone Funkcje Muzyczne
- **Zaawansowana kolejka** - crossfade-aware queue management
- **Inteligentne wyszukiwanie** - fuzzy search dla nazw plików
- **Backup i restore** - automatyczne backupy ustawień
- **Performance monitoring** - statystyki i diagnostyka

## 📁 Struktura Projektu

```
discord-music-bot-v2/
├── index.js                 # Główny plik bota
├── config/
│   └── config.js            # Centralna konfiguracja
├── modules/
│   ├── audioPlayer.js       # Odtwarzacz audio z crossfade
│   ├── commandHandler.js    # Obsługa komend
│   ├── crossfadeManager.js  # Zaawansowany system crossfade
│   ├── messageHandler.js    # Obsługa wiadomości
│   ├── musicQueue.js        # Manager kolejki muzycznej
│   ├── soundManager.js      # Manager dźwięków
│   ├── statusManager.js     # Manager statusu bota
│   └── voiceManager.js      # Manager kanałów głosowych
├── utils/
│   ├── fileUtils.js         # Narzędzia do plików
│   └── stringUtils.js       # Narzędzia do stringów
├── sounds/                  # Katalog z dźwiękami
│   ├── sounds/              # Główne dźwięki
│   ├── patrykJoin/         # Dźwięki join użytkownika
│   ├── lotusJoin/
│   ├── pardiJoin/
│   ├── kaktucatJoin/
│   ├── Quit/               # Dźwięki leave
│   └── slava/              # Specjalne dźwięki
├── temp/                   # Pliki tymczasowe
├── backups/                # Automatyczne backupy
├── data.json               # Dane bota
├── users.json              # Ustawienia użytkowników
├── crossfade.json          # Ustawienia crossfade
└── .env                    # Token bota
```

## 🛠️ Instalacja i Konfiguracja

### 1. Wymagania
- Node.js