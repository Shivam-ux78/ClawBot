import dns from 'dns/promises';
import net from 'net';

/**
 * Free LinkedIn → email finder. No paid API — guesses the company domain,
 * generates likely name-pattern candidates, and verifies them with a raw
 * SMTP handshake (MX lookup + RCPT TO probe, no message actually sent).
 *
 * Caveats (read before relying on this in production):
 * - Many cloud hosts (Render, AWS, etc.) block outbound port 25, which this
 *   verification step needs. Works fine from a home/office connection or a
 *   VPS with port 25 open; will silently fail to verify anywhere it's blocked.
 * - Catch-all domains (accept any address) make verification unreliable —
 *   detected and flagged, but the guessed email may still be wrong.
 * - Domain guessing is a bare heuristic (company name → companyname.com).
 *   Wrong for any company on a different TLD or a non-obvious domain.
 */

const SMTP_TIMEOUT_MS = 8000;

/** "Acme Inc." / "Acme, LLC" → "acme.com" (bare heuristic, no external lookup). */
export function guessDomain(companyName) {
  if (!companyName) return null;
  const cleaned = companyName
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|group|holdings|technologies|tech)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return cleaned ? `${cleaned}.com` : null;
}

/** Generate likely email candidates for a full name at a domain, most-likely first. */
export function generateEmailCandidates(fullName, domain) {
  if (!fullName || !domain) return [];
  const parts = fullName.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  const first = parts[0].replace(/[^a-z]/g, '');
  const last = parts.length > 1 ? parts[parts.length - 1].replace(/[^a-z]/g, '') : '';
  if (!first) return [];

  const candidates = [];
  const add = (local) => local && candidates.push(`${local}@${domain}`);

  if (last) {
    add(`${first}.${last}`);
    add(`${first}${last}`);
    add(`${first[0]}${last}`);
    add(`${first}.${last[0]}`);
    add(`${last}.${first}`);
  }
  add(first);

  return [...new Set(candidates)];
}

/**
 * Look up the domain's mail server (lowest-priority MX record).
 */
async function resolveMailServer(domain) {
  const records = await dns.resolveMx(domain);
  if (!records?.length) throw new Error(`No MX records for ${domain}`);
  return records.sort((a, b) => a.priority - b.priority)[0].exchange;
}

/**
 * Probe a single address against a mail server with RCPT TO, without sending
 * a message. Returns true if the server accepts the address (250), false if
 * it rejects it (5xx). Throws on connection/timeout failure (undetermined).
 */
function probeAddress(mxHost, address, fromAddress) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(25, mxHost);
    let step = 0;
    let settled = false;
    const lines = [];

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(val);
    };

    const timer = setTimeout(() => finish(reject, new Error('SMTP probe timed out')), SMTP_TIMEOUT_MS);

    socket.on('error', (err) => finish(reject, err));

    socket.on('data', (data) => {
      const text = data.toString();
      lines.push(text);
      const code = parseInt(text.slice(0, 3), 10);

      if (step === 0) {
        socket.write(`EHLO clawbot.local\r\n`);
        step = 1;
      } else if (step === 1) {
        socket.write(`MAIL FROM:<${fromAddress}>\r\n`);
        step = 2;
      } else if (step === 2) {
        socket.write(`RCPT TO:<${address}>\r\n`);
        step = 3;
      } else if (step === 3) {
        socket.write('QUIT\r\n');
        finish(resolve, code === 250);
      }
    });
  });
}

/**
 * Verify a list of candidate emails against their shared domain. Detects
 * catch-all domains (where every address is "accepted") and flags the
 * result as unverified rather than falsely confident.
 * @returns {Promise<{ email: string|null, verified: boolean, catchAll: boolean }>}
 */
export async function verifyEmailCandidates(candidates, { fromAddress = 'verify@makeable.nyc' } = {}) {
  if (!candidates.length) return { email: null, verified: false, catchAll: false };

  const domain = candidates[0].split('@')[1];
  let mxHost;
  try {
    mxHost = await resolveMailServer(domain);
  } catch (err) {
    console.warn(`[EmailFinder] MX lookup failed for ${domain}: ${err.message}`);
    return { email: candidates[0], verified: false, catchAll: false };
  }

  // Catch-all check: a bogus address that shouldn't exist.
  let catchAll = false;
  try {
    const bogus = `no-such-user-${Date.now()}@${domain}`;
    catchAll = await probeAddress(mxHost, bogus, fromAddress);
  } catch {
    // Undetermined — proceed without the catch-all signal.
  }

  if (catchAll) {
    console.log(`[EmailFinder] ${domain} is catch-all — cannot reliably verify, using best guess.`);
    return { email: candidates[0], verified: false, catchAll: true };
  }

  for (const candidate of candidates) {
    try {
      const accepted = await probeAddress(mxHost, candidate, fromAddress);
      if (accepted) {
        return { email: candidate, verified: true, catchAll: false };
      }
    } catch (err) {
      console.warn(`[EmailFinder] Probe failed for ${candidate}: ${err.message}`);
    }
  }

  return { email: null, verified: false, catchAll: false };
}

/**
 * Full pipeline: name + company → best-guess verified email, or null.
 */
export async function findEmail({ fullName, companyName, companyDomain }) {
  const domain = companyDomain || guessDomain(companyName);
  if (!domain) return { email: null, verified: false, catchAll: false, domain: null };

  const candidates = generateEmailCandidates(fullName, domain);
  if (!candidates.length) return { email: null, verified: false, catchAll: false, domain };

  const result = await verifyEmailCandidates(candidates);
  return { ...result, domain };
}
