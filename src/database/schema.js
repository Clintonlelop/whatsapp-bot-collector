const { pgTable, text, timestamp, integer, boolean, serial, jsonb } = require('drizzle-orm/pg-core');

const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  phoneNumber: text('phone_number').notNull().unique(),
  name: text('name'),
  source: text('source'), // WhatsApp ID who sent the message containing this number
  messageContext: text('message_context'), // The message that contained this number
  saved: boolean('saved').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  phoneNumbersDetected: jsonb('phone_numbers_detected').$type(), // Array of detected phone numbers
  createdAt: timestamp('created_at').defaultNow(),
});

const analytics = pgTable('analytics', {
  id: serial('id').primaryKey(),
  totalMessages: integer('total_messages').default(0),
  totalContacts: integer('total_contacts').default(0),
  newContactsToday: integer('new_contacts_today').default(0),
  lastUpdated: timestamp('last_updated').defaultNow(),
});

const whatsappConnection = pgTable('whatsapp_connection', {
  id: serial('id').primaryKey(),
  status: text('status').notNull(), // 'connected', 'connecting', 'disconnected'
  qrCode: text('qr_code'),
  lastConnected: timestamp('last_connected'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

module.exports = {
  contacts,
  messages,
  analytics,
  whatsappConnection
};