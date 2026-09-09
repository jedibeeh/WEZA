// api/playback.js
// POST /api/playback { patternId, patternName } -> any signed-in user logs a play
// GET  /api/playback                              -> practitioner-only aggregated stats

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
      const { patternId, patternName } = req.body || {};
      if (!patternId || !patternName) {
        return res.status(400).json({ error: 'patternId and patternName are required' });
      }
      await sql`
        INSERT INTO playback_events (user_id, pattern_id, pattern_name)
        VALUES (${userId}, ${patternId}, ${patternName})
      `;
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'GET') {
      if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });

      const [topPatterns, topUsers, recent, totals] = await Promise.all([
        sql`
          SELECT pattern_id, pattern_name, COUNT(*)::int AS play_count
          FROM playback_events
          GROUP BY pattern_id, pattern_name
          ORDER BY play_count DESC
          LIMIT 10
        `,
        sql`
          SELECT pe.user_id, u.name, u.email, COUNT(*)::int AS play_count
          FROM playback_events pe
          LEFT JOIN users u ON u.id = pe.user_id
          GROUP BY pe.user_id, u.name, u.email
          ORDER BY play_count DESC
          LIMIT 10
        `,
        sql`
          SELECT pe.pattern_name, pe.played_at, u.name, u.email
          FROM playback_events pe
          LEFT JOIN users u ON u.id = pe.user_id
          ORDER BY pe.played_at DESC
          LIMIT 30
        `,
        sql`
          SELECT COUNT(*)::int AS total_plays, COUNT(DISTINCT user_id)::int AS unique_listeners
          FROM playback_events
        `
      ]);

      return res.status(200).json({
        topPatterns: topPatterns.rows,
        topUsers: topUsers.rows,
        recent: recent.rows,
        totals: totals.rows[0] || { total_plays: 0, unique_listeners: 0 }
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Playback error:', err);
    return res.status(500).json({ error: err.message });
  }
}
