/**
 * HTTP Server Configuration
 * Handles server creation with proper settings
 */

const http = require('http');

const SERVER_CONFIG = {
    // Fix 431 error - increase max header size (default is 8KB)
    maxHeaderSize: 65536,      // 64KB
    
    // Request timeout
    requestTimeout: 60000,     // 60 seconds
    
    // Headers timeout
    headersTimeout: 30000,     // 30 seconds
    
    // Keep alive
    keepAliveTimeout: 5000,    // 5 seconds
    
    // Max connections
    maxConnections: 1000,
};

/**
 * Create HTTP server with proper configuration
 */
function createServer(app) {
    const server = http.createServer(SERVER_CONFIG, app);
    
    // Log server errors
    server.on('error', (error) => {
        console.error('❌ Server error:', error.message);
        
        if (error.code === 'EADDRINUSE') {
            console.error(` Port ${error.port} is already in use`);
        }
    });
    
    // Log when server is ready
    server.on('listening', () => {
        const addr = server.address();
        console.log(`🚀 Server listening on port ${addr.port}`);
    });
    
    return server;
}

module.exports = {
    createServer,
    SERVER_CONFIG
};