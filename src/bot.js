const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, makeInMemoryStore } = require('@whiskeysockets/baileys');
const readline = require('readline');
const fs = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');
const logger = require('./utils/logger');
const ContactStorage = require('./storage/contacts');
const StatusManager = require('./storage/status');
const Commands = require('./commands');

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.store = null;
        this.contacts = new ContactStorage();
        this.status = new StatusManager();
        this.commands = new Commands(this.contacts, this.status);
        this.settings = {
            autoStatusView: true
        };
        this.loadSettings();
    }

    async start() {
        try {
            console.log('\n🤖 WhatsApp Bot - QR Code Mode');
            console.log('════════════════════════════════════════');

            // Create auth state
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            
            // Check if logger supports child() method and makeInMemoryStore is available
            const supportsChild = typeof logger.child === 'function';
            const baileysLogger = supportsChild ? logger.child({ module: 'baileys' }) : undefined;
            const storeLogger = supportsChild ? logger.child({ module: 'store' }) : undefined;
            const canMakeStore = typeof makeInMemoryStore === 'function';

            // Create in-memory store for local contact caching (if available)
            if (canMakeStore) {
                this.store = makeInMemoryStore({ 
                    logger: storeLogger 
                });
            } else {
                logger.warn('Baileys makeInMemoryStore unavailable; skipping local cache');
            }

            // Create socket connection with QR code mode
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false, // We'll handle QR ourselves
                browser: ['WhatsApp Bot', 'Desktop', '1.0.0'],
                logger: baileysLogger,
                syncFullHistory: false
            });

            // Bind store to socket events for local contact caching (if store available)
            if (this.store) {
                this.store.bind(this.sock.ev);
                this.sock.store = this.store; // Make store accessible from sock
            }

            // Handle credentials update
            this.sock.ev.on('creds.update', saveCreds);

            // Handle connection updates
            this.sock.ev.on('connection.update', (update) => {
                this.handleConnectionUpdate(update);
            });

            // Handle messages
            this.sock.ev.on('messages.upsert', (m) => {
                this.handleMessages(m);
            });

            // Handle status updates
            this.sock.ev.on('messages.upsert', (m) => {
                this.handleStatusUpdates(m);
            });

            logger.info('Bot initialized successfully');
        } catch (error) {
            logger.error('Failed to start bot:', { 
                error: error.message, 
                stack: error.stack 
            });
            throw error;
        }
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        
        if (qr) {
            await this.generateQRCode(qr);
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.info('Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => this.start(), 3000);
            }
        } else if (connection === 'open') {
            if (isNewLogin) {
                console.log('\n✅ Successfully linked to WhatsApp!');
            }
            logger.info('✅ WhatsApp connection opened successfully!');
            this.initializeBot();
        } else if (connection === 'connecting') {
            logger.info('🔗 Connecting to WhatsApp...');
        }
    }

    async generateQRCode(qr) {
        try {
            const qrPath = path.join(process.cwd(), 'whatsapp-qr.png');
            
            // Generate QR code as PNG file
            await QRCode.toFile(qrPath, qr, {
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                width: 512
            });
            
            console.log('\n📱 QR CODE READY!');
            console.log('════════════════════════════════════════');
            console.log(`🖼️  QR Code saved to: whatsapp-qr.png`);
            console.log('📋 Steps to link your WhatsApp:');
            console.log('1. Open the QR code file: whatsapp-qr.png');
            console.log('2. Open WhatsApp on your phone');
            console.log('3. Go to Settings > Linked Devices');
            console.log('4. Tap "Link a Device"');
            console.log('5. Scan the QR code from the PNG file');
            console.log('════════════════════════════════════════');
            console.log('⏳ Waiting for you to scan the QR code...\n');
            
        } catch (error) {
            logger.error('Failed to generate QR code:', error);
            console.log('❌ Failed to generate QR code file');
        }
    }



    async initializeBot() {
        try {
            // Get bot's own number
            const botNumber = this.sock.user.id.split(':')[0];
            logger.info(`Bot number: ${botNumber}`);
            
            // Load existing contacts
            await this.contacts.load();
            logger.info(`Loaded ${this.contacts.getCount()} contacts from storage`);
            
        } catch (error) {
            logger.error('Failed to initialize bot:', error);
        }
    }

    async handleMessages(m) {
        try {
            const message = m.messages[0];
            if (!message.message || message.key.fromMe) return;

            // Skip status messages - they're handled by handleStatusUpdates
            if (message.key.remoteJid === 'status@broadcast') {
                return;
            }

            const messageText = this.extractMessageText(message);
            const remoteJid = message.key.remoteJid;
            const isGroup = remoteJid.includes('@g.us');
            
            // Safely extract sender number - handle LID identifiers
            let senderNumber = null;
            if (isGroup) {
                if (message.key.participant && message.key.participant.includes('@')) {
                    senderNumber = message.key.participant.split('@')[0];
                }
            } else {
                if (remoteJid && remoteJid.includes('@')) {
                    senderNumber = remoteJid.split('@')[0];
                }
            }
            
            logger.info(`📨 Message received from ${remoteJid}, sender: ${senderNumber || 'unknown'}, isGroup: ${isGroup}, text: "${messageText}"`);
            
            // Skip if we can't identify the sender number (LID users)
            if (!senderNumber) {
                logger.debug('Skipping message from LID user (no phone number available)');
                return;
            }

            // Handle unsaved contacts
            if (!isGroup && !this.contacts.exists(senderNumber)) {
                await this.handleUnsavedContact(message, senderNumber);
            }

            // Handle commands
            if (messageText && messageText.startsWith('.')) {
                await this.handleCommand(message, messageText, isGroup);
            }
        } catch (error) {
            logger.error('Failed to handle message:', error);
        }
    }

    async handleUnsavedContact(message, senderNumber) {
        try {
            // Get contact info
            const contactInfo = await this.getContactInfo(message.key.remoteJid);
            const contactName = contactInfo?.name || contactInfo?.pushName || 'Unknown';
            
            // Save contact
            await this.contacts.addContact({
                number: senderNumber,
                name: contactName,
                addedDate: new Date().toISOString(),
                source: 'auto_message'
            });

            logger.info(`Auto-saved new contact: ${contactName} (${senderNumber})`);
        } catch (error) {
            logger.error('Failed to save unsaved contact:', error);
        }
    }

    async handleCommand(message, messageText, isGroup) {
        const command = messageText.toLowerCase().trim();
        const remoteJid = message.key.remoteJid;
        
        logger.info(`🔧 Command received: "${command}" from ${remoteJid}, isGroup: ${isGroup}`);

        try {
            let response = '';

            switch (command) {
                case '.menu':
                    response = this.commands.getMenu();
                    break;

                case '.getcontacts':
                    if (!isGroup) {
                        response = '📝 *Contact Extraction*\n\nℹ️ This command works best in groups to extract member contacts.\n\nIn private chats, you can:\n• Use .contacts to view saved contacts\n• Use .sendcontact <number> to send contact cards\n• Join a group and use .getcontacts there';
                        break;
                    }
                    response = await this.commands.getGroupContacts(this.sock, remoteJid);
                    break;

                case '.contacts':
                    const contactResult = await this.commands.listContacts(this.sock, remoteJid);
                    if (contactResult.type === 'file_sent') {
                        // File was sent successfully, no need to send another message
                        return;
                    } else {
                        response = contactResult.content;
                    }
                    break;

                case '.status':
                    response = this.commands.toggleStatus(this.settings);
                    this.saveSettings();
                    break;


                case '.userjid':
                    if (!isGroup) {
                        response = `🆔 *Your JID Information*\n\n📱 *Your WhatsApp ID:* ${remoteJid}\n\nℹ️ In groups, this command shows all member JIDs.\nJoin a group and use .userjid there to see all members.`;
                        break;
                    }
                    response = await this.commands.getUserJids(this.sock, remoteJid, this.isOwner(message));
                    break;

                default:
                    // Handle more complex commands with parameters
                    if (command.startsWith('.pushcontact')) {
                        if (!isGroup) {
                            response = '📤 *Push Contact*\n\nℹ️ This command sends messages to all group members.\n\nIn private chats, you can:\n• Use .sendcontact <number> to send contact cards\n• Use .pushcontactv2 <groupId>|<message> to message specific groups\n• Join a group and use .pushcontact there';
                        } else {
                            const pushMessage = messageText.replace('.pushcontact', '').trim();
                            response = await this.commands.pushContact(this.sock, remoteJid, pushMessage, this.isOwner(message));
                        }
                    } else if (command.startsWith('.pushcontactv2')) {
                        const params = messageText.replace('.pushcontactv2', '').trim();
                        response = await this.commands.pushContactV2(this.sock, params, this.isOwner(message));
                    } else if (command.startsWith('.sendcontact')) {
                        const phoneParam = messageText.replace('.sendcontact', '').trim();
                        if (!phoneParam) {
                            response = '❌ Please provide a phone number!\n\nUsage: .sendcontact <phone_number>';
                        } else {
                            const numbers = [phoneParam.includes('+') ? phoneParam : '+' + phoneParam];
                            response = await this.sendContact(remoteJid, numbers);
                        }
                    } else {
                        response = '❌ Unknown command. Type .menu to see available commands.';
                    }
            }

            if (response) {
                await this.sock.sendMessage(remoteJid, { text: response });
            }
        } catch (error) {
            logger.error('Failed to handle command:', error);
            await this.sock.sendMessage(remoteJid, { 
                text: '❌ An error occurred while processing your command.' 
            });
        }
    }

    async handleStatusUpdates(m) {
        if (!this.settings.autoStatusView) return;

        const message = m.messages[0];
        if (!message.message || message.key.fromMe) return;

        // Check if it's a status update
        if (message.key.remoteJid === 'status@broadcast') {
            try {
                await this.status.viewAndSaveStatus(this.sock, message);
            } catch (error) {
                logger.error('Failed to handle status update:', error);
            }
        }
    }

    // CheemsBot-style contact functions
    async sendContact(jid, contactNumbers, quoted = '') {
        try {
            let list = [];
            for (let number of contactNumbers) {
                const contactName = await this.getName(number);
                list.push({
                    displayName: contactName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${contactName}
FN:${contactName}
item1.TEL;waid=${number.replace('+', '')}:${number}
item1.X-ABLabel:Click here to chat
item2.EMAIL;type=INTERNET:WhatsApp Bot
item2.X-ABLabel:Bot Email
item3.URL:https://github.com/yourusername
item3.X-ABLabel:GitHub
item4.ADR:;;Your Location;;;;
item4.X-ABLabel:Region
END:VCARD`
                });
            }
            
            await this.sock.sendMessage(jid, { 
                contacts: { 
                    displayName: `${list.length} Contact${list.length > 1 ? 's' : ''}`, 
                    contacts: list 
                } 
            }, { quoted });
            
            return `✅ Sent ${list.length} contact${list.length > 1 ? 's' : ''} successfully!`;
        } catch (error) {
            logger.error('Failed to send contact:', error);
            return '❌ Failed to send contact.';
        }
    }

    async getName(jid) {
        try {
            // Clean phone number - remove + prefix and non-digits
            let cleanNumber = jid;
            if (typeof jid === 'string') {
                if (jid.includes('@')) {
                    cleanNumber = jid.split('@')[0];
                } else {
                    // Remove + and any non-digits
                    cleanNumber = jid.replace(/[^\d]/g, '');
                }
            }

            // Build proper WhatsApp ID
            const id = cleanNumber + '@s.whatsapp.net';
            
            // Try store contacts first
            if (this.store?.contacts?.[id]?.name) {
                return this.store.contacts[id].name;
            }
            
            if (this.store?.contacts?.[id]?.notify) {
                return this.store.contacts[id].notify;
            }

            // Try built-in contacts
            if (this.sock.contacts?.[id]?.name) {
                return this.sock.contacts[id].name;
            }

            if (this.sock.contacts?.[id]?.notify) {
                return this.sock.contacts[id].notify;
            }

            // Try using Baileys getName if available
            if (this.sock.getName) {
                try {
                    const baileyName = await this.sock.getName(id);
                    if (baileyName && baileyName !== id && !baileyName.includes('@')) {
                        return baileyName;
                    }
                } catch (err) {
                    logger.debug('Baileys getName failed for:', id);
                }
            }

            // Create meaningful fallback names based on country code
            if (cleanNumber.startsWith('234')) {
                return `Nigerian_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith('1')) {
                return `US_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith('44')) {
                return `UK_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith('91')) {
                return `India_${cleanNumber.slice(-4)}`;
            } else {
                // Use the clean number itself as fallback
                return `+${cleanNumber}`;
            }
        } catch (error) {
            logger.error('Failed to get name:', error);
            // Final fallback - return the clean number
            const fallback = typeof jid === 'string' ? jid.replace(/[^\d]/g, '') : String(jid);
            return `+${fallback}`;
        }
    }

    async getContactInfo(jid) {
        try {
            const contact = await this.sock.onWhatsApp(jid);
            return contact[0] || null;
        } catch (error) {
            logger.error('Failed to get contact info:', error);
            return null;
        }
    }

    extractMessageText(message) {
        return message.message.conversation || 
               message.message.extendedTextMessage?.text || 
               '';
    }

    isOwner(message) {
        logger.info('🔍 CheemsBot-style owner check called!');
        try {
            // Get bot number
            const botNumber = this.sock.user?.id ? this.sock.user.id.split(':')[0] : null;
            
            // Load owner and premium lists (CheemsBot style)
            const fs = require('fs');
            const path = require('path');
            
            let owner = [];
            let prem = [];
            
            try {
                const ownerPath = path.join(__dirname, '../database/owner.json');
                const premPath = path.join(__dirname, '../database/premium.json');
                
                if (fs.existsSync(ownerPath)) {
                    owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
                }
                if (fs.existsSync(premPath)) {
                    prem = JSON.parse(fs.readFileSync(premPath, 'utf8'));
                }
                
                logger.info(`📚 Loaded owners: ${JSON.stringify(owner)}`);
                logger.info(`💎 Loaded premium: ${JSON.stringify(prem)}`);
            } catch (error) {
                logger.error('Failed to load owner/premium files:', error);
                // Fallback to hardcoded values
                owner = ['2348146336019'];
                prem = ['2348146336019@s.whatsapp.net'];
            }

            // Get sender (CheemsBot style)
            const sender = message.key.remoteJid.includes('@g.us') 
                ? (message.key.participant || message.key.remoteJid)
                : message.key.remoteJid;
                
            logger.info(`👤 Sender: ${sender}`);

            // CheemsBot owner verification method
            const ownerList = botNumber ? [botNumber, ...owner] : owner;
            const XeonTheCreator = ownerList
                .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
                .includes(sender);
                
            const isPrem = prem.includes(sender);
            
            logger.info(`🔑 Owner list formatted: ${JSON.stringify(ownerList.map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net'))}`);
            logger.info(`✅ OWNER CHECK: ${XeonTheCreator}`);
            logger.info(`💎 PREMIUM CHECK: ${isPrem}`);
            
            // Return true if either owner or premium
            return XeonTheCreator || isPrem;
            
        } catch (error) {
            logger.error('❌ CheemsBot owner check failed:', error);
            return false;
        }
    }

    looksLikeLid(number) {
        // LIDs are typically 13-15 digits and don't match common country codes
        const cleaned = number.replace(/[^\d]/g, '');
        if (cleaned.length < 13 || cleaned.length > 15) {
            return false;
        }
        
        // Basic check - if it starts with common country codes, it's likely a phone
        const commonPrefixes = ['1', '44', '49', '33', '39', '81', '86', '91', '234', '27', '55', '52', '61', '7', '90', '82'];
        const matchesCountryCode = commonPrefixes.some(prefix => cleaned.startsWith(prefix));
        
        return !matchesCountryCode;
    }

    checkLidMapping(lidNumber, ownerNumber) {
        try {
            const authDir = path.join(__dirname, '../auth_info_baileys');
            
            // Try reverse mapping first: lid-mapping-<LID>_reverse.json
            const reverseFile = path.join(authDir, `lid-mapping-${lidNumber}_reverse.json`);
            if (fs.existsSync(reverseFile)) {
                const reverseData = fs.readJsonSync(reverseFile);
                // The reverse file contains just the phone number as a string
                const phoneFromMapping = String(reverseData).replace(/[^\d]/g, '');
                if (phoneFromMapping === ownerNumber) {
                    logger.debug(`LID ${lidNumber} mapped to owner phone via reverse mapping`);
                    return true;
                }
            }
            
            // Try forward mapping: lid-mapping-<ownerNumber>.json
            const forwardFile = path.join(authDir, `lid-mapping-${ownerNumber}.json`);
            if (fs.existsSync(forwardFile)) {
                const forwardData = fs.readJsonSync(forwardFile);
                // Check if this LID is in the owner's mapped LIDs
                if (Array.isArray(forwardData) && forwardData.includes(lidNumber)) {
                    logger.debug(`LID ${lidNumber} found in owner's forward mapping`);
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            logger.error('Failed to check LID mapping:', error);
            return false;
        }
    }

    loadSettings() {
        try {
            const settingsPath = path.join(__dirname, '../data/settings.json');
            if (fs.existsSync(settingsPath)) {
                const data = fs.readJsonSync(settingsPath);
                this.settings = { ...this.settings, ...data };
            }
        } catch (error) {
            logger.error('Failed to load settings:', error);
        }
    }

    saveSettings() {
        try {
            const settingsPath = path.join(__dirname, '../data/settings.json');
            fs.ensureDirSync(path.dirname(settingsPath));
            fs.writeJsonSync(settingsPath, this.settings, { spaces: 2 });
        } catch (error) {
            logger.error('Failed to save settings:', error);
        }
    }
}

module.exports = WhatsAppBot;
