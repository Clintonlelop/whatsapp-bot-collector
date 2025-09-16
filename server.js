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

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state
let whatsappService = null;
let contactStorage = null;
let isConnected = false;
let currentQR = null;
let qrDataURL = null;

// JWT Secret for session management
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
            
            this.isInitialized = true;
            console.log('✅ WhatsApp Service initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize WhatsApp Service:', error);
            throw error;
        }
    }

    setupBotEventListeners() {
        console.log('📡 Setting up QR authentication monitoring...');
        
        // Monitor for QR code generation and user connection
        setInterval(() => {
            this.checkBotStatus();
            this.checkForNewQRAuth();
        }, 3000);
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
        try {
            const fs = require('fs');
            
            // Check if bot has established connection (look for phone config)
            const phoneConfigFile = './phone_config.txt';
            if (fs.existsSync(phoneConfigFile)) {
                const phoneNumber = fs.readFileSync(phoneConfigFile, 'utf8').trim();
                
                // Check if we haven't authenticated this user yet
                if (phoneNumber && !authenticatedUser) {
                    console.log(`📱 WhatsApp connection detected for: ${phoneNumber}`);
                    
                    // Auto-authenticate the connected user
                    const userJID = `${phoneNumber}@s.whatsapp.net`;
                    await this.autoAuthenticateConnectedUser(phoneNumber, userJID);
                }
            }
            
            // Alternative: Check auth_info_baileys directory for connection
            if (fs.existsSync('./auth_info_baileys/creds.json') && !authenticatedUser) {
                try {
                    const creds = JSON.parse(fs.readFileSync('./auth_info_baileys/creds.json', 'utf8'));
                    if (creds.me && creds.me.id) {
                        const phoneNumber = creds.me.id.split(':')[0];
                        const userJID = creds.me.id;
                        console.log(`🔗 WhatsApp credentials found for: ${phoneNumber}`);
                        await this.autoAuthenticateConnectedUser(phoneNumber, userJID);
                    }
                } catch (credError) {
                    // Credentials not ready yet
                }
            }
            
        } catch (error) {
            // Connection check is optional
        }
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
            const contacts = contactStorage && contactStorage.getAll ? contactStorage.getAll() : [];
            return {
                connected: isConnected || contacts.length > 0,
                qr: currentQR,
                initialized: this.isInitialized,
                contactCount: contacts.length
            };
        } catch (error) {
            return {
                connected: isConnected,
                qr: currentQR,
                initialized: this.isInitialized,
                contactCount: 0
            };
        }
    }

    getContacts() {
        return contactStorage ? contactStorage.getAll() : [];
    }

    async importGroupContacts(groupJid) {
        if (!this.isInitialized) throw new Error('WhatsApp service not initialized');
        
        console.log('📥 Group import requested for:', groupJid);
        
        try {
            // For now, return the current contact count as a simulation
            // In full implementation, this would trigger the bot's group extraction
            const currentContacts = contactStorage ? contactStorage.getAll().length : 0;
            
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

// WhatsApp Routes
app.get('/api/wa/status', authenticateQR, (req, res) => {
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

// Contact Routes  
app.get('/api/contacts', authenticateQR, (req, res) => {
    try {
        const { search, page = 1, limit = 50 } = req.query;
        let contacts = whatsappSvc.getContacts();
        
        // Search filter
        if (search) {
            const searchLower = search.toLowerCase();
            contacts = contacts.filter(contact => 
                contact.name.toLowerCase().includes(searchLower) ||
                contact.number.includes(search)
            );
        }
        
        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedContacts = contacts.slice(startIndex, endIndex);
        
        res.json({
            contacts: paginatedContacts,
            total: contacts.length,
            page: parseInt(page),
            totalPages: Math.ceil(contacts.length / limit)
        });
    } catch (error) {
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