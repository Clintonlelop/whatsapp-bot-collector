const csvWriter = require('csv-writer');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

class CsvUtils {
    static async exportContacts(contacts, filePath) {
        try {
            const csvWriterInstance = csvWriter.createObjectCsvWriter({
                path: filePath,
                header: [
                    { id: 'number', title: 'Phone Number' },
                    { id: 'name', title: 'Contact Name' },
                    { id: 'addedDate', title: 'Date Added' },
                    { id: 'source', title: 'Source' },
                    { id: 'groupId', title: 'Group ID' }
                ]
            });

            await csvWriterInstance.writeRecords(contacts);
            logger.info(`Exported ${contacts.length} contacts to CSV: ${filePath}`);
            return true;
        } catch (error) {
            logger.error('Failed to export contacts to CSV:', error);
            return false;
        }
    }

    static async importContacts(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error('CSV file not found');
            }

            // Read CSV file (simplified implementation)
            const csvContent = await fs.readFile(filePath, 'utf8');
            const lines = csvContent.split('\n');
            const headers = lines[0].split(',');
            const contacts = [];

            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                    const values = lines[i].split(',');
                    const contact = {};
                    
                    headers.forEach((header, index) => {
                        contact[header.trim().replace(/"/g, '')] = values[index]?.trim().replace(/"/g, '') || '';
                    });
                    
                    contacts.push(contact);
                }
            }

            logger.info(`Imported ${contacts.length} contacts from CSV: ${filePath}`);
            return contacts;
        } catch (error) {
            logger.error('Failed to import contacts from CSV:', error);
            return [];
        }
    }

    static async createBackup(data, backupDir, filename) {
        try {
            await fs.ensureDir(backupDir);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `${filename}-${timestamp}.json`);
            
            await fs.writeJson(backupPath, data, { spaces: 2 });
            logger.info(`Created backup: ${backupPath}`);
            return backupPath;
        } catch (error) {
            logger.error('Failed to create backup:', error);
            return null;
        }
    }
}

module.exports = CsvUtils;
