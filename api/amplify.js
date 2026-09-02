// api/amplify.js
// POST /api/amplify { requestId?, inputText?, targetClientId?, amplifyTemplateId? }
// Practitioner-only. Every generation — client-submitted or practitioner-typed —
// passes through here first. If amplifyTemplateId is omitted, the input passes
// through unchanged ("bare bones"). Either way the result always lands at
// status='awaiting_review' — this endpoint never finalizes a pattern; that's
// /api/generate's job, run only after you've seen and optionally edited the text.

import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

async function callOpenAI(model, systemPrompt, userPrompt, asJson) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      ...(asJson ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.8
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI provider request failed: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

const AMPLIFY_SYSTEM = `You expand a short description of someone's emotional experience into
a fuller, resourced account — surfacing the positive elements, strengths and adaptive
functions present in the experience, without inventing facts that contradict what was
given. Write plain prose only, no headers, no JSON, no commentary. Return only the
expanded text.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { userId, role } = user;
  if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });

  const { requestId, inputText, targetClientId, amplifyTemplateId } = req.body || {};

  try {
    let row;
    if (requestId) {
      const existing = await sql`SELECT * FROM generation_requests WHERE id = ${requestId}`;
      row = existing.rows[0];
      if (!row) return res.status(404).json({ error: 'Request not found' });
    } else {
      if (!inputText || !inputText.trim()) {
        return res.status(400).json({ error: 'inputText is required for a new request' });
      }
      const inserted = await sql`
        INSERT INTO generation_requests (requested_by, target_client_id, input_text, status)
        VALUES (${userId}, ${targetClientId || null}, ${inputText.trim()}, 'requested')
        RETURNING *
      `;
      row = inserted.rows[0];
    }

    let amplifiedText = row.input_text;
    if (amplifyTemplateId) {
      const tplRows = await sql`
        SELECT * FROM prompt_templates
        WHERE id = ${amplifyTemplateId} AND created_by = ${userId} AND role = 'amplify'
      `;
      const template = tplRows.rows[0];
      if (!template) return res.status(404).json({ error: 'Amplify template not found' });
      const filledPrompt = template.template_text.replace('{input}', row.input_text);
      amplifiedText = await callOpenAI(template.model || 'gpt-4.1', AMPLIFY_SYSTEM, filledPrompt, false);
    }

    await sql`
      UPDATE generation_requests SET
        amplify_template_id = ${amplifyTemplateId || null},
        amplified_text = ${amplifiedText},
        status = 'awaiting_review',
        updated_at = NOW()
      WHERE id = ${row.id}
    `;

    return res.status(200).json({ ok: true, requestId: row.id, amplifiedText });

  } catch (err) {
    console.error('Amplify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
