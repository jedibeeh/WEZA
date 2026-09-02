// api/requests.js
// POST /api/requests  { inputText }   -> any signed-in user submits a request
// GET  /api/requests                  -> practitioner: full pending-first queue
//                                         everyone else: only their own requests

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

  try {
    if (req.method === 'POST') {
      const { inputText } = req.body || {};
      if (!inputText || !inputText.trim()) {
        return res.status(400).json({ error: 'inputText is required' });
      }
      // A client-submitted request is implicitly for the submitter — the
      // practitioner picks a target when fulfilling if that ever needs to
      // change, but defaulting to the requester covers the normal case.
      const result = await sql`
        INSERT INTO generation_requests (requested_by, target_client_id, input_text, status)
        VALUES (${userId}, ${userId}, ${inputText.trim()}, 'requested')
        RETURNING id, created_at
      `;
      return res.status(201).json({ ok: true, id: result.rows[0].id });
    }

    if (req.method === 'GET') {
      if (role === 'practitioner') {
        const rows = await sql`
          SELECT gr.id, gr.input_text, gr.status, gr.created_at, gr.updated_at,
                 gr.result_pattern_id, gr.target_client_id,
                 u.name AS client_name, u.email AS client_email
          FROM generation_requests gr
          LEFT JOIN users u ON u.id = gr.target_client_id
          ORDER BY (gr.status = 'requested') DESC, gr.created_at DESC
          LIMIT 100
        `;
        return res.status(200).json({ requests: rows.rows });
      } else {
        const rows = await sql`
          SELECT id, input_text, status, created_at, updated_at, result_pattern_id
          FROM generation_requests
          WHERE requested_by = ${userId}
          ORDER BY created_at DESC
          LIMIT 50
        `;
        return res.status(200).json({ requests: rows.rows });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Requests error:', err);
    return res.status(500).json({ error: err.message });
  }
}
