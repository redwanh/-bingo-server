// ============================================
// GAME STATES
// ============================================
const GAME_STATES = {
  SETUP: 'setup',
  COUNTDOWN: 'countdown',
  IN_PROGRESS: 'in_progress',
  BINGO_CALLED: 'bingo_called',
  GRACE_PERIOD: 'grace_period',
  COMPLETED: 'completed',
};

// ============================================
// REDIS KEY PATTERNS
// ============================================
const REDIS_KEYS = {
  GAME_STATE: (gameId) => `game:${gameId}:state`,
  DRAWN_NUMBERS: (gameId) => `game:${gameId}:drawn`,
  PLAYER_CARDS: (gameId, userId) => `game:${gameId}:player:${userId}:cards`,
};

// ============================================
// SOCKET EVENTS
// ============================================
const EVENTS = {
  // Server → Client
  GAME_STATE: 'gameState',
  NUMBER_DRAWN: 'mainBingoNumberDrawn',
  GRACE_PERIOD: 'mainBingoGracePeriod',
  GAME_ENDED: 'mainBingoEnded',
  FALSE_BINGO: 'mainBingoFalseBingo',

  // Client → Server
  JOIN_ROOM: 'joinRoom',
  PICK_CARDS: 'mainBingoPickCards',
  REGISTER_CARDS: 'mainBingoRegisterCards',
  CALL_BINGO: 'mainBingoCallBingo',
};

// ============================================
// ROOM NAMES
// ============================================
const ROOMS = {
  MAIN_BINGO: 'main-bingo-room',
  FAST_BINGO: 'fast_bingo',
};

// ============================================
// TIMING DEFAULTS (seconds)
// ============================================
const DEFAULTS = {
  COUNTDOWN_SECONDS: 30,
  DRAW_INTERVAL_SECONDS: 2,
  GRACE_PERIOD_SECONDS: 10,
  BINGO_CALLED_DELAY: 3,
};

module.exports = { GAME_STATES, REDIS_KEYS, EVENTS, ROOMS, DEFAULTS };