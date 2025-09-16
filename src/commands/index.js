const logger = require('../utils/logger');

class Commands {
    constructor(contacts, status, botInstance) {
        this.contacts = contacts;
        this.status = status;
        this.bot = botInstance;
    }

    getMenu() {
        return `🤖 *WhatsApp Bot Commands*

📋 *Available Everywhere:*
• .menu - Show this menu
• .contacts - List all saved contacts
• .status - Toggle auto status viewing
• .sendcontact <number> - Send contact card

🔄 *Smart Commands:*
• .getcontacts - Save group members (best in groups)
• .pushcontact <message> - Message group members (groups)
• .userjid - Show your ID (private) or all IDs (groups)

👑 *Owner Commands:*
• .pushcontactv2 <groupId>|<message> - Send to any group

📊 *Current Status:*
• Total contacts: ${this.contacts.getCount()}
• Auto status view: ${this.status.isEnabled() ? '✅ ON' : '❌ OFF'}

💡 *Note:* All commands work in private chats and groups!
👑 *Owner commands require bot owner privileges*`;
    }

    // Helper function to resolve contact names from multiple sources
    async resolveName(sock, jid) {
        try {
            // Try to get name from local store contacts cache first
            if (sock?.store?.contacts?.[jid]?.name) {
                return sock.store.contacts[jid].name;
            }
            
            // Try notify name from store
            if (sock?.store?.contacts?.[jid]?.notify) {
                return sock.store.contacts[jid].notify;
            }
            
            // Try sock.contacts if available
            if (sock?.contacts?.[jid]?.name) {
                return sock.contacts[jid].name;
            }
            
            if (sock?.contacts?.[jid]?.notify) {
                return sock.contacts[jid].notify;
            }

            // Try to get name using WhatsApp's built-in getName function
            if (sock.getName) {
                try {
                    const name = await sock.getName(jid);
                    if (name && name !== jid && !name.includes('@')) {
                        return name;
                    }
                } catch (err) {
                    logger.debug('getName failed for:', jid);
                }
            }

            // Try getting push name from message history (if available)
            if (sock.store && sock.store.messages) {
                try {
                    const messages = sock.store.messages[jid];
                    if (messages && messages.length > 0) {
                        const lastMessage = messages[messages.length - 1];
                        if (lastMessage.pushName && lastMessage.pushName !== jid) {
                            return lastMessage.pushName;
                        }
                    }
                } catch (err) {
                    logger.debug('Failed to get push name from messages:', jid);
                }
            }
            
            // No name found in cache
            return null;
        } catch (error) {
            logger.error('Failed to resolve name from cache:', error);
            return null;
        }
    }

    async getGroupContacts(sock, groupJid) {
        try {
            // Get group metadata
            const groupMetadata = await sock.groupMetadata(groupJid);
            const participants = groupMetadata.participants;

            let addedCount = 0;
            let existingCount = 0;

            for (const participant of participants) {
                // Extract actual phone number using new method (pass full participant object)
                const phoneNumber = await this.extractPhoneNumber(sock, participant);
                
                if (phoneNumber && !this.contacts.exists(phoneNumber)) {
                    // Get real contact name using multiple detection methods
                    let contactName = null;
                    
                    // 1. Check participant object directly for any available name fields
                    if (participant.notify && participant.notify.trim()) {
                        contactName = participant.notify.trim();
                        logger.info(`🎯 Found notify name: ${contactName} for ${participant.id}`);
                    } else if (participant.verifiedName && participant.verifiedName.trim()) {
                        contactName = participant.verifiedName.trim();
                        logger.info(`🎯 Found verified name: ${contactName} for ${participant.id}`);
                    } else if (participant.name && participant.name.trim()) {
                        contactName = participant.name.trim();
                        logger.info(`🎯 Found participant name: ${contactName} for ${participant.id}`);
                    }
                    
                    // 2. Try bot's enhanced name store
                    if (!contactName && this.bot && this.bot.getDisplayName) {
                        contactName = this.bot.getDisplayName(participant.id);
                        // If we got a phone number back, it means no real name was found
                        if (contactName === participant.id.split('@')[0]) {
                            contactName = null;
                        } else if (contactName) {
                            logger.info(`🎯 Found stored name: ${contactName} for ${participant.id}`);
                        }
                    }
                    
                    // 3. Try traditional cached name resolution
                    if (!contactName) {
                        contactName = await this.resolveName(sock, participant.id);
                        if (contactName) {
                            logger.info(`🎯 Found cached name: ${contactName} for ${participant.id}`);
                        }
                    }
                    
                    // Enhanced fallback with better patterns
                    if (!contactName) {
                        const cleanNumber = phoneNumber.replace('+', '');
                        if (cleanNumber.startsWith('234')) {
                            contactName = `Nigerian_${cleanNumber.slice(-4)}`;
                        } else if (cleanNumber.startsWith('1')) {
                            contactName = `US_${cleanNumber.slice(-4)}`;
                        } else if (cleanNumber.startsWith('44')) {
                            contactName = `UK_${cleanNumber.slice(-4)}`;
                        } else if (cleanNumber.startsWith('91')) {
                            contactName = `Indian_${cleanNumber.slice(-4)}`;
                        } else if (cleanNumber.startsWith('27')) {
                            contactName = `SA_${cleanNumber.slice(-4)}`;
                        } else {
                            contactName = `Member_${cleanNumber.slice(-4)}`;
                        }
                    }
                    
                    logger.info(`🏷️ Contact name resolved: ${contactName} for ${phoneNumber} (${participant.id})`);
                
                    
                    // Simplified contact saving - just name and number
                    await this.contacts.addContact({
                        number: phoneNumber,
                        name: contactName
                    });
                    
                    addedCount++;
                    logger.info(`Added contact: ${contactName} (${phoneNumber})`);
                } else if (phoneNumber) {
                    existingCount++;
                }
            }

            return `✅ *Group Contacts Saved*

📊 *Results:*
• New contacts added: ${addedCount}
• Already existed: ${existingCount}
• Total group members: ${participants.length}
• Group: ${groupMetadata.subject}

💾 Contacts saved to storage and exported to CSV.`;

        } catch (error) {
            logger.error('Failed to get group contacts:', error);
            return '❌ Failed to retrieve group contacts. Make sure the bot has proper permissions.';
        }
    }

    async extractPhoneNumber(sock, participant) {
        try {
            // Handle participant object directly (Baileys v7.x.x format)
            if (typeof participant === 'object' && participant.id) {
                const participantId = participant.id;
                
                // If participant has phoneNumber field (when id is LID), use it
                if (participant.phoneNumber) {
                    const cleanPhone = participant.phoneNumber.replace('@s.whatsapp.net', '');
                    logger.info(`✅ Real phone found via participant.phoneNumber: ${cleanPhone} (LID: ${participantId})`);
                    return this.formatPhoneNumber(cleanPhone);
                }
                
                // If participant has lid field (when id is phone), use the id
                if (participant.lid && participantId.includes('@s.whatsapp.net')) {
                    const cleanPhone = participantId.split('@')[0];
                    logger.info(`📱 Standard phone from participant.id: ${cleanPhone}`);
                    return this.formatPhoneNumber(cleanPhone);
                }
                
                // Try LID mapping store (Baileys built-in conversion)
                if (participantId.includes('@lid')) {
                    try {
                        const lidStore = sock.signalRepository.getLIDMappingStore();
                        const realPhone = await lidStore.getPNForLID(participantId.split('@')[0]);
                        if (realPhone) {
                            logger.info(`🎯 LID converted via mapping store: ${realPhone} (LID: ${participantId})`);
                            return this.formatPhoneNumber(realPhone);
                        }
                    } catch (lidError) {
                        logger.debug('LID mapping store failed:', lidError.message);
                    }
                }
                
                logger.warn(`❌ No real phone number found for: ${participantId}`);
                return null;
            }
            
            // Fallback for old format (participantId string)
            else if (typeof participant === 'string') {
                if (participant.includes('@s.whatsapp.net')) {
                    const number = participant.split('@')[0];
                    logger.info(`📱 Fallback standard number: ${number}`);
                    return this.formatPhoneNumber(number);
                }
                
                logger.warn(`❌ Cannot convert LID string without participant object: ${participant}`);
                return null;
            }
            
            logger.warn(`❌ Invalid participant format:`, participant);
            return null;
            
        } catch (error) {
            logger.error('Failed to extract phone number from participant:', error);
            return null;
        }
    }
    
    isValidPhoneNumber(number) {
        // Remove any non-digits
        const cleaned = number.replace(/[^\d]/g, '');
        
        // Accept wider range for JID/LID conversion (6-15 digits)
        if (cleaned.length < 6 || cleaned.length > 15) {
            return false;
        }
        
        // Accept all numbers now (including LIDs) - let the user decide what's useful
        return true;
    }
    
    matchesKnownCountryCode(number) {
        // Common country code patterns (this is a basic check)
        const commonPrefixes = [
            '1',     // US/Canada
            '44',    // UK
            '49',    // Germany  
            '33',    // France
            '39',    // Italy
            '81',    // Japan
            '86',    // China
            '91',    // India
            '234',   // Nigeria
            '27',    // South Africa
            '55',    // Brazil
            '52',    // Mexico
            '61',    // Australia
            '7',     // Russia/Kazakhstan
            '90',    // Turkey
            '82',    // South Korea
        ];
        
        return commonPrefixes.some(prefix => number.startsWith(prefix));
    }

    formatPhoneNumber(number) {
        // Remove any non-numeric characters except +
        const cleaned = number.replace(/[^\d+]/g, '');
        
        // If it doesn't start with +, add + prefix
        if (!cleaned.startsWith('+')) {
            return `+${cleaned}`;
        }
        
        return cleaned;
    }


    async listContacts(sock, remoteJid) {
        const contacts = this.contacts.getAllContacts();
        
        if (contacts.length === 0) {
            return {
                type: 'text',
                content: '📝 *No contacts saved yet.*\n\nContacts will be automatically saved when:\n• Unsaved numbers message you\n• You use .getcontacts in a group'
            };
        }

        try {
            // Ensure files are up to date
            await this.contacts.save();
            
            const path = require('path');
            const fs = require('fs-extra');
            
            const csvPath = path.join(__dirname, '../..', 'data', 'contacts.csv');
            const vcfPath = path.join(__dirname, '../..', 'data', 'contacts.vcf');
            
            // Check if files exist
            if (!fs.existsSync(csvPath) || !fs.existsSync(vcfPath)) {
                return {
                    type: 'text',
                    content: '❌ *Contact files not found.*\n\nPlease try .getcontacts in a group first to generate contacts.'
                };
            }
            
            // Generate summary message
            const summary = `📞 *Contact Export Package*\n\n✅ **Total Contacts:** ${contacts.length}\n📁 **CSV File:** For spreadsheets (Excel, Google Sheets)\n📁 **VCF File:** For direct phone import (Android & iPhone)\n📅 **Generated:** ${new Date().toLocaleString()}\n\n💾 *Import the VCF file directly to your phone's contacts app for instant contact importing!*`;
            
            // Send both files
            await sock.sendMessage(remoteJid, {
                document: fs.readFileSync(csvPath),
                fileName: `contacts_${new Date().toISOString().split('T')[0]}.csv`,
                mimetype: 'text/csv',
                caption: summary
            });
            
            // Wait a moment then send VCF
            setTimeout(async () => {
                await sock.sendMessage(remoteJid, {
                    document: fs.readFileSync(vcfPath),
                    fileName: `contacts_${new Date().toISOString().split('T')[0]}.vcf`,
                    mimetype: 'text/vcard',
                    caption: '📱 *VCF Contact File*\n\nThis file can be imported directly to your phone:\n• **Android:** Open file > Import to contacts\n• **iPhone:** Open file > Add All Contacts'
                });
            }, 2000);
            
            return {
                type: 'file_sent',
                content: '✅ Contact files sent successfully!'
            };
            
        } catch (error) {
            logger.error('Failed to send contact files:', error);
            return {
                type: 'text',
                content: '❌ *Failed to send contact files.*\n\nPlease try again or contact support.'
            };
        }
    }

    toggleStatus(settings) {
        settings.autoStatusView = !settings.autoStatusView;
        
        return `🔄 *Auto Status Viewing*\n\nStatus: ${settings.autoStatusView ? '✅ ENABLED' : '❌ DISABLED'}\n\n${settings.autoStatusView ? 
            '📱 The bot will now automatically view and save all WhatsApp statuses.' : 
            '⏸️ Auto status viewing has been disabled.'}`;
    }

    // CheemsBot-style contact commands
    async pushContact(sock, groupJid, message, isOwner) {
        if (!isOwner) {
            return '❌ This command is only for bot owners!';
        }

        if (!groupJid.includes('@g.us')) {
            return '❌ This command can only be used in groups!';
        }

        if (!message || message.trim() === '') {
            return '❌ Please provide a message to send!\n\nUsage: .pushcontact <your message>';
        }

        try {
            const groupMetadata = await sock.groupMetadata(groupJid);
            let allParticipants = groupMetadata.participants.filter(p => 
                p.id.endsWith('.net') || p.id.endsWith('@lid')
            ).map(p => p.id);
            
            if (allParticipants.length === 0) {
                return '❌ No valid participants found in this group.';
            }

            // 🛡️ ULTRA SAFETY: Progressive batch system (max 50 total)
            const maxTotalParticipants = 50;
            const batchSize = 10;
            const totalToProcess = Math.min(allParticipants.length, maxTotalParticipants);
            const totalBatches = Math.ceil(totalToProcess / batchSize);
            
            allParticipants = allParticipants.slice(0, totalToProcess);

            let totalSuccessCount = 0;
            let totalFailureCount = 0;

            // Send initial status message
            await sock.sendMessage(groupJid, { 
                text: `🚀 *Smart Push Contact Started*

📊 *Plan:*
• Total participants: ${totalToProcess}/${allParticipants.length}
• Batches: ${totalBatches} (10 each)
• Group: ${groupMetadata.subject}

⏰ *Progressive timing:*
• Batch 1 → 2min break → Batch 2 → 3min break → Batch 3...

🎯 Starting Batch 1 now...` 
            });

            for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
                const batchStart = batchNum * batchSize;
                const batchEnd = Math.min(batchStart + batchSize, allParticipants.length);
                const batchParticipants = allParticipants.slice(batchStart, batchEnd);
                
                let batchSuccessCount = 0;
                let batchFailureCount = 0;

                // Process current batch
                for (let i = 0; i < batchParticipants.length; i++) {
                    const participantId = batchParticipants[i];
                    try {
                        await sock.sendMessage(participantId, { text: message });
                        batchSuccessCount++;
                        totalSuccessCount++;
                        
                        // 🛡️ SAFETY: Random delay 5-8 seconds between messages
                        if (i < batchParticipants.length - 1) {
                            const delay = Math.floor(Math.random() * 3000) + 5000; // 5000-8000ms
                            logger.info(`Waiting ${delay}ms before next message...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    } catch (error) {
                        batchFailureCount++;
                        totalFailureCount++;
                        logger.error(`Failed to send message to ${participantId}:`, error.message);
                    }
                }

                // Send batch completion update
                await sock.sendMessage(groupJid, { 
                    text: `✅ *Batch ${batchNum + 1}/${totalBatches} Complete*

📊 *Batch Results:*
• Sent: ${batchSuccessCount}
• Failed: ${batchFailureCount}
• Progress: ${totalSuccessCount}/${totalToProcess} total

${batchNum < totalBatches - 1 ? 
    `⏰ Next batch in ${batchNum + 2} minutes...` : 
    '🎉 All batches complete!'}`
                });

                // Progressive delay between batches (2 min, 3 min, 4 min, etc.)
                if (batchNum < totalBatches - 1) {
                    const batchDelayMinutes = batchNum + 2; // 2, 3, 4, 5 minutes
                    const batchDelayMs = batchDelayMinutes * 60 * 1000;
                    logger.info(`Waiting ${batchDelayMinutes} minutes before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, batchDelayMs));
                }
            }

            return `🎉 *Ultra-Safe Push Contact Complete!*

📊 *Final Results:*
• Total messages sent: ${totalSuccessCount}
• Total failed: ${totalFailureCount}
• Processed: ${totalToProcess}/${allParticipants.length} participants
• Batches completed: ${totalBatches}
• Group: ${groupMetadata.subject}

💬 Message: "${message}"

🛡️ *Advanced safety features:*
• 5-8 second delays between messages
• Progressive batch timing (2→3→4→5 min breaks)
• Maximum 50 participants total
• Smart anti-spam protection`;

        } catch (error) {
            logger.error('Failed to push contact:', error);
            return '❌ Failed to send messages to group contacts.';
        }
    }

    async pushContactV2(sock, text, isOwner) {
        if (!isOwner) {
            return '❌ This command is only for bot owners!';
        }

        if (!text || !text.includes('|')) {
            return `❌ Incorrect usage! Please use:\n.pushcontactv2 <groupId>|<message>\n\nExample:\n.pushcontactv2 120363123456789@g.us|Hello everyone!`;
        }

        try {
            const [groupId, message] = text.split('|');
            
            if (!groupId || !message) {
                return '❌ Both group ID and message are required!';
            }

            const cleanGroupId = groupId.trim();
            const cleanMessage = message.trim();

            if (!cleanGroupId.includes('@g.us')) {
                return '❌ Invalid group ID format! Must end with @g.us';
            }

            const groupMetadata = await sock.groupMetadata(cleanGroupId);
            const participants = groupMetadata.participants;
            
            let successCount = 0;
            let failureCount = 0;

            for (const participant of participants) {
                try {
                    const participantId = participant.id.split('@')[0] + '@s.whatsapp.net';
                    await sock.sendMessage(participantId, { text: cleanMessage });
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                } catch (error) {
                    failureCount++;
                    logger.error(`Failed to send message to ${participant.id}:`, error.message);
                }
            }

            return `✅ *Push Contact V2 Complete*

📊 *Results:*
• Messages sent: ${successCount}
• Failed sends: ${failureCount}
• Total participants: ${participants.length}
• Target group: ${groupMetadata.subject}

💬 Message: "${cleanMessage}"`;

        } catch (error) {
            logger.error('Failed to push contact v2:', error);
            return '❌ Failed to send messages. Check the group ID and try again.';
        }
    }

    async getUserJids(sock, groupJid, isOwner) {
        if (!isOwner) {
            return '❌ This command is only for bot owners!';
        }

        if (!groupJid.includes('@g.us')) {
            return '❌ This command can only be used in groups!';
        }

        try {
            const groupMetadata = await sock.groupMetadata(groupJid);
            const participants = groupMetadata.participants;
            
            if (participants.length === 0) {
                return '❌ No participants found in this group.';
            }

            let jidList = `👥 *Group JID List*\n\n`;
            jidList += `📋 *Group:* ${groupMetadata.subject}\n`;
            jidList += `👤 *Total Members:* ${participants.length}\n\n`;
            jidList += `🆔 *JID Addresses:*\n`;
            
            participants.forEach((member, index) => {
                jidList += `${index + 1}. ${member.id}\n`;
            });

            return jidList;

        } catch (error) {
            logger.error('Failed to get user JIDs:', error);
            return '❌ Failed to retrieve group member JIDs.';
        }
    }

    async sendContactCard(sock, remoteJid, ownerNumbers) {
        try {
            const result = await sock.sendContact(remoteJid, ownerNumbers);
            return result;
        } catch (error) {
            logger.error('Failed to send contact card:', error);
            return '❌ Failed to send contact card.';
        }
    }
}

module.exports = Commands;
