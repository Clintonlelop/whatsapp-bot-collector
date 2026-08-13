const logger = require('./logger');

class PhoneUtils {
    /**
     * Extract phone number from WhatsApp JID
     * @param {string} jid - WhatsApp JID (e.g., "1234567890@s.whatsapp.net" or "245217517154312:4@lid")
     * @returns {string|null} - Clean phone number or null if not extractable
     */
    static extractPhoneFromJID(jid) {
        if (!jid || typeof jid !== 'string') {
            return null;
        }

        try {
            // Standard individual contact: "1234567890@s.whatsapp.net"
            if (jid.includes('@s.whatsapp.net')) {
                const phone = jid.split('@')[0];
                return phone;
            }

            // Group JID: skip groups
            if (jid.includes('@g.us')) {
                return null;
            }

            // LID format: "245217517154312:4@lid" - these can't be converted to phone numbers directly
            if (jid.includes('@lid')) {
                return null;
            }

            // If it's just a raw number without @ symbol
            if (/^\d+$/.test(jid)) {
                return jid;
            }

            return null;
        } catch (error) {
            logger.error('Error extracting phone from JID:', error);
            return null;
        }
    }

    /**
     * Format phone number for display
     * @param {string} phoneNumber - Raw phone number
     * @returns {string} - Formatted phone number
     */
    static formatPhoneNumber(phoneNumber) {
        if (!phoneNumber) return phoneNumber;
        
        // Remove all non-digit characters except +
        const cleaned = phoneNumber.replace(/[^\d+]/g, '');
        
        // Add + prefix if missing
        const withPlus = cleaned.startsWith('+') ? cleaned : '+' + cleaned;
        
        // Format US numbers: +1 (555) 123-4567
        if (withPlus.startsWith('+1') && withPlus.length === 12) {
            const digits = withPlus.substring(2);
            return `+1 (${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
        }
        
        // For other international numbers, keep as is
        return withPlus;
    }

    /**
     * Process contact data to add formatted phone numbers
     * @param {Object} contact - Contact object from database
     * @returns {Object} - Contact object with formatted phone number
     */
    static processContact(contact) {
        if (!contact) return contact;

        const processed = { ...contact };

        // Extract phone number from various possible fields
        let rawPhone = null;
        if (contact.phoneNumber) {
            rawPhone = this.extractPhoneFromJID(contact.phoneNumber);
        } else if (contact.phone_number) {
            rawPhone = this.extractPhoneFromJID(contact.phone_number);
        } else if (contact.source) {
            rawPhone = this.extractPhoneFromJID(contact.source);
        }

        if (rawPhone) {
            processed.formattedPhone = this.formatPhoneNumber(rawPhone);
            processed.rawPhone = rawPhone;
        } else {
            // If we can't extract a phone number, keep the original but mark it
            processed.formattedPhone = contact.phoneNumber || contact.phone_number || contact.source || 'Unknown';
            processed.rawPhone = null;
        }

        return processed;
    }

    /**
     * Process message data to add formatted phone numbers
     * @param {Object} message - Message object from database
     * @returns {Object} - Message object with formatted sender info
     */
    static processMessage(message) {
        if (!message) return message;

        const processed = { ...message };

        // Extract phone number from sender field
        let rawPhone = null;
        if (message.sender) {
            rawPhone = this.extractPhoneFromJID(message.sender);
        }

        if (rawPhone) {
            processed.formattedSender = this.formatPhoneNumber(rawPhone);
            processed.rawSender = rawPhone;
        } else {
            // Keep original sender info
            processed.formattedSender = message.sender || 'Unknown';
            processed.rawSender = null;
        }

        return processed;
    }

    /**
     * Resolve contact name using WhatsApp bot instance
     * @param {Object} botInstance - WhatsApp bot instance with sock
     * @param {string} jid - WhatsApp JID
     * @returns {Promise<string|null>} - Contact name or null
     */
    static async resolveContactName(botInstance, jid) {
        if (!botInstance?.sock || !jid) {
            return null;
        }

        try {
            const sock = botInstance.sock;

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

            return null;
        } catch (error) {
            logger.error('Failed to resolve contact name:', error);
            return null;
        }
    }

    /**
     * Create a proper WhatsApp JID from phone number
     * @param {string} phoneNumber - Phone number
     * @returns {string} - WhatsApp JID
     */
    static createJID(phoneNumber) {
        if (!phoneNumber) return null;
        
        // Clean phone number - remove + prefix and non-digits
        const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
        
        // Build proper WhatsApp ID
        return cleanNumber + '@s.whatsapp.net';
    }
}

module.exports = PhoneUtils;