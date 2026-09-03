// api/prompts.js
// GET  /api/prompts                  -> list templates
// POST /api/prompts                  -> create a template
// POST /api/prompts?action=update    -> update a template { id, ... }
// POST /api/prompts?action=delete    -> delete a template { id }

import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';

function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { userId, role } = user;

  // Every route on this endpoint is practitioner-only for now. When
  // paid-client access ships, add a role/tier check per-action here
  // rather than loosening this gate.
  if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, type, role, template_text, provider, model, created_at, updated_at
        FROM prompt_templates
        WHERE created_by = ${userId}
        ORDER BY role ASC, created_at ASC
      `;
      return res.status(200).json({ templates: rows.rows });
    }

    if (req.method === 'POST' && req.query.action === 'update') {
      const { id, name, type, role, templateText, provider, model } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`
        UPDATE prompt_templates SET
          name = ${name}, type = ${type}, role = ${role || 'main_script'},
          template_text = ${templateText},
          provider = ${provider || 'gemini'}, model = ${model || 'gemini-3.5-flash'},
          updated_at = NOW()
        WHERE id = ${id} AND created_by = ${userId}
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && req.query.action === 'delete') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM prompt_templates WHERE id = ${id} AND created_by = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      const { name, type, role, templateText, provider, model } = req.body || {};
      if (!name || !type || !templateText) {
        return res.status(400).json({ error: 'name, type and templateText required' });
      }
      if (!['amplify', 'main_script', 'domain_plan'].includes(role)) {
        return res.status(400).json({ error: "role must be 'amplify', 'main_script' or 'domain_plan'" });
      }
      const result = await sql`
        INSERT INTO prompt_templates (name, type, role, template_text, provider, model, created_by)
        VALUES (${name}, ${type}, ${role}, ${templateText}, ${provider || 'gemini'}, ${model || 'gemini-3.5-flash'}, ${userId})
        RETURNING id
      `;
      return res.status(201).json({ ok: true, id: result.rows[0].id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Prompts error:', err);
    return res.status(500).json({ error: err.message });
  }
}
