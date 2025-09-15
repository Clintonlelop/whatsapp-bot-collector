const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
fs.ensureDirSync(logsDir);

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        targets: [
            {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss',
                    ignore: 'pid,hostname'
                },
                level: 'info'
            },
            {
                target: 'pino/file',
                options: {
                    destination: path.join(logsDir, 'bot.log'),
                    mkdir: true
                },
                level: 'debug'
            }
        ]
    }
});

module.exports = logger;
