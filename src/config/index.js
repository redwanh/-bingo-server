/**
 * Central configuration export
 */

const corsConfig = require('./cors');
const serverConfig = require('./server');
const socketConfig = require('./socket');
const helmetConfig = require('./helmet');

module.exports = {
    cors: corsConfig,
    server: serverConfig,
    socket: socketConfig,
    helmet: helmetConfig
};