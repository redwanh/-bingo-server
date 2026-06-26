require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./src/config/database');
const errorHandler = require('./src/middleware/errorHandler');
const MainBingoEngine = require('./src/services/mainBingoEngine');
const GameEngine = require('./src/services/gameEngine');
const GameSocket = require('./src/socket/gameSocket');
const GameConfig = require('./src/models/GameConfig');
const timerManager = require('./src/utils/TimerManager');


// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const PLAYER_URL = process.env.PLAYER_URL || 'http://localhost:3001';
const PRODUCTION_URL = process.env.PRODUCTION_URL || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Build allowed origins array
const allowedOrigins = [
    CLIENT_URL,
    PLAYER_URL,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
     'https://bingo-admin-9z6w.onrender.com',      // 🔥 ADD THIS
    'https://bingo-server-kd6t.onrender.com',
    'https://player-app-0qoe.onrender.com',  
];

// Add production URLs if set
if (PRODUCTION_URL) {
    allowedOrigins.push(PRODUCTION_URL);
    allowedOrigins.push(PRODUCTION_URL + ':3000');
    allowedOrigins.push(PRODUCTION_URL + ':3001');
}

// ============================================
// CREATE EXPRESS APP
// ============================================
const app = express();

// ============================================
// CORS - MUST BE FIRST
// ============================================
app.get('/health', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use(cors({ 
    origin: function(origin, callback) {
        // Allow requests from Capacitor (APK), localhost, and Render domains
        if (!origin || 
            origin.startsWith('capacitor://') || 
            origin.startsWith('http://localhost') ||
            origin.includes('render.com')) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all for now
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// ============================================
// SECURITY
// ============================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/voices', express.static('public/voices'));
app.use(express.static('public'));

// Logging
if (NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// CREATE HTTP SERVER
// ============================================
const server = http.createServer({ maxHeaderSize: 65536 }, app);

// ============================================
// SOCKET.IO
// ============================================
const io = socketIo(server, { 
    cors: { 
        origin: '*', // TEMP: Allow all for testing
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ============================================
// DATABASE
// ============================================
connectDB();

// ============================================
// ROUTES
// ============================================
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



// Error handler
app.use(errorHandler);

// ============================================
// INITIALIZE ENGINES
// ============================================
const mainBingoEngine = new MainBingoEngine(io);
const gameEngine = new GameEngine(io);
app.set('gameEngine', gameEngine);
app.set('io', io);
app.set('mainBingoEngine', mainBingoEngine);
const gameSocket = new GameSocket(io, gameEngine);
gameSocket.initialize();

// ============================================
// MAIN BINGO SOCKET HANDLERS
// ============================================
io.on('connection', (socket) => {
  
    // MainBingo BINGO call
    socket.on('mainBingoCallBingo', async (data) => {
        try {
            const result = await mainBingoEngine.callBingo(socket.userId, data.cardId);
            
            if (result.success) {
                const MainBingoGame = require('./src/models/MainBingoGame');
                const game = await MainBingoGame.getActiveGame();
                
                if (game && global.drawIntervals && global.drawIntervals[game._id.toString()]) {
                    clearInterval(global.drawIntervals[game._id.toString()]);
                    delete global.drawIntervals[game._id.toString()];
                    console.log('🛑 Stopped number drawing');
                }
            }
            
            socket.emit(result.success ? 'mainBingoBingoAccepted' : 'mainBingoBingoRejected', result);
        } catch (e) {
            socket.emit('mainBingoBingoError', { message: e.message });
        }
    });

    // MainBingo mark number
    socket.on('mainBingoMarkNumber', async (data) => {
        try {
            const card = await require('./src/models/Card').findOne({ _id: data.cardId, userId: socket.userId });
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

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log('═'.repeat(50));
    console.log(`🚀 BINGO SERVER RUNNING`);
    console.log(`   Port: ${PORT}`);
    console.log(`   Mode: ${NODE_ENV}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Client: ${CLIENT_URL}`);
    console.log(`   Player: ${PLAYER_URL}`);
    console.log('═'.repeat(50));
});

module.exports = { app, server, io, gameEngine, mainBingoEngine };
