// ============================================================
// server.js — FULL UPDATED with 3 rooms
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./src/config/database');
const errorHandler = require('./src/middleware/errorHandler');
const MainBingoEngine = require('./src/services/mainBingoEngine');
const GameEngine = require('./src/engine');
const GameSocket = require('./src/socket/gameSocket');

// 🔥 NEW IMPORTS
const FB_FastBingoEngine = require('./src/engine/FB_FastBingoEngine');
const FB_FastBingoSocket = require('./src/socket/FB_fastBingoSocket');

// ══════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const PLAYER_URL = process.env.PLAYER_URL || 'http://localhost:3001';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    CLIENT_URL, PLAYER_URL,
    'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5000',
    'https://bingo-admin-9z6w.onrender.com',
    'https://bingo-server-kd6t.onrender.com',
    'https://player-app-0qoe.onrender.com',
].filter(Boolean);

// ══════════════════════════════════════
// APP SETUP
// ══════════════════════════════════════
const app = express();

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
}));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (NODE_ENV === 'development') app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/voices', express.static('public/voices'));
app.use(express.static('public'));

// API ROUTES
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
app.use('/api/user-game-history', require('./src/routes/UserGameHistory'));
app.use('/api/main-bingo-history', require('./src/routes/MainBingoHistory'));
app.use('/api/fb', require('./src/routes/FB_fastBingoRoutes'));

// STATIC FILES (PRODUCTION)
const buildPaths = [
    path.join(__dirname, '..', 'player-app', 'build'),
    path.join(__dirname, '..', 'client', 'build'),
    path.join(__dirname, 'client', 'build'),
    path.join(__dirname, 'build'),
];

const clientBuildPath = buildPaths.find(p => fs.existsSync(p));

if (clientBuildPath) {
    console.log('📁 Serving static files from:', clientBuildPath);
    app.use(express.static(clientBuildPath));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        if (req.path.startsWith('/health')) return next();
        if (req.path.startsWith('/uploads')) return next();
        if (req.path.startsWith('/voices')) return next();
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
} else if (NODE_ENV === 'development') {
    console.log('⚠️ React build not found - API only mode');
} else {
    console.log('⚠️ No static build found. Checking paths:');
    buildPaths.forEach(p => console.log('  ', p, fs.existsSync(p) ? '✅' : '❌'));
}

app.use(errorHandler);

// SERVER & SOCKET SETUP
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 120000, pingInterval: 30000, connectTimeout: 30000,
    maxHttpBufferSize: 1e6, transports: ['websocket', 'polling'],
});

// START SERVER
async function startServer() {
    try {
        await connectDB();
        console.log('✅ Database connected');

        // ADD INDEXES
        try {
            const FB_Game = require('./src/models/FB_Game');
            const FB_Card = require('./src/models/FB_Card');
            await Promise.all([
                FB_Game.collection.createIndex({ roomId: 1, status: 1, gameNumber: -1 }),
                FB_Game.collection.createIndex({ gameId: 1 }),
                FB_Card.collection.createIndex({ displayId: 1 }),
                FB_Card.collection.createIndex({ gameId: 1, userId: 1, status: 1 }),
                FB_Card.collection.createIndex({ gameId: 1, status: 1, isBlocked: 1, bingoCalled: 1 }),
            ]);
            console.log('✅ FB indexes ready');
        } catch (idxErr) {
            console.warn('⚠️ FB indexes warning:', idxErr.message);
        }

        await require('./src/models/indexes')();

        // OLD ENGINES
        const mainBingoEngine = new MainBingoEngine(io);
        const gameEngine = new GameEngine(io);
        app.set('gameEngine', gameEngine);
        app.set('io', io);
        app.set('mainBingoEngine', mainBingoEngine);

        const gameSocket = new GameSocket(io, gameEngine, mainBingoEngine);
        gameSocket.initialize();
        console.log('✅ Old GameSocket initialized');

        // NEW FB ENGINE
        const fbEngine = new FB_FastBingoEngine(io);
        app.set('fbEngine', fbEngine);
        const fbSocket = new FB_FastBingoSocket(io, fbEngine);
        fbSocket.initialize();
        console.log('✅ FB_FastBingoSocket initialized');

        // 🔥 CREATE FIRST GAMES FOR ALL 3 ROOMS
       // 🔥 CREATE FIRST GAMES FOR ALL 3 ROOMS
const FB_ROOMS = ['fb_fast_bingo_10', 'fb_fast_bingo_20', 'fb_fast_bingo_30'];
try {
    const FB_Game = require('./src/models/FB_Game');
    
    // 🔥 First, delete old single-room games to avoid conflicts
    await FB_Game.deleteMany({ roomId: 'fb_fast_bingo' });
    
    for (const roomId of FB_ROOMS) {
        const activeGames = await FB_Game.countDocuments({ roomId, status: { $ne: 'completed' } });
        if (activeGames === 0) {
            const lastNum = await FB_Game.getLatestGameNumber(roomId);
            await FB_Game.create({
                gameId: `${roomId}_${String(lastNum + 1).padStart(10, '0')}`,
                gameNumber: lastNum + 1,
                roomId,
                status: 'scheduled',
                allNumbers: fbEngine.shuffleNumbers(),
                timerDuration: 30
            });
            console.log(`🆕 FB: Created first game for ${roomId} (#${lastNum + 1})`);
        }
    }
} catch (err) {
    console.error('❌ FB: Error creating first games:', err.message);
}

        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT} in ${NODE_ENV} mode`);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();

module.exports = { app, server, io };