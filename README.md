# WhatsApp Bot Collector

A comprehensive WhatsApp automation bot built with Node.js and the Baileys library for contact management and status viewing.

## Features

- 🔐 **QR Code Authentication** - Secure login via WhatsApp QR code
- 📱 **Auto Contact Saving** - Automatically saves unsaved numbers that message you
- 👁️ **Status Viewing** - Auto-views and saves WhatsApp statuses to your "Message Yourself" chat
- 🤖 **Command System** - Dot-prefixed commands for easy interaction
- 👥 **Group Contact Extraction** - Save all members from WhatsApp groups
- 💾 **Dual Storage** - Contacts saved in both JSON and CSV formats
- 🔄 **Real-time Sync** - Automatic data persistence and updates

## Commands

All commands start with a dot (.) and are case-insensitive:

- `.menu` - Display all available commands
- `.getcontacts` - Save all group members (group chats only)
- `.contacts` - List all saved contacts
- `.status` - Toggle auto status viewing on/off

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   