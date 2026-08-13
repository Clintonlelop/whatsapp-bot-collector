const { drizzle } = require('drizzle-orm/neon-http');
const { neon } = require('@neondatabase/serverless');
const { eq, sql } = require('drizzle-orm');
const schema = require('./schema.js');

let db = null;
let dbUnavailableWarned = false;
if (process.env.DATABASE_URL) {
  const connection = neon(process.env.DATABASE_URL);
  db = drizzle(connection, { schema });
} else {
  console.warn('DATABASE_URL not set; database-backed APIs will return empty results');
}

function warnDbUnavailable() {
  if (!dbUnavailableWarned) {
    dbUnavailableWarned = true;
    console.warn('Database operation skipped because DATABASE_URL is not configured');
  }
}

// Database operations for contacts
class ContactDB {
  static async getAllContacts() {
    try {
      if (!db) {
        warnDbUnavailable();
        return [];
      }
      return await db.select().from(schema.contacts).orderBy(schema.contacts.createdAt);
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  }

  static async getContactByPhone(phoneNumber) {
    try {
      if (!db) {
        warnDbUnavailable();
        return null;
      }
      const result = await db.select().from(schema.contacts).where(eq(schema.contacts.phoneNumber, phoneNumber));
      return result[0] || null;
    } catch (error) {
      console.error('Error getting contact by phone:', error);
      return null;
    }
  }

  static async createContact(data) {
    try {
      if (!db) {
        warnDbUnavailable();
        return null;
      }
      const result = await db.insert(schema.contacts).values({
        phoneNumber: data.phoneNumber,
        name: data.name || null,
        source: data.source,
        messageContext: data.messageContext,
        saved: data.saved || false,
      }).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating contact:', error);
      return null;
    }
  }

  static async createMessage(data) {
    try {
      if (!db) {
        warnDbUnavailable();
        return null;
      }
      const result = await db.insert(schema.messages).values({
        sender: data.sender,
        content: data.content,
        phoneNumbersDetected: data.phoneNumbersDetected || [],
      }).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating message:', error);
      return null;
    }
  }

  static async getRecentMessages(limit = 50) {
    try {
      if (!db) {
        warnDbUnavailable();
        return [];
      }
      return await db.select().from(schema.messages)
        .orderBy(schema.messages.createdAt)
        .limit(limit);
    } catch (error) {
      console.error('Error getting recent messages:', error);
      return [];
    }
  }

  static async getAnalytics() {
    try {
      if (!db) {
        warnDbUnavailable();
        return {
          totalContacts: 0,
          totalMessages: 0,
          newContactsToday: 0,
          detectedNumbers: 0,
        };
      }
      const totalContacts = await db.select({ count: sql`count(*)` }).from(schema.contacts);
      const totalMessages = await db.select({ count: sql`count(*)` }).from(schema.messages);
      const detectedNumbers = await db.select({ count: sql`coalesce(sum(jsonb_array_length(${schema.messages.phoneNumbersDetected})), 0)` }).from(schema.messages);
      
      // Get today's new contacts
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newContactsToday = await db.select({ count: sql`count(*)` })
        .from(schema.contacts)
        .where(sql`${schema.contacts.createdAt} >= ${today}`);

      return {
        totalContacts: parseInt(totalContacts[0]?.count || 0),
        totalMessages: parseInt(totalMessages[0]?.count || 0),
        newContactsToday: parseInt(newContactsToday[0]?.count || 0),
        detectedNumbers: parseInt(detectedNumbers[0]?.count || 0),
      };
    } catch (error) {
      console.error('Error getting analytics:', error);
      return {
        totalContacts: 0,
        totalMessages: 0,
        newContactsToday: 0,
        detectedNumbers: 0,
      };
    }
  }

  static async markContactSaved(contactId) {
    try {
      if (!db) {
        warnDbUnavailable();
        return null;
      }
      const result = await db
        .update(schema.contacts)
        .set({ saved: true, updatedAt: new Date() })
        .where(eq(schema.contacts.id, Number(contactId)))
        .returning();
      return result[0] || null;
    } catch (error) {
      console.error('Error marking contact as saved:', error);
      return null;
    }
  }
}

module.exports = { db, ContactDB };
