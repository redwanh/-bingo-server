/**
 * Request logging middleware for debugging
 */

function requestLogger(req, res, next) {
    const start = Date.now();
    const { method, url, headers } = req;
    
    // Log request
    console.log(`📥 ${method} ${url} [${new Date().toISOString()}]`);
    
    // Log auth header presence
    if (headers.authorization) {
        const token = headers.authorization.replace('Bearer ', '');
        console.log(`   🔑 Auth: Bearer ${token.substring(0, 10)}... (${token.length} chars)`);
    } else {
        console.log(`   🔓 No auth token`);
    }
    
    // Log cookie size
    if (headers.cookie) {
        console.log(`   🍪 Cookies: ${headers.cookie.length} bytes`);
        if (headers.cookie.length > 4096) {
            console.warn(`   ⚠️ Large cookies detected (${headers.cookie.length} bytes) - may cause 431 error`);
        }
    }
    
    // Capture response
    const originalEnd = res.end;
    res.end = function (...args) {
        const duration = Date.now() - start;
        console.log(`📤 ${method} ${url} → ${res.statusCode} (${duration}ms)`);
        originalEnd.apply(res, args);
    };
    
    next();
}

module.exports = requestLogger;