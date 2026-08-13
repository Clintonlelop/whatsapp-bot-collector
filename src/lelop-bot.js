const BaseBot = require('./bot');

const OWNER_NUMBER = '2348160208114';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function jidPhone(value) {
  const text = String(value || '');
  const match = text.match(/(\d+)@s\.whatsapp\.net/);
  return match ? match[1] : null;
}

function usableName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.toLowerCase() === 'unknown') return null;
  return name;
}

class LelopBot extends BaseBot {
  constructor(...args) {
    super(...args);
    this.scanState = { running: false, processed: 0, added: 0, skipped: 0 };
    if (this.commands) this.commands.getGroupContacts = this.scanGroupContacts.bind(this);
  }

  isOwner(message) {
    const candidates = [
      message?.key?.participantAlt,
      message?.key?.participant,
      message?.key?.remoteJidAlt,
      message?.key?.remoteJid,
      message?.participantAlt,
      message?.participant,
    ];

    return candidates.some(candidate => {
      const phone = jidPhone(candidate) || candidate;
      return digits(phone) === OWNER_NUMBER;
    });
  }

  async start(...args) {
    const original = this.handleConnectionUpdate;
    this.handleConnectionUpdate = async update => {
      await original.call(this, update);
      if (update?.connection === 'open') this.emit('connection_state', 'open');
      if (update?.connection === 'close') this.emit('connection_state', 'close');
    };
    try {
      return await super.start(...args);
    } finally {
      this.handleConnectionUpdate = original;
    }
  }

  async resolveLidPhone(participant) {
    if (!participant) return null;
    if (participant.phoneNumber) return digits(participant.phoneNumber);

    const id = participant.id || '';
    if (id.endsWith('@s.whatsapp.net')) return digits(id);

    if (id.endsWith('@lid')) {
      try {
        const store = this.sock?.signalRepository?.getLIDMappingStore?.();
        const pn = await store?.getPNForLID(id.split('@')[0]);
        if (pn) return digits(pn);
      } catch (_) {}
    }

    return null;
  }

  resolveParticipantName(participant, phone) {
    const id = participant?.id;
    const candidates = [
      participant?.name,
      participant?.notify,
      participant?.verifiedName,
      participant?.verifiedBizName,
      id && this.contactNameStore?.get(id),
      id && this.store?.contacts?.[id]?.name,
      id && this.store?.contacts?.[id]?.notify,
      phone && this.store?.contacts?.[`${phone}@s.whatsapp.net`]?.name,
      phone && this.store?.contacts?.[`${phone}@s.whatsapp.net`]?.notify,
    ];

    for (const candidate of candidates) {
      const name = usableName(candidate);
      if (name) return name;
    }

    return null;
  }

  async scanGroupContacts(sock, groupJid) {
    if (this.scanState.running) return '⏳ A contact scan is already running.';

    this.scanState = { running: true, processed: 0, added: 0, skipped: 0 };

    try {
      const metadata = await sock.groupMetadata(groupJid);
      const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];

      for (const participant of participants) {
        if (!this.scanState.running) break;

        const phone = await this.resolveLidPhone(participant);
        this.scanState.processed++;

        if (!phone) {
          this.scanState.skipped++;
          continue;
        }

        const normalized = `+${phone}`;
        const name = this.resolveParticipantName(participant, phone);

        if (this.contacts.exists(normalized)) {
          this.scanState.skipped++;
          continue;
        }

        await this.contacts.addContact({
          number: normalized,
          name: name || 'Unknown',
        });
        this.scanState.added++;

        if (this.scanState.processed % 25 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      await this.contacts.save();
      const stopped = !this.scanState.running;

      return `${stopped ? '🛑 Scan stopped' : '✅ Scan complete'}\n\n👥 Group: ${metadata?.subject || 'Unknown'}\n📊 Members: ${participants.length}\n➕ Added: ${this.scanState.added}\n⏭️ Skipped: ${this.scanState.skipped}\n🔎 Processed: ${this.scanState.processed}`;
    } catch (error) {
      return `❌ Scan failed: ${error.message}`;
    } finally {
      this.scanState.running = false;
    }
  }

  stopScan() {
    if (!this.scanState.running) return false;
    this.scanState.running = false;
    return true;
  }

  async getName(jid) {
    const phone = digits(jidPhone(jid) || jid);
    const direct = this.resolveParticipantName({ id: jid }, phone);
    return direct || (phone ? `+${phone}` : String(jid || 'Unknown'));
  }
}

module.exports = LelopBot;
