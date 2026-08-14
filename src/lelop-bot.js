const BaseBot = require('./bot');
const { detectPhoneNumbers } = require('./services/phone-detector');

const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '2348160208114').replace(/\D/g, '');

function digits(value) { return String(value || '').replace(/\D/g, ''); }
function jidPhone(value) {
  const match = String(value || '').match(/(\d+)@s\.whatsapp\.net/);
  return match ? match[1] : null;
}
function usableName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.toLowerCase() !== 'unknown' ? name : null;
}

class LelopBot extends BaseBot {
  constructor(...args) {
    super(...args);
    this.scanState = { running: false, processed: 0, added: 0, updated: 0, skipped: 0, group: null };
    this.autoSaveContacts = true;
    if (this.commands) this.commands.getGroupContacts = this.scanGroupContacts.bind(this);
  }

  isOwner(message) {
    const candidates = [
      message?.key?.participantAlt,
      message?.key?.participant,
      message?.key?.remoteJidAlt,
      message?.key?.remoteJid,
      message?.participantAlt,
      message?.participant
    ];
    return candidates.some(candidate => {
      const phone = jidPhone(candidate) || (String(candidate || '').includes('@') ? null : candidate);
      return digits(phone) === OWNER_NUMBER;
    });
  }

  async resolveLidPhone(participant) {
    if (!participant) return null;
    if (participant.phoneNumber) return digits(participant.phoneNumber);
    const id = participant.id || '';
    if (id.endsWith('@s.whatsapp.net')) return digits(id);
    if (id.endsWith('@lid')) {
      try {
        const mapping = this.sock?.signalRepository?.getLIDMappingStore?.();
        const pn = await mapping?.getPNForLID(id.split('@')[0]);
        if (pn) return digits(pn);
      } catch (_) {}
    }
    return null;
  }

  resolveParticipantName(participant, phone) {
    const id = participant?.id;
    const phoneJid = phone ? `${phone}@s.whatsapp.net` : null;
    const candidates = [
      participant?.name,
      participant?.notify,
      participant?.verifiedName,
      participant?.verifiedBizName,
      id && this.contactNameStore?.get(id),
      id && this.store?.contacts?.[id]?.name,
      id && this.store?.contacts?.[id]?.notify,
      phoneJid && this.contactNameStore?.get(phoneJid),
      phoneJid && this.store?.contacts?.[phoneJid]?.name,
      phoneJid && this.store?.contacts?.[phoneJid]?.notify
    ];
    for (const candidate of candidates) {
      const name = usableName(candidate);
      if (name) return name;
    }
    return null;
  }

  async resolveMessagePhone(message) {
    const key = message?.key || {};
    const direct = key.participantAlt || key.remoteJidAlt || key.participant || key.remoteJid;
    if (!direct) return null;
    if (String(direct).endsWith('@lid')) {
      const phone = await this.resolveLidPhone({ id: direct });
      return phone ? `+${phone}` : null;
    }
    const phone = jidPhone(direct);
    return phone ? `+${phone}` : null;
  }

  async handleMessages(update) {
    try {
      for (const message of (update?.messages || [])) {
        if (!message?.message || message.key?.remoteJid === 'status@broadcast') continue;
        const text = this.extractMessageText(message);
        const remoteJid = message.key?.remoteJid || '';
        const isGroup = remoteJid.endsWith('@g.us');

        if (text && text.trim().startsWith('.')) {
          await this.handleCommand(message, text, isGroup);
          continue;
        }

        if (this.autoSaveContacts && text) await this.handlePhoneNumberDetection(message, text);

        if (!message.key?.fromMe && !isGroup) {
          const sender = await this.resolveMessagePhone(message);
          if (sender && !this.contacts.exists(sender)) {
            const name = usableName(message.pushName) || usableName(this.contactNameStore?.get(remoteJid)) || 'Unknown';
            await this.contacts.addContact({ number: sender, name, addedDate: new Date().toISOString(), source: 'auto_message' });
          }
        }
      }
    } catch (error) {
      console.error('LELOP message handler failed:', error);
    }
  }

  async handlePhoneNumberDetection(message, messageText) {
    const detected = detectPhoneNumbers(messageText || '');
    for (const number of detected) {
      const normalized = String(number).trim();
      if (!normalized || this.contacts.exists(normalized)) continue;
      await this.contacts.addContact({
        number: normalized,
        name: usableName(message.pushName) || 'Unknown',
        addedDate: new Date().toISOString(),
        source: 'message_detection',
        messageContext: String(messageText).slice(0, 200)
      });
    }
  }

  async handleCommand(message, messageText, isGroup) {
    const raw = String(messageText || '').trim();
    const command = (raw.split(/\s+/)[0] || '').toLowerCase();
    const remoteJid = message.key.remoteJid;

    if (!this.isOwner(message)) {
      console.log(`Blocked unauthorized command ${command} from ${remoteJid}`);
      return;
    }

    if (command === '.stopscan' || command === '.stop-scan') {
      const stopped = this.stopScan();
      await this.sock.sendMessage(remoteJid, { text: stopped ? '🛑 Contact scan stopped. Contacts already collected were kept.' : 'ℹ️ No contact scan is currently running.' });
      return;
    }

    if (command === '.clearcontacts' || command === '.deletecontacts' || command === '.resetcontacts') {
      await this.contacts.clearAll();
      await this.sock.sendMessage(remoteJid, { text: '🗑️ All saved contacts have been deleted. The list is ready for a fresh scan.' });
      return;
    }

    if (['.scan', '.scanall', '.scanpreview', '.getcontacts'].includes(command)) {
      if (!isGroup) {
        await this.sock.sendMessage(remoteJid, { text: '❌ Use this command inside the WhatsApp group you want to scan.' });
        return;
      }
      if (command === '.scanpreview') {
        const metadata = await this.sock.groupMetadata(remoteJid);
        await this.sock.sendMessage(remoteJid, { text: `🔎 *Scan preview*\n\n👥 ${metadata?.subject || 'Group'}\n👤 Members: ${metadata?.participants?.length || 0}\n\nUse .scan to collect available phone numbers.` });
        return;
      }
      const response = await this.scanGroupContacts(this.sock, remoteJid);
      await this.sock.sendMessage(remoteJid, { text: response });
      return;
    }

    return super.handleCommand(message, raw, isGroup);
  }

  async scanGroupContacts(sock, groupJid) {
    if (this.scanState.running) return '⏳ A contact scan is already running. Use .stopscan to stop it.';
    this.scanState = { running: true, processed: 0, added: 0, updated: 0, skipped: 0, group: groupJid };
    try {
      const metadata = await sock.groupMetadata(groupJid);
      const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
      for (const participant of participants) {
        if (!this.scanState.running) break;
        const phone = await this.resolveLidPhone(participant);
        this.scanState.processed++;
        if (!phone) { this.scanState.skipped++; continue; }
        const number = `+${phone}`;
        const name = this.resolveParticipantName(participant, phone);
        const existing = this.contacts.getContact(number);

        if (existing) {
          if (name && (!existing.name || String(existing.name).toLowerCase() === 'unknown')) {
            await this.contacts.addContact({ ...existing, number, name }, false);
            this.scanState.updated++;
          } else {
            this.scanState.skipped++;
          }
        } else {
          await this.contacts.addContact({ number, name: name || 'Unknown', addedDate: new Date().toISOString(), source: 'group_scan' }, false);
          this.scanState.added++;
        }
        if (this.scanState.processed % 25 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      await this.contacts.save();
      const stopped = !this.scanState.running;
      return `${stopped ? '🛑 Scan stopped' : '✅ Scan complete'}\n\n👥 Group: ${metadata?.subject || 'Unknown'}\n📊 Members: ${participants.length}\n➕ Added: ${this.scanState.added}\n📝 Names updated: ${this.scanState.updated}\n⏭️ Skipped: ${this.scanState.skipped}\n🔎 Processed: ${this.scanState.processed}`;
    } catch (error) {
      return `❌ Scan failed: ${error.message}`;
    } finally {
      this.scanState.running = false;
      this.scanState.group = null;
    }
  }

  stopScan() {
    if (!this.scanState.running) return false;
    this.scanState.running = false;
    return true;
  }

  async getName(jid) {
    const phone = digits(jidPhone(jid) || jid);
    return this.resolveParticipantName({ id: jid }, phone) || (phone ? `+${phone}` : String(jid || 'Unknown'));
  }
}

module.exports = LelopBot;
