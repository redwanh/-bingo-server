/**
 * Helmet Security Configuration
 */

const helmet = require('helmet');

const HELMET_CONFIG = {
    // Disable CSP for development (enable in production)
    contentSecurityPolicy: false,
    
    // Disable COEP for cross-origin requests
    crossOriginEmbedderPolicy: false,
    
    // Disable CORP for static files
    crossOriginResourcePolicy: false,
    
    // Disable COOP for popups
    crossOriginOpenerPolicy: false,
    
    // DNS prefetch control
    dnsPrefetchControl: {
        allow: true
    },
    
    // Frameguard
    frameguard: {
        action: 'sameorigin'
    },
    
    // HSTS (only in production)
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
    
    // XSS filter
    xssFilter: true,
    
    // No sniff
    noSniff: true,
    
    // IE no open
    ieNoOpen: true
};

/**
 * Create Helmet middleware
 */
function createHelmetMiddleware() {
    return helmet(HELMET_CONFIG);
}

module.exports = {
    createHelmetMiddleware,
    HELMET_CONFIG
};