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

1. Extract the project files to your server
2. Navigate to the project directory:
   ```bash
   cd whatsapp-bot-collector
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. Start the bot:
   ```bash
   node index.js
   ```

2. Scan the QR code that appears in the terminal with your WhatsApp

3. The bot will automatically:
   - Save contacts from unsaved numbers that message you
   - View and save WhatsApp statuses to your "Message Yourself" chat
   - Respond to dot commands in any chat

## File Structure

```
whatsapp-bot-collector/
├── index.js              # Main entry point
├── package.json          # Project dependencies
├── src/
│   ├── bot.js            # Main bot logic
│   ├── commands/         # Command handlers
│   ├── storage/          # Contact and status storage
│   └── utils/            # Utility functions
├── data/                 # Storage files (JSON/CSV)
│   ├── contacts.json     # Contacts database
│   ├── contacts.csv      # CSV export
│   └── settings.json     # Bot settings
└── logs/                 # Log files (auto-created)
```

## Storage

- **JSON Storage**: `data/contacts.json` - Main contact database
- **CSV Export**: `data/contacts.csv` - Automatically updated CSV export
- **Settings**: `data/settings.json` - Bot configuration and preferences

## Auto-Features

1. **Contact Auto-Save**: When an unsaved number messages you, their contact info is automatically saved
2. **Status Viewing**: All WhatsApp statuses are automatically viewed and saved to your "Message Yourself" chat
3. **Group Contact Extraction**: Use `.getcontacts` in any group to save all member contacts

## Requirements

- Node.js 16.0.0 or higher
- Active WhatsApp account
- Internet connection

## Troubleshooting

- If the QR code doesn't appear, restart the bot
- Make sure your WhatsApp account is active and not logged in elsewhere
- Check the logs folder for detailed error information
- Ensure all dependencies are properly installed

## Disclaimer

This bot uses WhatsApp's unofficial API. Use at your own risk and ensure compliance with WhatsApp's Terms of Service.