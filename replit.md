# Overview

WhatsApp Bot Collector is a comprehensive automation bot built with Node.js that integrates with WhatsApp Web through the Baileys library. The bot provides contact management and status viewing capabilities, automatically saving unsaved contacts and viewing WhatsApp statuses. It features a command-based interface with dot-prefixed commands and supports dual storage formats (JSON and CSV) for contact data persistence.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Architecture
The application follows a modular Node.js architecture with a main entry point (`index.js`) that initializes and starts the WhatsApp bot service. The bot is encapsulated in a `WhatsAppBot` class located in the `src/bot` directory, providing clean separation of concerns and maintainable code structure.

## WhatsApp Integration
Uses the Baileys library (`@whiskeysockets/baileys`) for WhatsApp Web API integration, providing real-time messaging capabilities, QR code authentication, and access to WhatsApp features like status viewing and contact management. The authentication system stores session data in the `auth_info_baileys` directory with encrypted credentials and sync keys.

## Command System
Implements a dot-prefixed command parser that processes user commands in real-time. Commands are case-insensitive and include `.menu`, `.getcontacts`, `.contacts`, and `.status`, providing an intuitive interface for bot interaction.

## Data Storage
Employs a dual storage strategy using both JSON and CSV formats for contact persistence. This approach ensures data compatibility across different use cases - JSON for programmatic access and CSV for human-readable exports and spreadsheet compatibility.

## Logging System
Utilizes Pino logger with pretty printing capabilities for structured logging, providing detailed application monitoring and debugging capabilities with configurable log levels and formatting.

## Contact Management
Automatically detects and saves unsaved contacts that send messages to the bot. Includes group member extraction functionality that can save all members from WhatsApp groups when triggered via commands.

## Status Automation
Features automatic WhatsApp status viewing and saving capabilities, forwarding viewed statuses to the user's "Message Yourself" chat for convenient access and archival.

# External Dependencies

## WhatsApp Integration
- **@whiskeysockets/baileys**: Core WhatsApp Web API library for real-time messaging and authentication
- **qrcode**: QR code generation for WhatsApp authentication flow
- **qrcode-terminal**: Terminal-based QR code display for CLI authentication

## Data Processing
- **csv-writer**: CSV file generation and writing for contact export functionality
- **fs-extra**: Enhanced file system operations with promise support for data persistence

## Logging and Monitoring
- **pino**: High-performance JSON logger for structured application logging
- **pino-pretty**: Human-readable log formatting for development and debugging

## Authentication Storage
The bot maintains persistent authentication through encrypted session files in the `auth_info_baileys` directory, including credentials, pre-keys, and synchronization data for seamless WhatsApp Web integration.

## Phone Configuration
Uses a text-based configuration file (`phone_config.txt`) for storing the associated phone number, enabling easy deployment and configuration management.