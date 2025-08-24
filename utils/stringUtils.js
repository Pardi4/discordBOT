// === FUNKCJE PORÓWNYWANIA STRINGÓW ===

/**
 * Oblicza odległość Levenshteina między dwoma stringami
 * Używane do znajdowania najbliższego dopasowania nazwy pliku
 */
const levenshteinDistance = (str1, str2) => {
  const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i][0] = i;
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
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

/**
 * Oblicza podobieństwo między stringami (0-1, gdzie 1 to identyczne)
 */
const stringSimilarity = (str1, str2) => {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;
  
  const distance = levenshteinDistance(str1, str2);
  return (maxLength - distance) / maxLength;
};

/**
 * Znajdź najlepsze dopasowanie dla wyszukiwanego stringa w tablicy
 */
const findBestMatch = (searchString, targetArray, threshold = 0.3) => {
  let bestMatch = null;
  let bestScore = 0;
  
  targetArray.forEach(target => {
    const similarity = stringSimilarity(
      searchString.toLowerCase(),
      target.toLowerCase()
    );
    
    if (similarity > bestScore && similarity >= threshold) {
      bestScore = similarity;
      bestMatch = target;
    }
  });
  
  return {
    match: bestMatch,
    score: bestScore,
    isGoodMatch: bestScore >= threshold
  };
};

/**
 * Normalizacja stringów dla lepszego wyszukiwania
 */
const normalizeString = (str) => {
  return str
    .toLowerCase()
    .normalize('NFD') // Rozkłada znaki diakrytyczne
    .replace(/[\u0300-\u036f]/g, '') // Usuwa diakrytyki
    .replace(/[^a-z0-9\s]/g, '') // Pozostawia tylko litery, cyfry i spacje
    .replace(/\s+/g, ' ') // Normalizuje spacje
    .trim();
};

/**
 * Wyszukiwanie fuzzy - znajduje pasujące stringi nawet z błędami
 */
const fuzzySearch = (query, items, options = {}) => {
  const {
    threshold = 0.3,
    limit = 10,
    normalizeItems = true,
    returnScores = false
  } = options;
  
  const normalizedQuery = normalizeString(query);
  
  const results = items.map(item => {
    const normalizedItem = normalizeItems ? normalizeString(item) : item.toLowerCase();
    const score = stringSimilarity(normalizedQuery, normalizedItem);
    
    return {
      item,
      score,
      normalizedItem
    };
  })
  .filter(result => result.score >= threshold)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);
  
  return returnScores ? results : results.map(r => r.item);
};

/**
 * Sprawdza czy string zawiera wszystkie słowa kluczowe
 */
const containsAllKeywords = (text, keywords) => {
  const normalizedText = normalizeString(text);
  const normalizedKeywords = keywords.map(k => normalizeString(k));
  
  return normalizedKeywords.every(keyword => 
    normalizedText.includes(keyword)
  );
};

/**
 * Wyróżnia pasujące fragmenty w tekście
 */
const highlightMatches = (text, query, highlightStart = '**', highlightEnd = '**') => {
  if (!query || !text) return text;
  
  const normalizedQuery = normalizeString(query);
  const words = normalizedQuery.split(' ').filter(w => w.length > 0);
  
  let result = text;
  
  words.forEach(word => {
    const regex = new RegExp(`(${word})`, 'gi');
    result = result.replace(regex, `${highlightStart}$1${highlightEnd}`);
  });
  
  return result;
};

/**
 * Skraca string do określonej długości z wielokropkiem
 */
const truncateString = (str, maxLength = 50, suffix = '...') => {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Formatuje nazwy plików dla wyświetlenia
 */
const formatFileName = (fileName, options = {}) => {
  const {
    removeExtension = true,
    maxLength = 30,
    capitalizeWords = false
  } = options;
  
  let formatted = fileName;
  
  // Usuń rozszerzenie
  if (removeExtension) {
    formatted = formatted.replace(/\.[^/.]+$/, '');
  }
  
  // Zamień podkreślenia i myślniki na spacje
  formatted = formatted.replace(/[_-]/g, ' ');
  
  // Kapitalizuj słowa jeśli wymagane
  if (capitalizeWords) {
    formatted = formatted.replace(/\b\w/g, l => l.toUpperCase());
  }
  
  // Skróć jeśli za długi
  if (maxLength && formatted.length > maxLength) {
    formatted = truncateString(formatted, maxLength);
  }
  
  return formatted;
};

/**
 * Parsuje argumenty komendy z uwzględnieniem cudzysłowów
 */
const parseCommandArgs = (commandString) => {
  const args = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  
  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];
    
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    args.push(current);
  }
  
  return args;
};

/**
 * Waliduje nazwy plików
 */
const isValidFileName = (fileName) => {
  // Sprawdź niebezpieczne znaki
  const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (dangerousChars.test(fileName)) return false;
  
  // Sprawdź długość
  if (fileName.length === 0 || fileName.length > 255) return false;
  
  // Sprawdź czy to nie są zarezerwowane nazwy Windows
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reservedNames.test(fileName)) return false;
  
  return true;
};

/**
 * Czyści string z emoji i specjalnych znaków Unicode
 */
const removeEmojis = (str) => {
  return str.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
};

/**
 * Generuje bezpieczny identyfikator z stringa
 */
const generateSafeId = (str, maxLength = 20) => {
  return normalizeString(str)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, maxLength);
};

module.exports = {
  levenshteinDistance,
  stringSimilarity,
  findBestMatch,
  normalizeString,
  fuzzySearch,
  containsAllKeywords,
  highlightMatches,
  truncateString,
  formatFileName,
  parseCommandArgs,
  isValidFileName,
  removeEmojis,
  generateSafeId
};