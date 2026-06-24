/**
 * CORS Configuration for Bingo Platform
 * Handles Cross-Origin Resource Sharing settings
 */

const cors = require('cors');

// Allowed origins
const ALLOWED_ORIGINS = [
    process.env.CLIENT_URL || 'http://localhost:3000',
    process.env.PLAYER_URL || 'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
    'https://bingo-admin-9z6w.onrender.com',      
    'https://bingo-server-kd6t.onrender.com',
];

// Allowed methods
const ALLOWED_METHODS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'OPTIONS'
];

// Allowed headers
const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
];

// Exposed headers
const EXPOSED_HEADERS = [
    'Content-Length',
    'X-Request-Id'
];

/**
 * CORS Options
 */
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) {
            return callback(null, true);
        }
        
        // Check if origin is allowed
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS Blocked origin: ${origin}`);
            callback(null, true); // Allow all origins in development
            // callback(new Error('Not allowed by CORS')); // Strict mode
        }
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
};

/**
 * Create CORS middleware
 */
function createCorsMiddleware() {
    return cors(corsOptions);
}

/**
 * Create preflight handler
 */
function createPreflightHandler() {
    return (req, res, next) => {
        // Set CORS headers for all responses
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
        res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
        res.header('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));
        res.header('Access-Control-Max-Age', '86400');
        
        // Handle preflight
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }
        
        next();
    };
}

/**
 * CORS error handler
 */
function corsErrorHandler(err, req, res, next) {
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'CORS Error',
            message: 'Origin not allowed',
            origin: req.headers.origin
        });
    }
    next(err);
}

module.exports = {
    createCorsMiddleware,
    createPreflightHandler,
    corsErrorHandler,
    ALLOWED_ORIGINS,
    ALLOWED_METHODS,
    ALLOWED_HEADERS
};
