require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./src/config/database');
const errorHandler = require('./src/middleware/errorHandler');
const MainBingoEngine = require('./src/services/mainBingoEngine');
const GameEngine = require('./src/engine');
const GameSocket = require('./src/socket/gameSocket');
const userGameHistoryRoutes = require('./src/routes/UserGameHistory');
const mainBingoHistoryRoutes = require('./src/routes/MainBingoHistory');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const PLAYER_URL = process.env.PLAYER_URL || 'http://localhost:3001';
const PRODUCTION_URL = process.env.PRODUCTION_URL || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

const allowedOrigins = [
    CLIENT_URL,
    PLAYER_URL,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
    'https://bingo-admin-9z6w.onrender.com',
    'https://bingo-server-kd6t.onrender.com',
    'https://player-app-0qoe.onrender.com',
];

if (PRODUCTION_URL) {
    allowedOrigins.push(PRODUCTION_URL);
    allowedOrigins.push(PRODUCTION_URL + ':3000');
    allowedOrigins.push(PRODUCTION_URL + ':3001');
}

const app = express();

app.use(function(req, res, next) {
    const origin = req.headers.origin;
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/voices', express.static('public/voices'));
app.use(express.static('public'));

if (NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
}));

const server = http.createServer({ maxHeaderSize: 65536 }, app);

const io = socketIo(server, { 
    cors: { 
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

connectDB();
connectDB();

// 🔥 TEMP: Seed cards - DELETE AFTER USE
app.get('/api/seed-cards', async (req, res) => {
  try {
    const Card = require('./src/models/Card');
    await Card.deleteMany({ status: 'preview' });
    
    const cards = [];
    for (let i = 0; i < 200; i++) {
      const grid = { B: genCol(1,15), I: genCol(16,30), N: genCol(31,45), G: genCol(46,60), O: genCol(61,75) };
      grid.N[2] = { number: 0, isMarked: true };
      cards.push({ gameId: null, userId: null, displayId: 10000 + i, cardNumber: i + 1, grid, price: 50, status: 'preview' });
    }
    await Card.insertMany(cards);
    res.json({ success: true, count: cards.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function genCol(min, max) {
  const s = new Set();
  while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min);
  return Array.from(s).map(n => ({ number: n, isMarked: false }));
}

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/users', require('./src/routes/userRoutes'));
app.use('/api/payments', require('./src/routes/paymentRoutes'));
app.use('/api/finance', require('./src/routes/financeRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/app-settings', require('./src/routes/appSettingsRoutes'));
app.use('/api/cms', require('./src/routes/cmsRoutes'));
app.use('/api/voice', require('./src/routes/voiceRoutes'));
app.use('/api/main-bingo-rules', require('./src/routes/mainBingoRuleRoutes'));
app.use('/api/main-bingo', require('./src/routes/mainBingoRoutes'));
app.use('/api/game-monitor', require('./src/routes/gameMonitorRoutes'));
app.use('/api/cards', require('./src/routes/cardRoutes'));
app.use('/api/notifications', require('./src/routes/notificationRoutes'));
app.use('/api/game', require('./src/routes/gameRoutes'));
app.use('/api/scheduled-games', require('./src/routes/scheduledGameRoutes'));
app.use('/api/user-game-history', userGameHistoryRoutes);
app.use('/api/main-bingo-history', mainBingoHistoryRoutes);

const possibleBuildPaths = [
    path.join(__dirname, '..', 'client', 'build'),
    path.join(__dirname, '..', 'frontend', 'build'),
    path.join(__dirname, '..', 'build'),
    path.join(__dirname, 'client', 'build'),
    path.join(__dirname, 'build'),
    path.join(__dirname, '..', '..', 'client', 'build'),
];

let clientBuildPath = null;
for (const buildPath of possibleBuildPaths) {
    if (fs.existsSync(buildPath)) {
        clientBuildPath = buildPath;
        break;
    }
}

if (clientBuildPath) {
    app.use(express.static(clientBuildPath));
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(clientBuildPath, 'index.html'));
        }
    });
} else {
    console.warn('React build not found. Client-side routing will not work.');
}

app.use(errorHandler);

const mainBingoEngine = new MainBingoEngine(io);
const gameEngine = new GameEngine(io);

app.set('gameEngine', gameEngine);
app.set('io', io);
app.set('mainBingoEngine', mainBingoEngine);

const gameSocket = new GameSocket(io, gameEngine);
gameSocket.initialize();

io.on('connection', (socket) => {
    socket.on('mainBingoCallBingo', async (data) => {
        try {
            const result = await mainBingoEngine.callBingo(socket.userId, data.cardId);
            
            if (result.success) {
                const MainBingoGame = require('./src/models/MainBingoGame');
                const game = await MainBingoGame.getActiveGame();
                
                if (game && global.drawIntervals && global.drawIntervals[game._id.toString()]) {
                    clearInterval(global.drawIntervals[game._id.toString()]);
                    delete global.drawIntervals[game._id.toString()];
                }
            }
            
            socket.emit(result.success ? 'mainBingoBingoAccepted' : 'mainBingoBingoRejected', result);
        } catch (e) {
            socket.emit('mainBingoBingoError', { message: e.message });
        }
    });

    const Game = require('./src/models/Game');

// Auto-create first game if none exists
Game.countDocuments({ roomId: 'fast_bingo', status: { $ne: 'completed' } }).then(async (count) => {
  if (count === 0) {
    const lastNum = await Game.getLatestGameNumber('fast_bingo');
    await Game.create({
      gameId: String(lastNum + 1).padStart(10, '0'),
      gameNumber: lastNum + 1,
      roomId: 'fast_bingo',
      status: 'scheduled',
      allNumbers: [],
      minCardsToStart: 1,
      timerDuration: 30
    });
    console.log(`🆕 Created first game #${lastNum + 1}`);
  }
});

    socket.on('mainBingoMarkNumber', async (data) => {
        try {
            const Card = require('./src/models/Card');
            const card = await Card.findOne({ _id: data.cardId, userId: socket.userId });
            
            if (card && !card.isBlocked) {
                const cell = card.grid[data.letter]?.find(c => c.number === data.number);
                if (cell) {
                    cell.isMarked = !cell.isMarked;
                    await card.save();
                }
                socket.emit('mainBingoNumberMarked', { cardId: data.cardId, grid: card.grid });
            }
        } catch (e) {
            socket.emit('mainBingoError', { message: e.message });
        }
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${NODE_ENV} mode`);
});

module.exports = { app, server, io, gameEngine, mainBingoEngine };
