// api/public.js
// GET /api/public          → all outreach patterns (landing page)
// GET /api/public?id=[id]  → single outreach pattern
// No auth required. Only serves visibility='outreach' patterns.

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id } = req.query;

    if (id) {
      // Single pattern by ID
      const result = await sql`
        SELECT id, name, category, visibility, data
        FROM patterns
        WHERE id = ${id} AND visibility = 'outreach'
      `;
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pattern not found or not publicly available' });
      }
      const r = result.rows[0];
      // Increment play count non-blocking
      sql`UPDATE patterns SET data = jsonb_set(
        COALESCE(data,'{}'), '{playCount}',
        to_jsonb(COALESCE((data->>'playCount')::int,0)+1)
      ) WHERE id = ${id}`.catch(()=>{});
      return res.status(200).json({
        id: r.id, name: r.name, category: r.category,
        ...(r.data || {})
      });
    }

    // All outreach patterns for landing page
    const result = await sql`
      SELECT id, name, category, data
      FROM patterns
      WHERE visibility = 'outreach'
      ORDER BY created_at ASC
    `;
    const patterns = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.data?.description || '',
      // Don't send full script bodies in listing — only on individual fetch
    }));
    return res.status(200).json({ patterns });

  } catch (err) {
    console.error('Public error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
