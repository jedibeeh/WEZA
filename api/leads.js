// api/leads.js
// POST /api/leads                    -> PUBLIC, no auth. Cold-traffic submission from /start.html
// GET  /api/leads                    -> practitioner-only, list leads
// POST /api/leads?action=contacted   -> practitioner-only, mark a lead contacted
// POST /api/leads?action=delete      -> practitioner-only, remove a lead
//
// This is the only endpoint in the app that accepts writes with no auth at
// all, since the whole point is capturing people who don't have an account
// yet. Kept deliberately narrow: it can only ever insert a lead row, nothing
// else, and a honeypot field quietly no-ops bot submissions rather than
// erroring (which would just teach a bot the field name is the trap).

import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Best-effort notification — a failure here (missing key, Resend outage,
// no practitioner row yet) must never turn a successfully-saved lead into
// a 500 for the visitor. Always called with its own try/catch around it.
async function notifyPractitioner(lead) {
  if (!RESEND_API_KEY) return; // not configured — silently skip
  const rows = await sql`SELECT email FROM users WHERE role = 'practitioner' LIMIT 1`;
  const to = rows.rows[0]?.email;
  if (!to) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'WEZA <onboarding@resend.dev>',
      to,
      subject: `New lead: ${lead.name}`,
      text: `${lead.name} (${lead.email}) submitted a request on /start.html:\n\n"${lead.situation}"\n\n${lead.tried ? `What they've already tried: "${lead.tried}"\n\n` : ''}Review it: https://weza-sigma.vercel.app/create.html`
    })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── PUBLIC: submit a lead ────────────────────────────────────────────────
    if (req.method === 'POST' && !req.query.action) {
      const { name, email, situation, tried, website } = req.body || {};
      // Honeypot — a real visitor never sees or fills this field. Pretend
      // success so a bot has no signal that it was caught.
      if (website) return res.status(201).json({ ok: true });

      if (!name?.trim() || !email?.trim() || !situation?.trim()) {
        return res.status(400).json({ error: 'name, email and situation are required' });
      }
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
      if (!emailOk) return res.status(400).json({ error: 'Please enter a valid email address' });

      const trimmed = {
        name: name.trim().slice(0,200),
        email: email.trim().slice(0,200),
        situation: situation.trim().slice(0,5000),
        tried: tried?.trim().slice(0,5000) || null
      };
      await sql`
        INSERT INTO leads (name, email, situation, tried)
        VALUES (${trimmed.name}, ${trimmed.email}, ${trimmed.situation}, ${trimmed.tried})
      `;
      // Lead is safely saved regardless of what happens below.
      try { await notifyPractitioner(trimmed); } catch (e) { console.error('Lead notification failed:', e); }
      return res.status(201).json({ ok: true });
    }

    // Everything below is practitioner-only.
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, email, situation, tried, status, created_at
        FROM leads
        ORDER BY (status = 'new') DESC, created_at DESC
        LIMIT 100
      `;
      return res.status(200).json({ leads: rows.rows });
    }

    if (req.method === 'POST' && req.query.action === 'contacted') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE leads SET status = 'contacted' WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && req.query.action === 'delete') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM leads WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Leads error:', err);
    return res.status(500).json({ error: err.message });
  }
}
