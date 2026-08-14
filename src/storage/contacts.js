const fs = require('fs-extra');
const path = require('path');
const csvWriter = require('csv-writer');
const logger = require('../utils/logger');

function escapeVCardText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

class ContactStorage {
    constructor() {
        this.contacts = [];
        this.dataDir = path.join(__dirname, '../../data');
        this.jsonPath = path.join(this.dataDir, 'contacts.json');
        this.csvPath = path.join(this.dataDir, 'contacts.csv');
        this.vcfPath = path.join(this.dataDir, 'contacts.vcf');
        fs.ensureDirSync(this.dataDir);
    }

    async load() {
        try {
            if (fs.existsSync(this.jsonPath)) {
                const data = await fs.readJson(this.jsonPath);
                this.contacts = Array.isArray(data) ? data : [];
                logger.info(`Loaded ${this.contacts.length} contacts from storage`);
            } else {
                this.contacts = [];
                await this.save();
            }
        } catch (error) {
            logger.error('Failed to load contacts:', error);
            this.contacts = [];
        }
    }

    async save() {
        try {
            await fs.writeJson(this.jsonPath, this.contacts, { spaces: 2 });
            await Promise.all([this.exportToCsv(), this.exportToVcf()]);
            logger.info(`Saved ${this.contacts.length} contacts to storage`);
        } catch (error) {
            logger.error('Failed to save contacts:', error);
            throw error;
        }
    }

    async exportToCsv() {
        const writer = csvWriter.createObjectCsvWriter({
            path: this.csvPath,
            header: [
                { id: 'number', title: 'Phone Number' },
                { id: 'name', title: 'Contact Name' },
                { id: 'addedDate', title: 'Date Added' },
                { id: 'source', title: 'Source' }
            ]
        });
        await writer.writeRecords(this.contacts);
    }

    async exportToVcf() {
        const cards = this.contacts.map(contact => {
            const name = escapeVCardText(contact.name || contact.number);
            const number = String(contact.number || '').trim();
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                'CHARSET:UTF-8',
                `FN:${name}`,
                `N:${name};;;;`,
                `TEL;TYPE=CELL:${number}`,
                'END:VCARD'
            ].join('\r\n');
        });
        await fs.writeFile(this.vcfPath, cards.length ? `${cards.join('\r\n')}\r\n` : '', 'utf8');
    }

    async addContact(contactData, persist = true) {
        try {
            const number = String(contactData?.number || '').trim();
            if (!number) return false;
            const existingIndex = this.contacts.findIndex(c => c.number === number);
            if (existingIndex >= 0) {
                const existing = this.contacts[existingIndex];
                const incomingName = String(contactData.name || '').trim();
                const existingName = String(existing.name || '').trim();
                const shouldUpgradeUnknown = incomingName && incomingName.toLowerCase() !== 'unknown' &&
                    (!existingName || existingName.toLowerCase() === 'unknown');
                this.contacts[existingIndex] = {
                    ...existing,
                    ...contactData,
                    number,
                    name: shouldUpgradeUnknown ? incomingName : (contactData.name || existing.name || 'Unknown')
                };
            } else {
                this.contacts.push({
                    ...contactData,
                    number,
                    name: String(contactData.name || 'Unknown')
                });
            }
            if (persist) await this.save();
            return true;
        } catch (error) {
            logger.error('Failed to add contact:', error);
            return false;
        }
    }

    exists(number) {
        return this.contacts.some(contact => contact.number === number);
    }

    getContact(number) {
        return this.contacts.find(contact => contact.number === number);
    }

    getAllContacts() {
        return [...this.contacts];
    }

    getCount() {
        return this.contacts.length;
    }

    async removeContact(number) {
        try {
            const initialLength = this.contacts.length;
            this.contacts = this.contacts.filter(contact => contact.number !== number);
            if (this.contacts.length < initialLength) {
                await this.save();
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Failed to remove contact:', error);
            return false;
        }
    }

    async searchContacts(query) {
        const q = String(query || '').toLowerCase();
        return this.contacts.filter(contact =>
            String(contact.name || '').toLowerCase().includes(q) ||
            String(contact.number || '').includes(String(query || ''))
        );
    }

    async clearAll() {
        try {
            this.contacts = [];
            await this.save();
            logger.info('All contacts cleared successfully');
            return true;
        } catch (error) {
            logger.error('Failed to clear contacts:', error);
            return false;
        }
    }
}

module.exports = ContactStorage;
