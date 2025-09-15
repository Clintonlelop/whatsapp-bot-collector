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

            // Mark as viewed
            this.viewedStatuses.add(statusId);
            await this.saveViewedStatuses();

            // Get sender info
            const senderInfo = await this.getSenderInfo(sock, statusMessage.key.participant);
            const senderName = senderInfo?.name || senderInfo?.pushName || senderNumber;

            // Extract status content
            const statusContent = this.extractStatusContent(statusMessage);
            
            // Send to "Message Yourself"
            await this.sendToSelf(sock, {
                senderName,
                senderNumber,
                content: statusContent,
                timestamp: new Date().toISOString()
            });

            logger.info(`Viewed and saved status from: ${senderName} (${senderNumber})`);
        } catch (error) {
            logger.error('Failed to view and save status:', error);
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
        
        if (message.conversation) {
            return { type: 'text', content: message.conversation };
        } else if (message.extendedTextMessage) {
            return { type: 'text', content: message.extendedTextMessage.text };
        } else if (message.imageMessage) {
            return { 
                type: 'image', 
                caption: message.imageMessage.caption || 'Image status',
                content: 'Image status shared'
            };
        } else if (message.videoMessage) {
            return { 
                type: 'video', 
                caption: message.videoMessage.caption || 'Video status',
                content: 'Video status shared'
            };
        } else {
            return { type: 'unknown', content: 'Status update (unsupported type)' };
        }
    }

    async sendToSelf(sock, statusData) {
        try {
            // Get bot's own number
            const botNumber = sock.user.id;
            
            const messageText = `📱 *WhatsApp Status Update*

👤 *From:* ${statusData.senderName}
📞 *Number:* ${statusData.senderNumber}
🕐 *Time:* ${new Date(statusData.timestamp).toLocaleString()}
📝 *Type:* ${statusData.content.type}

${statusData.content.caption ? `📄 *Caption:* ${statusData.content.caption}\n` : ''}💬 *Content:* ${statusData.content.content}

---
🤖 Auto-saved by WhatsApp Bot`;

            await sock.sendMessage(botNumber, { text: messageText });
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
