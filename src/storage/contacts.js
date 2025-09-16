const fs = require('fs-extra');
const path = require('path');
const csvWriter = require('csv-writer');
const logger = require('../utils/logger');

class ContactStorage {
    constructor() {
        this.contacts = [];
        this.dataDir = path.join(__dirname, '../../data');
        this.jsonPath = path.join(this.dataDir, 'contacts.json');
        this.csvPath = path.join(this.dataDir, 'contacts.csv');
        this.vcfPath = path.join(this.dataDir, 'contacts.vcf');
        
        // Ensure data directory exists
        fs.ensureDirSync(this.dataDir);
    }

    async load() {
        try {
            if (fs.existsSync(this.jsonPath)) {
                this.contacts = await fs.readJson(this.jsonPath);
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
            // Save to JSON
            await fs.writeJson(this.jsonPath, this.contacts, { spaces: 2 });
            
            // Export to CSV and VCF
            await this.exportToCsv();
            await this.exportToVcf();
            
            logger.info(`Saved ${this.contacts.length} contacts to storage`);
        } catch (error) {
            logger.error('Failed to save contacts:', error);
        }
    }

    async exportToCsv() {
        try {
            const csvWriterInstance = csvWriter.createObjectCsvWriter({
                path: this.csvPath,
                header: [
                    { id: 'number', title: 'Phone Number' },
                    { id: 'name', title: 'Contact Name' },
                    { id: 'addedDate', title: 'Date Added' },
                    { id: 'source', title: 'Source' }
                ]
            });

            await csvWriterInstance.writeRecords(this.contacts);
            logger.info('Contacts exported to CSV successfully');
        } catch (error) {
            logger.error('Failed to export contacts to CSV:', error);
        }
    }

    async exportToVcf() {
        try {
            let vcfContent = '';
            
            this.contacts.forEach(contact => {
                // Simple VCF format with only name and number
                const contactName = contact.name || contact.number;
                vcfContent += `BEGIN:VCARD\n`;
                vcfContent += `VERSION:3.0\n`;
                vcfContent += `FN:${contactName}\n`;
                vcfContent += `TEL:${contact.number}\n`;
                vcfContent += `END:VCARD\n\n`;
            });

            await fs.writeFile(this.vcfPath, vcfContent, 'utf8');
            logger.info('Contacts exported to VCF successfully');
        } catch (error) {
            logger.error('Failed to export contacts to VCF:', error);
        }
    }

    async addContact(contactData) {
        try {
            // Check if contact already exists
            const existingIndex = this.contacts.findIndex(c => c.number === contactData.number);
            
            if (existingIndex >= 0) {
                // Update existing contact
                this.contacts[existingIndex] = { ...this.contacts[existingIndex], ...contactData };
                logger.info(`Updated existing contact: ${contactData.name} (${contactData.number})`);
            } else {
                // Add new contact
                this.contacts.push(contactData);
                logger.info(`Added new contact: ${contactData.name} (${contactData.number})`);
            }
            
            await this.save();
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
                logger.info(`Removed contact: ${number}`);
                return true;
            }
            
            return false;
        } catch (error) {
            logger.error('Failed to remove contact:', error);
            return false;
        }
    }

    async searchContacts(query) {
        const lowercaseQuery = query.toLowerCase();
        return this.contacts.filter(contact => 
            contact.name.toLowerCase().includes(lowercaseQuery) ||
            contact.number.includes(query)
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
