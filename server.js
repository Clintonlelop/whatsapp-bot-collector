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
const Commands = require('./src/commands');

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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Admin credentials (should be in environment variables)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123', 10);

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
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
            // Initialize contact storage
            contactStorage = new ContactStorage();
            
            // Create bot instance
            this.bot = new WhatsAppBot();
            this.commands = new Commands(this.bot, contactStorage);
            
            // Set up event listeners for real-time updates
            this.setupEventListeners();
            
            this.isInitialized = true;
            console.log('✅ WhatsApp Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize WhatsApp Service:', error);
            throw error;
        }
    }

    setupEventListeners() {
        if (!this.bot) return;

        // Listen for connection updates
        this.bot.on('connectionUpdate', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                currentQR = qr;
                io.emit('qr_update', { qr });
            }
            
            if (connection === 'open') {
                isConnected = true;
                currentQR = null;
                io.emit('connection_update', { status: 'connected' });
            } else if (connection === 'close') {
                isConnected = false;
                io.emit('connection_update', { status: 'disconnected' });
            }
        });

        // Listen for new contacts
        this.bot.on('contactUpdate', (contacts) => {
            io.emit('contacts_update', { contacts });
        });
    }

    async connect() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.bot.start();
    }

    async disconnect() {
        if (this.bot) {
            return this.bot.stop();
        }
    }

    getStatus() {
        return {
            connected: isConnected,
            qr: currentQR,
            initialized: this.isInitialized
        };
    }

    getContacts() {
        return contactStorage ? contactStorage.getAll() : [];
    }

    async importGroupContacts(groupJid) {
        if (!this.commands) throw new Error('WhatsApp service not initialized');
        return this.commands.extractGroupContacts(groupJid);
    }
}

// Initialize service
const whatsappSvc = new WhatsAppService();

// API Routes

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (username !== ADMIN_USERNAME) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { username: ADMIN_USERNAME },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ token, username: ADMIN_USERNAME });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ username: req.user.username });
});

// WhatsApp Routes
app.get('/api/wa/status', authenticateToken, (req, res) => {
    res.json(whatsappSvc.getStatus());
});

app.post('/api/wa/connect', authenticateToken, async (req, res) => {
    try {
        await whatsappSvc.connect();
        res.json({ success: true, message: 'Connection initiated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/wa/disconnect', authenticateToken, async (req, res) => {
    try {
        await whatsappSvc.disconnect();
        res.json({ success: true, message: 'Disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Contact Routes
app.get('/api/contacts', authenticateToken, (req, res) => {
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

app.post('/api/contacts/import-group', authenticateToken, async (req, res) => {
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

app.get('/api/contacts/export', authenticateToken, (req, res) => {
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
app.get('*', (req, res) => {
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