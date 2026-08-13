const fs = require('fs');
const path = require('path');

// Lightweight startup checks. This does not alter WhatsApp credentials.
const root = path.join(__dirname, '..');
const authDir = path.join(root, 'auth_info_baileys');
const dataDir = path.join(root, 'data');
const databaseDir = path.join(root, 'database');

for (const dir of [authDir, dataDir, databaseDir]) {
    fs.mkdirSync(dir, { recursive: true });
}

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production. Refusing to start with the development JWT secret.');
}

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
    console.warn('⚠️ ADMIN_PASSWORD is not set. Password fallback should remain disabled in production.');
}

console.log('✅ Startup preflight passed');
