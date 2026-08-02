// api/data.js
// GET  /api/data  → { patterns, active, cfg, updatedAt }
// POST /api/data  { patterns, active, cfg, updatedAt }  → { ok: true }
// Requires Authorization: Bearer <token>

import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';

function getUserFromToken(req) {
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

  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { userId, role } = user;

  try {
    if (req.method === 'GET') {
      // Always fetch this user's own row for active + cfg
      const personalResult = await sql`
        SELECT patterns, active, cfg FROM user_data WHERE user_id = ${userId}
      `;
      if (personalResult.rows.length === 0) {
        await sql`
          INSERT INTO user_data (user_id, patterns, active, cfg)
          VALUES (${userId}, '[]', '[]', '{}')
          ON CONFLICT (user_id) DO NOTHING
        `;
        return res.status(200).json({ patterns: [], active: [], cfg: {}, updatedAt: 0 });
      }
      const personalRow = personalResult.rows[0];

      // Patterns: practitioners serve their own; students get practitioner's patterns
      let patterns = personalRow.patterns || [];
      if (role !== 'practitioner') {
        const r = await sql`
          SELECT ud.patterns FROM user_data ud
          JOIN users u ON u.id = ud.user_id
          WHERE u.role = 'practitioner'
          ORDER BY u.created_at ASC LIMIT 1
        `;
        patterns = r.rows[0]?.patterns || [];
      }

      const cfg = personalRow.cfg || {};
      return res.status(200).json({
        patterns,
        active: personalRow.active || [],
        cfg,
        updatedAt: cfg.updatedAt || 0
      });
    }

    if (req.method === 'POST') {
      const { patterns, active, cfg, updatedAt } = req.body || {};
      const cfgWithTs = { ...(cfg || {}), updatedAt: updatedAt || Date.now() };

      if (role === 'practitioner') {
        // Save everything — patterns, active, cfg
        await sql`
          INSERT INTO user_data (user_id, patterns, active, cfg, updated_at)
          VALUES (${userId}, ${JSON.stringify(patterns || [])}, ${JSON.stringify(active || [])}, ${JSON.stringify(cfgWithTs)}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            patterns   = EXCLUDED.patterns,
            active     = EXCLUDED.active,
            cfg        = EXCLUDED.cfg,
            updated_at = NOW()
        `;
      } else {
        // Students: save only active + cfg, never overwrite patterns
        await sql`
          INSERT INTO user_data (user_id, patterns, active, cfg, updated_at)
          VALUES (${userId}, '[]', ${JSON.stringify(active || [])}, ${JSON.stringify(cfgWithTs)}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            active     = EXCLUDED.active,
            cfg        = EXCLUDED.cfg,
            updated_at = NOW()
        `;
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Data error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
