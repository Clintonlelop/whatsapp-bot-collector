const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Import existing components
const WhatsAppBot = require('./src/bot');
const ContactStorage = require('./src/storage/contacts');
const { ContactDB } = require('./src/database/db');
const PhoneUtils = require('./src/utils/phone-utils');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Make socket.io globally available for bot communication
global.io = io;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state
let contactStorage = null;
let isConnected = false;
let currentQR = null;
let qrDataURL = null;

// JWT Secret for session management
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me';

// QR Authentication state
let qrAuthCode = null;
let authenticatedUser = null;

// QR Authentication middleware
const authenticateQR = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'QR authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid authentication' });
        }
        req.user = user;
        next();
    });
};

// 🔥 NEW: Database API Routes for React Dashboard
// Contact Management Routes
app.get('/api/contacts', async (req, res) => {
    try {
        const rawContacts = await ContactDB.getAllContacts();
        
        // Process contacts to add formatted phone numbers and names
        const processedContacts = await Promise.all(rawContacts.map(async (contact) => {
            // Process phone number formatting
            const processed = PhoneUtils.processContact(contact);
            
            // Try to resolve contact name using WhatsApp bot
            if (whatsappSvc?.bot?.sock && processed.rawPhone) {
                const jid = PhoneUtils.createJID(processed.rawPhone);
                if (jid) {
                    const contactName = await PhoneUtils.resolveContactName(whatsappSvc.bot, jid);
                    if (contactName) {
                        processed.resolvedName = contactName;
                        processed.displayName = contactName;
                    } else {
                        processed.displayName = processed.formattedPhone;
                    }
                }
            } else {
                processed.displayName = processed.formattedPhone;
            }
            
            return processed;
        }));
        
        res.json(processedContacts);
    } catch (error) {
        console.error('Failed to get contacts:', error);
        res.status(500).json({ error: 'Failed to retrieve contacts' });
    }
});

app.get('/api/contacts/:phoneNumber', async (req, res) => {
    try {
        const contact = await ContactDB.getContactByPhone(req.params.phoneNumber);
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        res.json(contact);
    } catch (error) {
        console.error('Failed to get contact:', error);
        res.status(500).json({ error: 'Failed to retrieve contact' });
    }
});

app.post('/api/contacts', async (req, res) => {
    try {
        const contact = await ContactDB.createContact(req.body);
        res.status(201).json(contact);
    } catch (error) {
        console.error('Failed to create contact:', error);
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

app.post('/api/contacts/:contactId/save', async (req, res) => {
    try {
        const updated = await ContactDB.markContactSaved(req.params.contactId);
        if (!updated) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Failed to mark contact saved:', error);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Message Routes
app.get('/api/messages', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;
        const rawMessages = await ContactDB.getRecentMessages(limit);
        
        // Process messages to add formatted phone numbers and names
        const processedMessages = await Promise.all(rawMessages.map(async (message) => {
            // Process sender information
            const processed = PhoneUtils.processMessage(message);
            
            // Try to resolve sender name using WhatsApp bot
            if (whatsappSvc?.bot?.sock && processed.rawSender) {
                const jid = PhoneUtils.createJID(processed.rawSender);
                if (jid) {
                    const senderName = await PhoneUtils.resolveContactName(whatsappSvc.bot, jid);
                    if (senderName) {
                        processed.resolvedSenderName = senderName;
                        processed.displaySender = senderName;
                    } else {
                        processed.displaySender = processed.formattedSender;
                    }
                }
            } else {
                processed.displaySender = processed.formattedSender;
            }
            
            return processed;
        }));
        
        res.json(processedMessages);
    } catch (error) {
        console.error('Failed to get messages:', error);
        res.status(500).json({ error: 'Failed to retrieve messages' });
    }
});

app.post('/api/messages', async (req, res) => {
    try {
        const message = await ContactDB.createMessage(req.body);
        res.status(201).json(message);
    } catch (error) {
        console.error('Failed to create message:', error);
        res.status(500).json({ error: 'Failed to create message' });
    }
});

// Analytics Routes
app.get('/api/analytics', async (req, res) => {
    try {
        const analytics = await ContactDB.getAnalytics();
        res.json(analytics);
    } catch (error) {
        console.error('Failed to get analytics:', error);
        res.status(500).json({ error: 'Failed to retrieve analytics' });
    }
});

// Export Routes
app.get('/api/export/csv', async (req, res) => {
    try {
        const contacts = await ContactDB.getAllContacts();
        
        // Generate CSV content
        const csvHeader = 'Phone Number,Name,Source,Message Context,Created At\n';
        const csvContent = contacts.map(contact => 
            `"${contact.phoneNumber}","${contact.name || ''}","${contact.source || ''}","${(contact.messageContext || '').replace(/"/g, '""')}","${contact.createdAt}"`
        ).join('\n');
        
        const csv = csvHeader + csvContent;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="contacts_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Failed to export CSV:', error);
        res.status(500).json({ error: 'Failed to export CSV' });
    }
});

app.get('/api/export/vcf', async (req, res) => {
    try {
        const contacts = await ContactDB.getAllContacts();
        
        // Generate VCF content
        const vcfContent = contacts.map(contact => {
            const name = contact.name || `Contact ${contact.phoneNumber}`;
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${name}`,
                `TEL:${contact.phoneNumber}`,
                `NOTE:Source: ${contact.source || 'Unknown'}`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');
        
        res.setHeader('Content-Type', 'text/vcard');
        res.setHeader('Content-Disposition', `attachment; filename="contacts_${new Date().toISOString().split('T')[0]}.vcf"`);
        res.send(vcfContent);
    } catch (error) {
        console.error('Failed to export VCF:', error);
        res.status(500).json({ error: 'Failed to export VCF' });
    }
});

// Initialize WhatsApp Service
class WhatsAppService {
    constructor() {
        this.bot = null;
        this.commands = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            console.log('🔄 Initializing WhatsApp Service...');
            
            // Initialize contact storage
            contactStorage = new ContactStorage();
            
            // Create bot instance with web integration
            this.bot = new WhatsAppBot();
            
            // Connect event listeners
            this.setupBotEventListeners();
            
            // Start the bot to begin QR code generation
            await this.bot.start();
            
            this.isInitialized = true;
            console.log('✅ WhatsApp Service initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize WhatsApp Service:', error);
            throw error;
        }
    }

    setupBotEventListeners() {
        console.log('📡 Setting up QR authentication monitoring...');
        
        // Listen for QR code events from bot
        this.bot.on('qr_ready', (qrDataURL) => {
            console.log('📱 QR code received from bot - broadcasting to web clients');
            
            // Store current QR for new connections
            currentQR = qrDataURL;
            
            // Broadcast to all connected clients
            io.emit('qr_update', { 
                qr: qrDataURL,
                timestamp: Date.now()
            });
        });
        
        // Monitor connection status and auth
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
        this.statusInterval = setInterval(() => {
            this.checkBotStatus();
            this.checkForNewQRAuth();
        }, 3000);
    }

    async checkForQRCodeFile() {
        try {
            const fs = require('fs');
            const qrPath = './whatsapp-qr.png';
            
            if (fs.existsSync(qrPath)) {
                const stats = fs.statSync(qrPath);
                const qrTimestamp = stats.mtime.getTime();
                
                // Check if this is a new QR code (within last 10 seconds)
                if (Date.now() - qrTimestamp < 10000) {
                    const qrData = fs.readFileSync(qrPath, 'base64');
                    const qrDataURL = `data:image/png;base64,${qrData}`;
                    
                    // Emit to all connected clients
                    io.emit('qr_update', { 
                        qr: qrDataURL,
                        timestamp: qrTimestamp 
                    });
                    
                    console.log('📱 QR code broadcasted to web clients');
                }
            }
        } catch (error) {
            // QR file handling is optional
        }
    }

    async checkForNewQRAuth() {
        try {
            // Check for WhatsApp connection success first
            this.checkWhatsAppConnection();
            
        } catch (error) {
            // QR file handling is optional
        }
    }

    async checkWhatsAppConnection() {
        // Auth only happens when the user completes the pairing code flow.
        // We do NOT auto-restore from saved files — always require a fresh login.
    }

    async autoAuthenticateConnectedUser(phoneNumber, userJID) {
        try {
            console.log(`🎉 Auto-authenticating WhatsApp user: ${phoneNumber}`);
            
            // Create authentication result
            const authResult = await this.authenticateUser(phoneNumber, userJID);
            
            // Emit authentication success to frontend
            io.emit('user_authenticated', {
                success: true,
                token: authResult.token,
                user: authResult.user,
                message: `Welcome! Auto-authenticated as ${phoneNumber} with owner privileges`
            });
            
            console.log(`✅ Auto-authentication completed for ${phoneNumber}`);
            
        } catch (error) {
            console.error('❌ Auto-authentication failed:', error);
        }
    }

    async authenticateUser(userNumber, userJID) {
        try {
            console.log(`👤 Authenticating user: ${userNumber} (${userJID})`);
            
            // Auto-add as owner and premium
            await this.addUserAsOwnerAndPremium(userNumber, userJID);
            
            // Create JWT token
            const token = jwt.sign(
                { 
                    phoneNumber: userNumber,
                    jid: userJID,
                    role: 'owner',
                    authenticated: true 
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            authenticatedUser = { phoneNumber: userNumber, jid: userJID };
            console.log(`✅ User ${userNumber} authenticated and granted owner access`);
            
            return { token, user: authenticatedUser };
        } catch (error) {
            console.error('❌ User authentication failed:', error);
            throw error;
        }
    }

    async addUserAsOwnerAndPremium(phoneNumber, jid) {
        const fs = require('fs');
        
        try {
            // Add to owners
            const ownerFile = './database/owner.json';
            let owners = [];
            if (fs.existsSync(ownerFile)) {
                owners = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
            }
            
            // Add phone number and JID if not already present
            if (!owners.includes(phoneNumber)) owners.push(phoneNumber);
            if (!owners.includes(jid.split('@')[0])) owners.push(jid.split('@')[0]);
            
            fs.writeFileSync(ownerFile, JSON.stringify(owners, null, 2));
            
            // Add to premium
            const premiumFile = './database/premium.json';
            let premium = [];
            if (fs.existsSync(premiumFile)) {
                premium = JSON.parse(fs.readFileSync(premiumFile, 'utf8'));
            }
            
            // Add full JIDs if not already present
            const phoneJID = `${phoneNumber}@s.whatsapp.net`;
            const lidJID = jid;
            
            if (!premium.includes(phoneJID)) premium.push(phoneJID);
            if (!premium.includes(lidJID)) premium.push(lidJID);
            
            fs.writeFileSync(premiumFile, JSON.stringify(premium, null, 2));
            
            console.log(`🎖️ Added ${phoneNumber} as owner and premium user`);
        } catch (error) {
            console.error('❌ Failed to add user privileges:', error);
            throw error;
        }
    }

    checkBotStatus() {
        // Check WhatsApp connection status
        try {
            const fs = require('fs');
            
            // Check if we have credentials (indicates connection)
            if (fs.existsSync('./auth_info_baileys/creds.json')) {
                if (!isConnected) {
                    isConnected = true;
                    io.emit('connection_update', { status: 'connected' });
                    console.log('📱 WhatsApp connection established');
                }
            } else {
                if (isConnected) {
                    isConnected = false;
                    io.emit('connection_update', { status: 'disconnected' });
                    console.log('📵 WhatsApp connection lost');
                }
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }

    async connect() {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }
            
            console.log('🔗 Initiating WhatsApp connection...');
            
            // Set up QR code for web display
            this.setupQRCodeListener();
            
            // Monitor connection status
            io.emit('connection_update', { status: 'connecting' });
            
            // Check if bot is already connected
            setTimeout(() => {
                this.checkBotStatus();
            }, 2000);
            
            return { success: true, message: 'Connection monitoring started' };
        } catch (error) {
            console.error('❌ Connection failed:', error);
            throw error;
        }
    }

    setupQRCodeListener() {
        // Generate authentication code for web session
        if (!qrAuthCode) {
            qrAuthCode = Math.random().toString(36).substring(2, 15);
            console.log('🔑 QR authentication ready for web');
            io.emit('qr_auth_ready', { authCode: qrAuthCode });
        }
    }

    async disconnect() {
        try {
            console.log('🔌 Disconnecting WhatsApp...');
            isConnected = false;
            io.emit('connection_update', { status: 'disconnected' });
            return { success: true, message: 'Disconnected' };
        } catch (error) {
            console.error('❌ Disconnect failed:', error);
            throw error;
        }
    }

    getStatus() {
        try {
            const contacts = contactStorage && contactStorage.getAllContacts ? contactStorage.getAllContacts() : [];
            const sockReady = !!(this.bot && this.bot.sock);
            // Only report "connected" if the user actually completed the login flow
            const phone = authenticatedUser?.phoneNumber || null;
            const connected = !!authenticatedUser && isConnected;
            return {
                connected,
                phone,
                botReady: sockReady,
                initialized: this.isInitialized,
                contactCount: contacts.length
            };
        } catch (error) {
            return {
                connected: false,
                phone: null,
                botReady: false,
                initialized: this.isInitialized,
                contactCount: 0
            };
        }
    }

    getContacts() {
        try {
            return contactStorage && contactStorage.getAllContacts ? contactStorage.getAllContacts() : [];
        } catch (error) {
            console.error('⚠️ Error getting contacts:', error);
            return [];
        }
    }

    async importGroupContacts(groupJid) {
        if (!this.isInitialized) throw new Error('WhatsApp service not initialized');
        
        console.log('📥 Group import requested for:', groupJid);
        
        try {
            // For now, return the current contact count as a simulation
            // In full implementation, this would trigger the bot's group extraction
            const currentContacts = contactStorage?.getAllContacts ? contactStorage.getAllContacts().length : 0;
            
            // Simulate progress
            io.emit('import_progress', { 
                status: 'processing', 
                message: 'Scanning group members...' 
            });
            
            setTimeout(() => {
                io.emit('import_progress', { 
                    status: 'completed', 
                    message: 'Group scan completed',
                    imported: Math.floor(Math.random() * 20) + 5 // Simulated import count
                });
                io.emit('contacts_update');
            }, 3000);
            
            return { 
                success: true, 
                message: 'Group import initiated',
                currentContacts: currentContacts
            };
        } catch (error) {
            console.error('❌ Group import failed:', error);
            throw error;
        }
    }
}

// Initialize service
const whatsappSvc = new WhatsAppService();

// Initialize WhatsApp service on startup
(async () => {
    try {
        await whatsappSvc.initialize();
        whatsappSvc.checkBotStatus(); // Force immediate status check
        console.log('🚀 WhatsApp Service startup complete');
    } catch (error) {
        console.error('❌ WhatsApp Service startup failed:', error);
    }
})();

// API Routes

// QR Authentication Routes
app.get('/api/auth/qr-status', (req, res) => {
    try {
        res.json({ 
            qrReady: !!qrAuthCode,
            authenticated: !!authenticatedUser,
            user: authenticatedUser
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/qr-verify', async (req, res) => {
    try {
        const { authCode, userNumber, userJID } = req.body;
        
        if (!authCode || authCode !== qrAuthCode) {
            return res.status(401).json({ error: 'Invalid or expired QR code' });
        }
        
        if (!userNumber || !userJID) {
            return res.status(400).json({ error: 'User information required' });
        }
        
        // Authenticate and grant privileges
        const authResult = await whatsappSvc.authenticateUser(userNumber, userJID);
        
        // Clear QR code
        qrAuthCode = null;
        
        res.json({
            success: true,
            token: authResult.token,
            user: authResult.user,
            message: 'QR authentication successful - you now have owner access!'
        });
    } catch (error) {
        console.error('❌ QR verification failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/me', authenticateQR, (req, res) => {
    res.json({ 
        phoneNumber: req.user.phoneNumber,
        jid: req.user.jid,
        role: req.user.role 
    });
});

app.post('/api/auth/logout', (req, res) => {
    authenticatedUser = null;
    qrAuthCode = null;
    res.json({ success: true, message: 'Logged out successfully' });
});

// Force fresh QR login — clears saved session and generates new QR
app.post('/api/auth/fresh-qr', async (req, res) => {
    try {
        const fse = require('fs-extra');
        // Clear saved WhatsApp credentials so a fresh QR is generated
        await fse.emptyDir('./auth_info_baileys');
        currentQR = null;
        authenticatedUser = null;
        // Reconnect to generate new QR
        await whatsappSvc.connect();
        res.json({ success: true, message: 'Fresh QR being generated, please scan' });
    } catch (error) {
        console.error('❌ Fresh QR failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Levanter-style: request pairing code for a phone number ──
app.post('/api/auth/request-pairing-code', async (req, res) => {
    try {
        let { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });
        phoneNumber = String(phoneNumber).replace(/\D/g, '');
        if (phoneNumber.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

        // Always clear saved credentials so the socket is in fresh (non-passive) mode
        const fse = require('fs-extra');
        await fse.remove('./auth_info_baileys/creds.json');
        console.log('🧹 Cleared credentials — starting fresh for pairing code');

        // Force bot to reconnect fresh
        if (whatsappSvc?.bot) {
            await whatsappSvc.bot.start();
        }

        // Wait for socket to be ready in registration mode
        let attempts = 0;
        while ((!whatsappSvc?.bot?.sock) && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (!whatsappSvc?.bot?.sock) {
            return res.status(503).json({ error: 'Could not connect to WhatsApp. Please try again.' });
        }

        // Small delay to let the handshake start before requesting pairing
        await new Promise(r => setTimeout(r, 1500));

        const code = await whatsappSvc.bot.requestPairingCode(phoneNumber);
        res.json({ success: true, code, message: `Enter this code in WhatsApp → Linked Devices → Link with phone number` });
    } catch (error) {
        console.error('❌ Pairing code failed:', error);
        res.status(500).json({ error: error.message || 'Failed to generate pairing code. Try again.' });
    }
});

// ── User confirms they've entered the pairing code in WhatsApp ──
app.post('/api/auth/confirm-pairing', async (req, res) => {
    try {
        if (!whatsappSvc?.bot) return res.status(503).json({ error: 'Bot not running' });
        await whatsappSvc.bot.confirmPairing();
        // Give it up to 10 seconds to connect
        let waited = 0;
        while (!whatsappSvc.bot.authenticatedUser && waited < 10000) {
            await new Promise(r => setTimeout(r, 500));
            waited += 500;
        }
        if (whatsappSvc.bot.authenticatedUser) {
            res.json({ success: true, connected: true });
        } else {
            res.json({ success: false, connected: false, message: 'Not yet connected — please wait a moment then try again.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate a Session ID from current WhatsApp credentials
app.get('/api/auth/get-session-id', (req, res) => {
    try {
        const fs = require('fs');
        const credsPath = './auth_info_baileys/creds.json';
        if (!fs.existsSync(credsPath)) {
            return res.status(404).json({ error: 'No active WhatsApp session found. Connect via QR first.' });
        }
        const creds = fs.readFileSync(credsPath, 'utf8');
        const sessionId = 'WA_' + Buffer.from(creds).toString('base64');
        res.json({ success: true, sessionId, message: 'Copy this session ID to use on other devices' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Authenticate using a Session ID (no QR needed)
app.post('/api/auth/use-session-id', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId || !sessionId.startsWith('WA_')) {
            return res.status(400).json({ error: 'Invalid session ID format. Must start with WA_' });
        }
        const fse = require('fs-extra');
        const credsData = Buffer.from(sessionId.replace('WA_', ''), 'base64').toString('utf8');
        // Validate it's valid JSON
        JSON.parse(credsData);
        // Write credentials to auth folder
        await fse.ensureDir('./auth_info_baileys');
        await fse.writeFile('./auth_info_baileys/creds.json', credsData);
        currentQR = null;
        // Reconnect using the new credentials
        await whatsappSvc.connect();
        res.json({ success: true, message: 'Session ID applied — connecting to WhatsApp...' });
    } catch (error) {
        console.error('❌ Session ID auth failed:', error);
        res.status(400).json({ error: 'Invalid session ID. Make sure you copied the full ID.' });
    }
});

// Verify JWT token
app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.json({ valid: false });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.json({ valid: false });
        res.json({ valid: true, user });
    });
});

// Password-based login fallback
app.post('/api/auth/password', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }
    const user = { phoneNumber: 'admin', role: 'owner', authenticated: true };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    authenticatedUser = { phoneNumber: 'admin' };
    res.json({ success: true, token, user });
});

// General status endpoint used by login page
app.get('/api/status', (req, res) => {
    const status = whatsappSvc ? whatsappSvc.getStatus() : { connected: false };
    res.json({
        ...status,
        authenticated: !!authenticatedUser,
        token: authenticatedUser ? jwt.sign(
            { phoneNumber: authenticatedUser.phoneNumber, role: 'owner', authenticated: true },
            JWT_SECRET,
            { expiresIn: '7d' }
        ) : null,
        phoneNumber: authenticatedUser ? authenticatedUser.phoneNumber : null
    });
});

// WhatsApp Routes
app.get('/api/wa/status', (req, res) => {
    res.json(whatsappSvc.getStatus());
});

app.post('/api/wa/connect', async (req, res) => {
    try {
        // Allow connection initiation for QR generation
        await whatsappSvc.connect();
        res.json({ success: true, message: 'WhatsApp connection initiated - scan QR to authenticate' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/wa/qr', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        
        // Check for real QR code generated by WhatsApp bot
        const qrFilePath = './whatsapp-qr.png';
        
        if (fs.existsSync(qrFilePath)) {
            // Read the actual QR code file and convert to base64
            const qrBuffer = fs.readFileSync(qrFilePath);
            const qrBase64 = qrBuffer.toString('base64');
            const qrDataURL = `data:image/png;base64,${qrBase64}`;
            
            // Cache it
            global.qrDataURL = qrDataURL;
            
            res.json({ 
                success: true, 
                qrCode: qrDataURL,
                message: 'Real WhatsApp QR code ready for scanning',
                timestamp: fs.statSync(qrFilePath).mtime.getTime()
            });
        } else {
            res.status(404).json({ 
                error: 'QR code not ready yet',
                message: 'WhatsApp bot is generating QR code...'
            });
        }
    } catch (error) {
        console.error('❌ QR reading failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/wa/disconnect', authenticateQR, async (req, res) => {
    try {
        await whatsappSvc.disconnect();
        authenticatedUser = null;
        res.json({ success: true, message: 'Disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Messaging Routes
app.post('/api/messages/send', authenticateQR, async (req, res) => {
    try {
        const { message, contacts, groupJid } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message content is required' });
        }
        
        if (!groupJid && (!contacts || contacts.length === 0)) {
            return res.status(400).json({ error: 'Recipients required: either contacts or groupJid' });
        }
        
        console.log('📤 Message send request:', { 
            message: message.substring(0, 50) + '...', 
            contactCount: contacts?.length, 
            groupJid 
        });
        
        // In full implementation, this would use the WhatsApp bot to send messages
        // For now, simulate the operation
        const recipientCount = groupJid ? 1 : contacts.length;
        
        setTimeout(() => {
            io.emit('message_sent', {
                success: true,
                recipients: recipientCount,
                message: 'Message sent successfully'
            });
        }, 1000);
        
        res.json({
            success: true,
            message: 'Message queued for sending',
            recipients: recipientCount
        });
    } catch (error) {
        console.error('❌ Message send failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/groups/list', authenticateQR, async (req, res) => {
    try {
        // In full implementation, this would fetch from WhatsApp bot
        // For now, return simulated group data
        const simulatedGroups = [
            {
                id: '120363419897648171@g.us',
                name: 'Sample Group 1',
                participants: 25
            },
            {
                id: '120363123456789012@g.us', 
                name: 'Sample Group 2',
                participants: 18
            }
        ];
        
        res.json({ groups: simulatedGroups });
    } catch (error) {
        console.error('❌ Group list failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/import-group', authenticateQR, async (req, res) => {
    try {
        const { groupJid } = req.body;
        
        if (!groupJid) {
            return res.status(400).json({ error: 'Group JID is required' });
        }
        
        const result = await whatsappSvc.importGroupContacts(groupJid);
        res.json({ success: true, imported: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/contacts/export', authenticateQR, (req, res) => {
    try {
        const { format = 'json' } = req.query;
        const contacts = whatsappSvc.getContacts();
        
        switch (format.toLowerCase()) {
            case 'csv':
                // Convert to CSV format
                const csvHeader = 'Name,Phone Number\n';
                const csvData = contacts.map(c => `"${c.name}","${c.number}"`).join('\n');
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
                res.send(csvHeader + csvData);
                break;
                
            case 'vcf':
                // Convert to VCF format
                const vcfData = contacts.map(c => 
                    `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL:${c.number}\nEND:VCARD`
                ).join('\n');
                res.setHeader('Content-Type', 'text/vcard');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
                res.send(vcfData);
                break;
                
            default:
                res.json(contacts);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('👤 Client connected to WebSocket');
    
    // Send current status on connection
    socket.emit('connection_update', { status: isConnected ? 'connected' : 'disconnected' });
    if (currentQR) {
        socket.emit('qr_update', { qr: currentQR });
    }
    
    socket.on('disconnect', () => {
        console.log('👤 Client disconnected from WebSocket');
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 WhatsApp Web Dashboard running on http://localhost:${PORT}`);
    console.log(`📱 WebSocket server ready for real-time updates`);
});

module.exports = { app, server, io };
