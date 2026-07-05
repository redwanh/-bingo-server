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

// ══════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const PLAYER_URL = process.env.PLAYER_URL || 'http://localhost:3001';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    CLIENT_URL,
    PLAYER_URL,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
    'https://bingo-admin-9z6w.onrender.com',
    'https://bingo-server-kd6t.onrender.com',
    'https://player-app-0qoe.onrender.com',
].filter(Boolean);

// ══════════════════════════════════════
// APP SETUP
// ══════════════════════════════════════
const app = express();

// Security (disable strict CORS for API)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
}));

// CORS - Allow all origins for now (fix later)
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

// ══════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════
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

// ══════════════════════════════════════
// STATIC FILES (PRODUCTION)
// ══════════════════════════════════════
const buildPaths = [
    path.join(__dirname, '..', 'client', 'build'),
    path.join(__dirname, 'client', 'build'),
    path.join(__dirname, 'build'),
];

const clientBuildPath = buildPaths.find(p => fs.existsSync(p));

if (clientBuildPath) {
    app.use(express.static(clientBuildPath));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
} else if (NODE_ENV === 'development') {
    console.log('⚠️ React build not found - API only mode');
}

app.use(errorHandler);

// ══════════════════════════════════════
// SERVER & SOCKET SETUP
// ══════════════════════════════════════
const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
});

// ══════════════════════════════════════
// START SERVER
// ══════════════════════════════════════
async function startServer() {
    try {
        await connectDB();
        console.log('✅ Database connected');

        // Create indexes
        await require('./src/models/indexes')();

        // Initialize game engines
        const mainBingoEngine = new MainBingoEngine(io);
console.log('🔍 MainBingoEngine created:', !!mainBingoEngine);
console.log('🔍 drawNumbers method:', typeof mainBingoEngine.drawNumbers);
        const gameEngine = new GameEngine(io);

        app.set('gameEngine', gameEngine);
        app.set('io', io);
        app.set('mainBingoEngine', mainBingoEngine);

        // Initialize socket handlers (pass BOTH engines)
        const gameSocket = new GameSocket(io, gameEngine, mainBingoEngine);
        gameSocket.initialize();

        // Create first fast bingo game if none exists
        try {
            const Game = require('./src/models/Game');
            const activeGames = await Game.countDocuments({ roomId: 'fast_bingo', status: { $ne: 'completed' } });
            if (activeGames === 0) {
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
        } catch (err) {
            console.error('❌ Error creating first game:', err.message);
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