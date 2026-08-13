const WhatsAppBot = require('./src/bot');
const logger = require('./src/utils/logger');

async function main() {
    try {
        logger.info('Starting WhatsApp Bot Collector...');
        const bot = new WhatsAppBot();
        await bot.start();
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

main();
