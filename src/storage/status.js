const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

class StatusManager {
    constructor() {
        this.enabled = true;
        this.viewedStatuses = new Set();
        this.dataDir = path.join(__dirname, '../../data');
        this.statusPath = path.join(this.dataDir, 'viewed_statuses.json');
        
        // Ensure data directory exists
        fs.ensureDirSync(this.dataDir);
        this.loadViewedStatuses();
    }

    async loadViewedStatuses() {
        try {
            if (fs.existsSync(this.statusPath)) {
                const data = await fs.readJson(this.statusPath);
                this.viewedStatuses = new Set(data.viewedStatuses || []);
                this.enabled = data.enabled !== undefined ? data.enabled : true;
            }
        } catch (error) {
            logger.error('Failed to load viewed statuses:', error);
        }
    }

    async saveViewedStatuses() {
        try {
            const data = {
                enabled: this.enabled,
                viewedStatuses: Array.from(this.viewedStatuses)
            };
            await fs.writeJson(this.statusPath, data, { spaces: 2 });
        } catch (error) {
            logger.error('Failed to save viewed statuses:', error);
        }
    }

    async viewAndSaveStatus(sock, statusMessage) {
        if (!this.enabled) return;

        try {
            const statusId = statusMessage.key.id;
            const senderNumber = statusMessage.key.participant?.split('@')[0] || 'unknown';
            
            // Check if already viewed
            if (this.viewedStatuses.has(statusId)) {
                return;
            }

            // ACTUALLY VIEW the status (mark as read)
            await this.markStatusAsViewed(sock, statusMessage);

            // Mark as viewed in our tracking
            this.viewedStatuses.add(statusId);
            await this.saveViewedStatuses();

            // Get sender info
            const senderInfo = await this.getSenderInfo(sock, statusMessage.key.participant);
            const senderName = senderInfo?.name || senderInfo?.pushName || senderNumber;

            // Extract and save status content to files
            const saveResult = await this.saveStatusToFile(sock, statusMessage, senderNumber, statusId);
            
            // Send to "Message Yourself" with actual media
            await this.sendToSelf(sock, {
                senderName,
                senderNumber,
                savedFile: saveResult?.filePath,
                mediaBuffer: saveResult?.mediaBuffer,
                content: this.extractStatusContent(statusMessage),
                timestamp: new Date().toISOString()
            });

            if (saveResult?.filePath) {
                logger.info(`Viewed and saved status to: ${saveResult.filePath} from ${senderName} (${senderNumber})`);
            } else {
                logger.info(`Viewed status from: ${senderName} (${senderNumber}) - no file saved`);
            }
        } catch (error) {
            logger.error('Failed to view and save status:', error);
        }
    }

    async saveStatusToFile(sock, statusMessage, senderNumber, statusId) {
        try {
            const message = statusMessage.message;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            // Create status directory
            const statusDir = path.join(this.dataDir, 'statuses', senderNumber);
            await fs.ensureDir(statusDir);

            // Handle different message types
            if (message.conversation || message.extendedTextMessage) {
                // Text status
                const text = message.conversation || message.extendedTextMessage?.text || '';
                const filename = `${timestamp}-${statusId}.txt`;
                const filepath = path.join(statusDir, filename);
                
                await fs.writeFile(filepath, text, 'utf8');
                return { filePath: filepath, mediaBuffer: null };
                
            } else if (message.imageMessage) {
                // Image status
                const buffer = await this.downloadMedia(sock, statusMessage);
                if (buffer) {
                    const extension = this.getExtensionFromMimetype(message.imageMessage.mimetype) || '.jpg';
                    const filename = `${timestamp}-${statusId}${extension}`;
                    const filepath = path.join(statusDir, filename);
                    
                    await fs.writeFile(filepath, buffer);
                    
                    // Also save caption if exists
                    if (message.imageMessage.caption) {
                        const captionFile = path.join(statusDir, `${timestamp}-${statusId}_caption.txt`);
                        await fs.writeFile(captionFile, message.imageMessage.caption, 'utf8');
                    }
                    
                    return { filePath: filepath, mediaBuffer: buffer };
                }
                
            } else if (message.videoMessage) {
                // Video status
                const buffer = await this.downloadMedia(sock, statusMessage);
                if (buffer) {
                    const extension = this.getExtensionFromMimetype(message.videoMessage.mimetype) || '.mp4';
                    const filename = `${timestamp}-${statusId}${extension}`;
                    const filepath = path.join(statusDir, filename);
                    
                    await fs.writeFile(filepath, buffer);
                    
                    // Also save caption if exists
                    if (message.videoMessage.caption) {
                        const captionFile = path.join(statusDir, `${timestamp}-${statusId}_caption.txt`);
                        await fs.writeFile(captionFile, message.videoMessage.caption, 'utf8');
                    }
                    
                    return { filePath: filepath, mediaBuffer: buffer };
                }
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to save status to file:', error);
            return null;
        }
    }

    async downloadMedia(sock, message) {
        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(message, 'buffer', {}, { 
                reuploadRequest: sock.updateMediaMessage 
            });
            return buffer;
        } catch (error) {
            logger.error('Failed to download media:', error);
            return null;
        }
    }

    getExtensionFromMimetype(mimetype) {
        if (!mimetype) return '';
        
        const extensions = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg', 
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/avi': '.avi',
            'video/mov': '.mov',
            'video/webm': '.webm',
            'audio/mp3': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg'
        };
        
        return extensions[mimetype.toLowerCase()] || '';
    }

    async markStatusAsViewed(sock, statusMessage) {
        try {
            // Mark the status message as read/viewed
            await sock.readMessages([statusMessage.key]);
            logger.info(`Marked status as viewed: ${statusMessage.key.id}`);
        } catch (error) {
            logger.error('Failed to mark status as viewed:', error);
        }
    }

    async getSenderInfo(sock, participantJid) {
        try {
            if (!participantJid) return null;
            const contact = await sock.onWhatsApp(participantJid);
            return contact[0] || null;
        } catch (error) {
            logger.error('Failed to get sender info:', error);
            return null;
        }
    }

    extractStatusContent(statusMessage) {
        const message = statusMessage.message;
        
        // Text status types
        if (message.conversation) {
            return { type: 'text', content: message.conversation };
        } else if (message.extendedTextMessage) {
            return { type: 'text', content: message.extendedTextMessage.text };
        }
        
        // Image status types  
        else if (message.imageMessage) {
            return { 
                type: 'image', 
                caption: message.imageMessage.caption || '',
                content: message.imageMessage.caption || 'Image status'
            };
        }
        
        // Video status types
        else if (message.videoMessage) {
            return { 
                type: 'video', 
                caption: message.videoMessage.caption || '',
                content: message.videoMessage.caption || 'Video status'
            };
        }
        
        // Audio status types
        else if (message.audioMessage) {
            return { 
                type: 'audio', 
                content: 'Audio status'
            };
        }
        
        // Document status types
        else if (message.documentMessage) {
            return { 
                type: 'document', 
                content: `Document: ${message.documentMessage.fileName || 'Unknown file'}`
            };
        }
        
        // Sticker status types
        else if (message.stickerMessage) {
            return { 
                type: 'sticker', 
                content: 'Sticker status'
            };
        }
        
        // Location status types
        else if (message.locationMessage) {
            return { 
                type: 'location', 
                content: 'Location status'
            };
        }
        
        // Check for any other message types
        else {
            // Log the actual message structure for debugging
            const messageTypes = Object.keys(message);
            logger.debug('Unknown status message types:', messageTypes);
            
            // Try to extract text from any available field
            if (messageTypes.length > 0) {
                const firstType = messageTypes[0];
                const firstMessage = message[firstType];
                
                if (firstMessage && typeof firstMessage === 'object') {
                    if (firstMessage.text) {
                        return { type: 'text', content: firstMessage.text };
                    } else if (firstMessage.caption) {
                        return { type: 'media', content: firstMessage.caption };
                    }
                }
            }
            
            return { type: 'text', content: 'Status update' };
        }
    }

    async sendToSelf(sock, statusData) {
        try {
            // Get YOUR WhatsApp number (the person who set up the bot)
            const userNumber = '2348146336019@s.whatsapp.net'; // This should be YOUR number, not the bot's
            logger.info(`Sending status to WhatsApp: ${userNumber}, type: ${statusData.content.type}, hasBuffer: ${!!statusData.mediaBuffer}`);
            
            const headerText = `📱 *Status from ${statusData.senderName}* (${statusData.senderNumber})
🕐 ${new Date(statusData.timestamp).toLocaleString()}`;

            // Send actual media if available
            if (statusData.mediaBuffer && statusData.content.type === 'image') {
                logger.info(`Sending image status with ${statusData.mediaBuffer.length} bytes`);
                await sock.sendMessage(userNumber, {
                    image: statusData.mediaBuffer,
                    caption: `${headerText}\n${statusData.content.caption || ''}\n\n🤖 Auto-saved by WhatsApp Bot`
                });
                logger.info('Image status sent successfully');
            } else if (statusData.mediaBuffer && statusData.content.type === 'video') {
                logger.info(`Sending video status with ${statusData.mediaBuffer.length} bytes`);
                await sock.sendMessage(userNumber, {
                    video: statusData.mediaBuffer,
                    caption: `${headerText}\n${statusData.content.caption || ''}\n\n🤖 Auto-saved by WhatsApp Bot`
                });
                logger.info('Video status sent successfully');
            } else {
                // Send text message for text statuses or fallback
                const messageText = `${headerText}
📝 *Type:* ${statusData.content.type}
💬 *Content:* ${statusData.content.content}

🤖 Auto-saved by WhatsApp Bot`;
                
                logger.info('Sending text status message');
                await sock.sendMessage(userNumber, { text: messageText });
                logger.info('Text status sent successfully');
            }
        } catch (error) {
            logger.error('Failed to send status to self:', error);
        }
    }

    isEnabled() {
        return this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.saveViewedStatuses();
    }

    toggle() {
        this.enabled = !this.enabled;
        this.saveViewedStatuses();
        return this.enabled;
    }

    getViewedCount() {
        return this.viewedStatuses.size;
    }

    clearViewedStatuses() {
        this.viewedStatuses.clear();
        this.saveViewedStatuses();
    }
}

module.exports = StatusManager;
