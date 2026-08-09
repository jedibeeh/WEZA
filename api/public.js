// api/public.js
// GET /api/public?id=[pattern-id]
// No auth required — returns outreach patterns only.
// Never returns draft, global, or private patterns.

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const result = await sql`
      SELECT id, name, category, visibility, data
      FROM patterns
      WHERE id = ${id}
        AND visibility = 'outreach'
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pattern not found or not publicly available' });
    }

    const r = result.rows[0];
    const pat = {
      id: r.id,
      name: r.name,
      category: r.category,
      ...(r.data || {})
    };

    // Increment play count (non-blocking — ignore failure)
    sql`UPDATE patterns SET data = jsonb_set(
      COALESCE(data, '{}'),
      '{playCount}',
      to_jsonb(COALESCE((data->>'playCount')::int, 0) + 1)
    ) WHERE id = ${id}`.catch(() => {});

    return res.status(200).json(pat);
  } catch (err) {
    console.error('Public pattern error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
