/**
 * Socket.IO Configuration
 */

const socketIo = require('socket.io');

const SOCKET_CONFIG = {
    // CORS for Socket.IO
    cors: {
        origin: [
            process.env.CLIENT_URL || 'http://localhost:3000',
            process.env.PLAYER_URL || 'http://localhost:3001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
        ],
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization']
    },
    
    // Connection settings
    pingTimeout: 60000,
    pingInterval: 25000,
    
    // Buffer size
    maxHttpBufferSize: 1e8, // 100MB
    
    // Transport
    transports: ['websocket', 'polling'],
    
    // Compression
    perMessageDeflate: {
        threshold: 1024 // Compress messages > 1KB
    }
};

/**
 * Create Socket.IO server
 */
function createSocketServer(httpServer) {
    const io = socketIo(httpServer, SOCKET_CONFIG);
    
    // Log connections
    io.on('connection', (socket) => {
        console.log(`🔌 Socket connected: ${socket.id}`);
        
        socket.on('disconnect', (reason) => {
            console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);
        });
    });
    
    return io;
}

module.exports = {
    createSocketServer,
    SOCKET_CONFIG
};