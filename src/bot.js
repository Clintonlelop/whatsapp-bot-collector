const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeInMemoryStore,
} = require("@whiskeysockets/baileys");
const readline = require("readline");
const fs = require("fs-extra");
const path = require("path");
const QRCode = require("qrcode");
const logger = require("./utils/logger");
const ContactStorage = require("./storage/contacts");
const StatusManager = require("./storage/status");
const Commands = require("./commands");
const { detectPhoneNumbers } = require("./services/phone-detector");
const { ContactDB } = require("./database/db");
const { EventEmitter } = require("events");

class WhatsAppBot extends EventEmitter {
    constructor() {
        super(); // Call EventEmitter constructor
        this.sock = null;
        this.store = null;
        this.contacts = new ContactStorage();
        this.status = new StatusManager();
        this.commands = new Commands(this.contacts, this.status, this);

        // Enhanced name storage for pushNames and contact names
        this.contactNameStore = new Map();
        this.groupMemberStore = new Map();
        this.pairingInProgress = false; // Prevents restarts while user enters pairing code
        this.settings = {
            autoStatusView:
                (process.env.AUTO_STATUS_VIEW || "true").trim() !== "false",
        };
        this.loadSettings();
    }

    async start() {
        try {
            console.log(
                "\n🤖 WhatsApp Bot - Pairing Code Mode (Levanter-style)",
            );
            console.log("════════════════════════════════════════");

            // Create auth state
            const { state, saveCreds } =
                await useMultiFileAuthState("auth_info_baileys");

            // Check if logger supports child() method and makeInMemoryStore is available
            const supportsChild = typeof logger.child === "function";
            const baileysLogger = supportsChild
                ? logger.child({ module: "baileys" })
                : undefined;
            const storeLogger = supportsChild
                ? logger.child({ module: "store" })
                : undefined;
            const canMakeStore = typeof makeInMemoryStore === "function";

            // Create in-memory store for local contact caching (if available)
            if (canMakeStore) {
                this.store = makeInMemoryStore({
                    logger: storeLogger,
                });
            } else {
                logger.warn(
                    "Baileys makeInMemoryStore unavailable; skipping local cache",
                );
            }

            // Create socket — pairing code mode (no QR printed)
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                logger: baileysLogger,
                syncFullHistory: false,
                // Required so pairing code works
                mobile: false,
            });

            // Bind store to socket events for local contact caching (if store available)
            if (this.store) {
                this.store.bind(this.sock.ev);
                this.sock.store = this.store; // Make store accessible from sock
            }

            // Handle credentials update
            this.sock.ev.on("creds.update", saveCreds);

            // Handle connection updates
            this.sock.ev.on("connection.update", (update) => {
                this.handleConnectionUpdate(update);
            });

            // Handle messages
            this.sock.ev.on("messages.upsert", (m) => {
                this.handleMessages(m);
            });

            // Capture contact names from messages (for better name detection)
            this.sock.ev.on("messages.upsert", (update) => {
                this.captureContactNames(update);
            });

            // Capture contact names from contacts updates
            this.sock.ev.on("contacts.upsert", (contacts) => {
                this.captureContactsUpdate(contacts);
            });

            // Handle status updates (new statuses come via upsert)
            this.sock.ev.on("messages.upsert", (m) => {
                this.handleStatusUpdates(m);
            });

            // Also catch status updates via messages.update (Levanter-style)
            this.sock.ev.on("messages.update", (updates) => {
                if (!this.settings.autoStatusView) return;
                for (const update of updates) {
                    if (
                        update.key?.remoteJid === "status@broadcast" &&
                        !update.key?.fromMe
                    ) {
                        this.sock.readMessages([update.key]).catch(() => {});
                    }
                }
            });

            logger.info("Bot initialized successfully");
        } catch (error) {
            logger.error("Failed to start bot:", {
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }

    // ── Levanter-style: request a pairing code for a phone number ──
    async requestPairingCode(phoneNumber) {
        if (!this.sock)
            throw new Error("Bot not started yet. Call start() first.");
        const cleaned = String(phoneNumber).replace(/\D/g, "");
        logger.info(`Requesting pairing code for: ${cleaned}`);

        // Freeze ALL restarts — WhatsApp rejects passive connections until the user enters the code,
        // so reconnect attempts before that only cause rate-limiting. We reconnect only after the
        // user confirms they've entered the code (via the /api/auth/confirm-pairing endpoint).
        this.pairingInProgress = true;
        if (this._pairingTimeout) clearTimeout(this._pairingTimeout);
        // Safety: auto-clear after 3 min even if user never confirms
        this._pairingTimeout = setTimeout(() => {
            this.pairingInProgress = false;
            logger.info('Pairing window expired — restarts re-enabled');
        }, 3 * 60 * 1000);

        const code = await this.sock.requestPairingCode(cleaned);
        const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        logger.info(`Pairing code generated: ${formatted}`);
        this.emit("pairing_code", formatted);
        return formatted;
    }

    // Called when user confirms they've entered the code in WhatsApp.
    // Clears the pairing hold and reconnects once using saved device keys.
    async confirmPairing() {
        logger.info('✅ User confirmed code entry — attempting passive reconnect');
        this.pairingInProgress = false;
        if (this._pairingTimeout) clearTimeout(this._pairingTimeout);
        await this.start();
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        if (qr) {
            this.emit("pairing_ready");
            await this.generateQRCode(qr);
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;

            // Only clear stale credentials when we are NOT in the middle of a pairing session.
            // During pairing, those credentials hold the device keys WhatsApp needs to match
            // the code the user is about to enter — deleting them would break the pairing.
            if (!isLoggedOut && !this.pairingInProgress) {
                const fs = require('fs-extra');
                const credsPath = './auth_info_baileys/creds.json';
                if (fs.existsSync(credsPath)) {
                    try {
                        await fs.remove(credsPath);
                        console.log('🗑️ Stale credentials detected and cleared — will start fresh');
                    } catch (e) { /* ignore */ }
                }
            }

            const shouldReconnect = !isLoggedOut;
            logger.info(
                "Connection closed due to",
                lastDisconnect?.error,
                ", reconnecting:",
                shouldReconnect,
            );

            if (shouldReconnect) {
                if (this.pairingInProgress) {
                    // WhatsApp rejects passive connections until the user enters the code.
                    // Reconnecting now would only cause rate-limiting. Wait silently until the
                    // user clicks "I've entered the code" which calls confirmPairing().
                    logger.info('⏳ Pairing in progress — holding reconnects until user confirms code entry');
                } else {
                    setTimeout(() => this.start(), 3000);
                }
            }
        } else if (connection === "open") {
            logger.info("✅ WhatsApp connection opened successfully!");
            // Clear pairing flag — code was entered and we're connected
            this.pairingInProgress = false;
            if (this._pairingTimeout) clearTimeout(this._pairingTimeout);
            if (isNewLogin) {
                console.log(
                    "\n✅ New device linked! Broadcasting to dashboard...",
                );
                await this.makeUserOwnerAndPremium();
                // Only send auth event to web when this is a brand-new pairing, not a reconnect
                await this.broadcastUserInfo();
            }
            this.initializeBot();
        } else if (connection === "connecting") {
            logger.info("🔗 Connecting to WhatsApp...");
        }
    }

    async generateQRCode(qr) {
        try {
            console.log("\n📱 QR CODE READY!");
            console.log("════════════════════════════════════════");
            console.log("🌐 QR Code ready for web display");
            console.log("📋 Steps to link your WhatsApp:");
            console.log("1. Open the web dashboard");
            console.log("2. Scan the QR code displayed in the sidebar");
            console.log("3. Open WhatsApp on your phone");
            console.log("4. Go to Settings > Linked Devices");
            console.log('5. Tap "Link a Device"');
            console.log("════════════════════════════════════════");
            console.log("⏳ Waiting for you to scan the QR code...\n");

            // Try different QR code generation approaches
            let qrDataURL = null;

            // Method 1: Simple toDataURL call
            try {
                qrDataURL = await QRCode.toDataURL(qr);
                console.log(
                    "✅ QR code generated successfully with basic method",
                );
            } catch (basicError) {
                console.log("❌ Basic toDataURL failed:", basicError.message);

                // Method 2: Using callback approach
                try {
                    qrDataURL = await new Promise((resolve, reject) => {
                        QRCode.toDataURL(qr, (err, url) => {
                            if (err) reject(err);
                            else resolve(url);
                        });
                    });
                    console.log(
                        "✅ QR code generated successfully with callback method",
                    );
                } catch (callbackError) {
                    console.log(
                        "❌ Callback toDataURL failed:",
                        callbackError.message,
                    );

                    // Method 3: Save to buffer and convert
                    try {
                        const buffer = await QRCode.toBuffer(qr);
                        qrDataURL = `data:image/png;base64,${buffer.toString("base64")}`;
                        console.log(
                            "✅ QR code generated successfully with buffer method",
                        );
                    } catch (bufferError) {
                        console.log(
                            "❌ Buffer method failed:",
                            bufferError.message,
                        );
                        throw new Error(
                            "All QR code generation methods failed",
                        );
                    }
                }
            }

            if (qrDataURL) {
                console.log("🎉 QR code ready for web broadcast");
                // Emit QR code to server for web display
                this.emit("qr_ready", qrDataURL);
            }
        } catch (error) {
            logger.error("Failed to generate QR code:", error);
            console.log(
                "❌ Failed to generate QR code for web display:",
                error.message,
            );
            console.log("❌ Error details:", error.stack);
        }
    }

    async initializeBot() {
        try {
            // Get bot's own number
            const botNumber = this.sock.user.id.split(":")[0];
            logger.info(`Bot number: ${botNumber}`);

            // Load existing contacts
            await this.contacts.load();
            logger.info(
                `Loaded ${this.contacts.getCount()} contacts from storage`,
            );
        } catch (error) {
            logger.error("Failed to initialize bot:", error);
        }
    }

    async handleMessages(m) {
        try {
            const message = m.messages[0];
            if (!message.message || message.key.fromMe) return;

            // Skip status messages - they're handled by handleStatusUpdates
            if (message.key.remoteJid === "status@broadcast") {
                return;
            }

            const messageText = this.extractMessageText(message);

            // 🔥 AUTOMATED PHONE NUMBER DETECTION & SAVING 🔥
            await this.handlePhoneNumberDetection(message, messageText);
            const remoteJid = message.key.remoteJid;
            const isGroup = remoteJid.includes("@g.us");

            // Safely extract sender number - handle LID identifiers
            let senderNumber = null;
            if (isGroup) {
                if (
                    message.key.participant &&
                    message.key.participant.includes("@")
                ) {
                    senderNumber = message.key.participant.split("@")[0];
                }
            } else {
                if (remoteJid && remoteJid.includes("@")) {
                    senderNumber = remoteJid.split("@")[0];
                }
            }

            logger.info(
                `📨 Message received from ${remoteJid}, sender: ${senderNumber || "unknown"}, isGroup: ${isGroup}, text: "${messageText}"`,
            );

            // Skip if we can't identify the sender number (LID users)
            if (!senderNumber) {
                logger.debug(
                    "Skipping message from LID user (no phone number available)",
                );
                return;
            }

            // Handle unsaved contacts
            if (!isGroup && !this.contacts.exists(senderNumber)) {
                await this.handleUnsavedContact(message, senderNumber);
            }

            // Handle commands
            if (messageText && messageText.startsWith(".")) {
                await this.handleCommand(message, messageText, isGroup);
            }
        } catch (error) {
            logger.error("Failed to handle message:", error);
        }
    }

    // 🔥 NEW: Automated Phone Number Detection & Database Saving
    async handlePhoneNumberDetection(message, messageText) {
        try {
            if (!messageText || messageText.trim().length === 0) return;

            // Detect phone numbers in the message
            const detectedNumbers = detectPhoneNumbers(messageText);

            if (detectedNumbers.length === 0) return;

            // Get sender information
            const remoteJid = message.key.remoteJid;
            const isGroup = remoteJid.includes("@g.us");
            let senderNumber = null;

            if (isGroup) {
                if (
                    message.key.participant &&
                    message.key.participant.includes("@")
                ) {
                    senderNumber = message.key.participant.split("@")[0];
                }
            } else {
                if (remoteJid && remoteJid.includes("@")) {
                    senderNumber = remoteJid.split("@")[0];
                }
            }

            const sender = senderNumber || remoteJid;

            // Save message to database
            await ContactDB.createMessage({
                sender: sender,
                content: messageText,
                phoneNumbersDetected: detectedNumbers,
            });

            // Process each detected phone number
            for (const phoneNumber of detectedNumbers) {
                // Check if contact already exists
                const existingContact =
                    await ContactDB.getContactByPhone(phoneNumber);

                if (!existingContact) {
                    // Create new contact
                    const newContact = await ContactDB.createContact({
                        phoneNumber: phoneNumber,
                        source: sender,
                        messageContext: messageText.substring(0, 200), // Limit context length
                        saved: false,
                    });

                    if (newContact) {
                        logger.info(
                            `📞 Auto-saved new contact: ${phoneNumber} from ${sender}`,
                        );
                    }
                } else {
                    logger.debug(
                        `📞 Contact ${phoneNumber} already exists, skipping`,
                    );
                }
            }

            // Log the detection
            if (detectedNumbers.length > 0) {
                logger.info(
                    `🎯 Detected ${detectedNumbers.length} phone number(s) in message from ${sender}: ${detectedNumbers.join(", ")}`,
                );
            }
        } catch (error) {
            logger.error("❌ Failed to process phone number detection:", error);
        }
    }

    async handleUnsavedContact(message, senderNumber) {
        try {
            // Get contact info
            const contactInfo = await this.getContactInfo(
                message.key.remoteJid,
            );
            const contactName =
                contactInfo?.name || contactInfo?.pushName || "Unknown";

            // Save contact
            await this.contacts.addContact({
                number: senderNumber,
                name: contactName,
                addedDate: new Date().toISOString(),
                source: "auto_message",
            });

            logger.info(
                `Auto-saved new contact: ${contactName} (${senderNumber})`,
            );
        } catch (error) {
            logger.error("Failed to save unsaved contact:", error);
        }
    }

    async handleCommand(message, messageText, isGroup) {
        const command = messageText.toLowerCase().trim();
        const remoteJid = message.key.remoteJid;

        logger.info(
            `🔧 Command received: "${command}" from ${remoteJid}, isGroup: ${isGroup}`,
        );

        // 🔒 PRIVATE BOT: Only QR-authenticated users can use ANY commands
        const isOwner = this.isOwner(message);

        if (!isOwner) {
            logger.info(
                `❌ Unauthorized command attempt from ${remoteJid}: ${command}`,
            );
            // Send helpful message for unauthorized commands
            await this.sock.sendMessage(remoteJid, {
                text: `🔒 This bot is private! Only users who have scanned the QR code can use commands.\n\n👑 To gain access, scan the QR code on the web dashboard first.`,
            });
            return;
        }

        logger.info(
            `👑 Authenticated user verified! Processing command: ${command}`,
        );

        try {
            let response = "";

            switch (command) {
                case ".menu":
                    response = this.commands.getMenu();
                    break;

                case ".getcontacts":
                    if (!isGroup) {
                        response =
                            "📝 *Contact Extraction*\n\nℹ️ This command works best in groups to extract member contacts.\n\nIn private chats, you can:\n• Use .contacts to view saved contacts\n• Use .sendcontact <number> to send contact cards\n• Join a group and use .getcontacts there";
                        break;
                    }
                    response = await this.commands.getGroupContacts(
                        this.sock,
                        remoteJid,
                    );
                    break;

                case ".contacts":
                    const contactResult = await this.commands.listContacts(
                        this.sock,
                        remoteJid,
                    );
                    if (contactResult.type === "file_sent") {
                        // File was sent successfully, no need to send another message
                        return;
                    } else {
                        response = contactResult.content;
                    }
                    break;

                case ".status":
                    response = this.commands.toggleStatus(this.settings);
                    this.saveSettings();
                    break;

                case ".userjid":
                    if (!isGroup) {
                        response = `🆔 *Your JID Information*\n\n📱 *Your WhatsApp ID:* ${remoteJid}\n\nℹ️ In groups, this command shows all member JIDs.\nJoin a group and use .userjid there to see all members.`;
                        break;
                    }
                    response = await this.commands.getUserJids(
                        this.sock,
                        remoteJid,
                        this.isOwner(message),
                    );
                    break;

                default:
                    // Handle more complex commands with parameters
                    if (command.startsWith(".pushcontact")) {
                        if (!isGroup) {
                            response =
                                "📤 *Push Contact*\n\nℹ️ This command sends messages to all group members.\n\nIn private chats, you can:\n• Use .sendcontact <number> to send contact cards\n• Use .pushcontactv2 <groupId>|<message> to message specific groups\n• Join a group and use .pushcontact there";
                        } else {
                            const pushMessage = messageText
                                .replace(".pushcontact", "")
                                .trim();
                            response = await this.commands.pushContact(
                                this.sock,
                                remoteJid,
                                pushMessage,
                                this.isOwner(message),
                            );
                        }
                    } else if (command.startsWith(".pushcontactv2")) {
                        const params = messageText
                            .replace(".pushcontactv2", "")
                            .trim();
                        response = await this.commands.pushContactV2(
                            this.sock,
                            params,
                            this.isOwner(message),
                        );
                    } else if (command.startsWith(".sendcontact")) {
                        const phoneParam = messageText
                            .replace(".sendcontact", "")
                            .trim();
                        if (!phoneParam) {
                            response =
                                "❌ Please provide a phone number!\n\nUsage: .sendcontact <phone_number>";
                        } else {
                            const numbers = [
                                phoneParam.includes("+")
                                    ? phoneParam
                                    : "+" + phoneParam,
                            ];
                            response = await this.sendContact(
                                remoteJid,
                                numbers,
                            );
                        }
                    } else {
                        response =
                            "❌ Unknown command. Type .menu to see available commands.";
                    }
            }

            if (response) {
                await this.sock.sendMessage(remoteJid, { text: response });
            }
        } catch (error) {
            logger.error("Failed to handle command:", error);
            await this.sock.sendMessage(remoteJid, {
                text: "❌ An error occurred while processing your command.",
            });
        }
    }

    async handleStatusUpdates(m) {
        if (!this.settings.autoStatusView) return;

        const message = m.messages[0];
        if (!message.message || message.key.fromMe) return;

        // Check if it's a status update
        if (message.key.remoteJid === "status@broadcast") {
            try {
                await this.status.viewAndSaveStatus(this.sock, message);
            } catch (error) {
                logger.error("Failed to handle status update:", error);
            }
        }
    }

    // CheemsBot-style contact functions
    async sendContact(jid, contactNumbers, quoted = "") {
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
item1.TEL;waid=${number.replace("+", "")}:${number}
item1.X-ABLabel:Click here to chat
item2.EMAIL;type=INTERNET:WhatsApp Bot
item2.X-ABLabel:Bot Email
item3.URL:https://github.com/yourusername
item3.X-ABLabel:GitHub
item4.ADR:;;Your Location;;;;
item4.X-ABLabel:Region
END:VCARD`,
                });
            }

            await this.sock.sendMessage(
                jid,
                {
                    contacts: {
                        displayName: `${list.length} Contact${list.length > 1 ? "s" : ""}`,
                        contacts: list,
                    },
                },
                { quoted },
            );

            return `✅ Sent ${list.length} contact${list.length > 1 ? "s" : ""} successfully!`;
        } catch (error) {
            logger.error("Failed to send contact:", error);
            return "❌ Failed to send contact.";
        }
    }

    async getName(jid) {
        try {
            // Clean phone number - remove + prefix and non-digits
            let cleanNumber = jid;
            if (typeof jid === "string") {
                if (jid.includes("@")) {
                    cleanNumber = jid.split("@")[0];
                } else {
                    // Remove + and any non-digits
                    cleanNumber = jid.replace(/[^\d]/g, "");
                }
            }

            // Build proper WhatsApp ID
            const id = cleanNumber + "@s.whatsapp.net";

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
                    if (
                        baileyName &&
                        baileyName !== id &&
                        !baileyName.includes("@")
                    ) {
                        return baileyName;
                    }
                } catch (err) {
                    logger.debug("Baileys getName failed for:", id);
                }
            }

            // Create meaningful fallback names based on country code
            if (cleanNumber.startsWith("234")) {
                return `Nigerian_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith("1")) {
                return `US_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith("44")) {
                return `UK_${cleanNumber.slice(-4)}`;
            } else if (cleanNumber.startsWith("91")) {
                return `India_${cleanNumber.slice(-4)}`;
            } else {
                // Use the clean number itself as fallback
                return `+${cleanNumber}`;
            }
        } catch (error) {
            logger.error("Failed to get name:", error);
            // Final fallback - return the clean number
            const fallback =
                typeof jid === "string"
                    ? jid.replace(/[^\d]/g, "")
                    : String(jid);
            return `+${fallback}`;
        }
    }

    async getContactInfo(jid) {
        try {
            const contact = await this.sock.onWhatsApp(jid);
            return contact[0] || null;
        } catch (error) {
            logger.error("Failed to get contact info:", error);
            return null;
        }
    }

    extractMessageText(message) {
        return (
            message.message.conversation ||
            message.message.extendedTextMessage?.text ||
            ""
        );
    }

    isOwner(message) {
        logger.info("🔍 CheemsBot-style owner check called!");
        try {
            // Get bot number
            const botNumber = this.sock.user?.id
                ? this.sock.user.id.split(":")[0]
                : null;

            // Load owner and premium lists (CheemsBot style)
            const fs = require("fs");
            const path = require("path");

            let owner = [];
            let prem = [];

            try {
                const ownerPath = path.join(
                    __dirname,
                    "../database/owner.json",
                );
                const premPath = path.join(
                    __dirname,
                    "../database/premium.json",
                );

                if (fs.existsSync(ownerPath)) {
                    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
                }
                if (fs.existsSync(premPath)) {
                    prem = JSON.parse(fs.readFileSync(premPath, "utf8"));
                }

                logger.info(`📚 Loaded owners: ${JSON.stringify(owner)}`);
                logger.info(`💎 Loaded premium: ${JSON.stringify(prem)}`);
            } catch (error) {
                logger.error("Failed to load owner/premium files:", error);
                // Fallback to configured environment values only
                owner = process.env.DEFAULT_OWNER_NUMBER
                    ? [process.env.DEFAULT_OWNER_NUMBER]
                    : [];
                prem = process.env.DEFAULT_OWNER_JID
                    ? [process.env.DEFAULT_OWNER_JID]
                    : [];
            }

            // Get sender (CheemsBot style)
            const sender = message.key.remoteJid.includes("@g.us")
                ? message.key.participant || message.key.remoteJid
                : message.key.remoteJid;

            logger.info(`👤 Sender: ${sender}`);

            // CheemsBot owner verification method
            const ownerList = botNumber ? [botNumber, ...owner] : owner;
            const XeonTheCreator = ownerList
                .map((v) => v.replace(/[^0-9]/g, "") + "@s.whatsapp.net")
                .includes(sender);

            const isPrem = prem.includes(sender);

            logger.info(
                `🔑 Owner list formatted: ${JSON.stringify(ownerList.map((v) => v.replace(/[^0-9]/g, "") + "@s.whatsapp.net"))}`,
            );
            logger.info(`✅ OWNER CHECK: ${XeonTheCreator}`);
            logger.info(`💎 PREMIUM CHECK: ${isPrem}`);

            // Return true if either owner or premium
            return XeonTheCreator || isPrem;
        } catch (error) {
            logger.error("❌ CheemsBot owner check failed:", error);
            return false;
        }
    }

    looksLikeLid(number) {
        // LIDs are typically 13-15 digits and don't match common country codes
        const cleaned = number.replace(/[^\d]/g, "");
        if (cleaned.length < 13 || cleaned.length > 15) {
            return false;
        }

        // Basic check - if it starts with common country codes, it's likely a phone
        const commonPrefixes = [
            "1",
            "44",
            "49",
            "33",
            "39",
            "81",
            "86",
            "91",
            "234",
            "27",
            "55",
            "52",
            "61",
            "7",
            "90",
            "82",
        ];
        const matchesCountryCode = commonPrefixes.some((prefix) =>
            cleaned.startsWith(prefix),
        );

        return !matchesCountryCode;
    }

    checkLidMapping(lidNumber, ownerNumber) {
        try {
            const authDir = path.join(__dirname, "../auth_info_baileys");

            // Try reverse mapping first: lid-mapping-<LID>_reverse.json
            const reverseFile = path.join(
                authDir,
                `lid-mapping-${lidNumber}_reverse.json`,
            );
            if (fs.existsSync(reverseFile)) {
                const reverseData = fs.readJsonSync(reverseFile);
                // The reverse file contains just the phone number as a string
                const phoneFromMapping = String(reverseData).replace(
                    /[^\d]/g,
                    "",
                );
                if (phoneFromMapping === ownerNumber) {
                    logger.debug(
                        `LID ${lidNumber} mapped to owner phone via reverse mapping`,
                    );
                    return true;
                }
            }

            // Try forward mapping: lid-mapping-<ownerNumber>.json
            const forwardFile = path.join(
                authDir,
                `lid-mapping-${ownerNumber}.json`,
            );
            if (fs.existsSync(forwardFile)) {
                const forwardData = fs.readJsonSync(forwardFile);
                // Check if this LID is in the owner's mapped LIDs
                if (
                    Array.isArray(forwardData) &&
                    forwardData.includes(lidNumber)
                ) {
                    logger.debug(
                        `LID ${lidNumber} found in owner's forward mapping`,
                    );
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error("Failed to check LID mapping:", error);
            return false;
        }
    }

    loadSettings() {
        try {
            const settingsPath = path.join(__dirname, "../data/settings.json");
            if (fs.existsSync(settingsPath)) {
                const data = fs.readJsonSync(settingsPath);
                this.settings = { ...this.settings, ...data };
            }
        } catch (error) {
            logger.error("Failed to load settings:", error);
        }
    }

    saveSettings() {
        try {
            const settingsPath = path.join(__dirname, "../data/settings.json");
            fs.ensureDirSync(path.dirname(settingsPath));
            fs.writeJsonSync(settingsPath, this.settings, { spaces: 2 });
        } catch (error) {
            logger.error("Failed to save settings:", error);
        }
    }

    async broadcastUserInfo() {
        try {
            if (!this.sock.user) {
                logger.warn("No user info available to broadcast");
                return;
            }

            // Get user information
            const userPhone = this.sock.user.id.split(":")[0];
            const userName =
                this.sock.user.name ||
                this.sock.user.verifiedName ||
                "WhatsApp User";

            const userInfo = {
                name: userName,
                phone: userPhone,
                status: "authenticated",
            };

            logger.info(
                `📡 Broadcasting user info to web dashboard: ${userName} (${userPhone})`,
            );

            // Send to web interface via global event emitter if available
            if (global.io) {
                global.io.emit("user-authenticated", userInfo);
                logger.info("✅ User info sent to web dashboard");
            } else {
                logger.warn("⚠️ Global socket.io instance not available");
            }
        } catch (error) {
            logger.error("❌ Failed to broadcast user info:", error);
        }
    }

    async makeUserOwnerAndPremium() {
        try {
            // Get the connected user's phone number
            const userPhone = this.sock.user.id.split(":")[0];
            const userJid = userPhone + "@s.whatsapp.net";

            logger.info(`🎉 Auto-authenticating WhatsApp user: ${userPhone}`);

            const fs = require("fs");
            const path = require("path");

            // Ensure database directory exists
            const dbDir = path.join(__dirname, "../database");
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            // Load or create owner list
            const ownerPath = path.join(dbDir, "owner.json");
            let owners = [];
            if (fs.existsSync(ownerPath)) {
                try {
                    owners = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
                } catch (error) {
                    logger.warn(
                        "Failed to parse owner.json, creating new:",
                        error.message,
                    );
                    owners = [];
                }
            }

            // Load or create premium list
            const premPath = path.join(dbDir, "premium.json");
            let premiums = [];
            if (fs.existsSync(premPath)) {
                try {
                    premiums = JSON.parse(fs.readFileSync(premPath, "utf8"));
                } catch (error) {
                    logger.warn(
                        "Failed to parse premium.json, creating new:",
                        error.message,
                    );
                    premiums = [];
                }
            }

            // Add user to owner list if not already there
            if (!owners.includes(userPhone)) {
                owners.push(userPhone);
                fs.writeFileSync(ownerPath, JSON.stringify(owners, null, 2));
                logger.info(
                    `👤 Authenticating user: ${userPhone} (${userJid})`,
                );
            }

            // Add user to premium list if not already there
            if (!premiums.includes(userJid)) {
                premiums.push(userJid);
                fs.writeFileSync(premPath, JSON.stringify(premiums, null, 2));
                logger.info(`🎖️ Added ${userPhone} as owner and premium user`);
            }

            logger.info(
                `✅ User ${userPhone} authenticated and granted owner access`,
            );
            logger.info(`✅ Auto-authentication completed for ${userPhone}`);
        } catch (error) {
            logger.error("❌ Failed to make user owner and premium:", error);
        }
    }

    // Capture contact names from messages for better name detection
    captureContactNames(update) {
        try {
            const messages = update.messages || [];

            messages.forEach((message) => {
                if (message.pushName && message.key) {
                    const jid =
                        message.key.participant || message.key.remoteJid;
                    if (jid && message.pushName.trim()) {
                        this.contactNameStore.set(jid, message.pushName.trim());
                        logger.debug(
                            `📝 Captured pushName: ${message.pushName} for ${jid}`,
                        );
                    }
                }
            });
        } catch (error) {
            logger.debug(
                "Error capturing contact names from messages:",
                error.message,
            );
        }
    }

    // Capture contact names from contacts updates
    captureContactsUpdate(contacts) {
        try {
            contacts.forEach((contact) => {
                if (contact.id && contact.name && contact.name.trim()) {
                    this.contactNameStore.set(contact.id, contact.name.trim());
                    logger.debug(
                        `📝 Captured contact name: ${contact.name} for ${contact.id}`,
                    );
                }
            });
        } catch (error) {
            logger.debug(
                "Error capturing contact names from contacts update:",
                error.message,
            );
        }
    }

    // Get display name for a JID using our store
    getDisplayName(jid) {
        try {
            // Try to get from our contact name store
            const storedName = this.contactNameStore.get(jid);
            if (storedName) {
                return storedName;
            }

            // Try alternate format (with/without device)
            const baseJid = jid.includes(":")
                ? jid.split(":")[0] + "@" + jid.split("@")[1]
                : jid;
            const altStoredName = this.contactNameStore.get(baseJid);
            if (altStoredName) {
                return altStoredName;
            }

            // Fallback to phone number
            if (jid.includes("@")) {
                return jid.split("@")[0];
            }

            return jid;
        } catch (error) {
            logger.debug("Error getting display name:", error.message);
            return jid;
        }
    }
}

module.exports = WhatsAppBot;
