// api/public.js
// GET /api/public          → all public patterns (outreach OR showOnLanding)
// GET /api/public?id=[id]  → single public pattern with full script
// No auth required.

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
      // Single pattern — serve full data including scripts
      const result = await sql`
        SELECT id, name, category, visibility, data
        FROM patterns
        WHERE id = ${id}
          AND (
            visibility = 'outreach'
            OR (data->>'showOnLanding')::boolean = true
          )
      `;
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pattern not found or not publicly available' });
      }
      const r = result.rows[0];
      // Non-blocking play count increment
      sql`UPDATE patterns SET data = jsonb_set(
        COALESCE(data,'{}'), '{playCount}',
        to_jsonb(COALESCE((data->>'playCount')::int,0)+1)
      ) WHERE id = ${id}`.catch(()=>{});
      return res.status(200).json({
        id: r.id, name: r.name, category: r.category,
        visibility: r.visibility,
        ...(r.data || {})
      });
    }

    // Listing — metadata only (no script bodies for performance)
    const result = await sql`
      SELECT id, name, category, visibility,
             data->>'description' as description
      FROM patterns
      WHERE visibility = 'outreach'
         OR (data->>'showOnLanding')::boolean = true
      ORDER BY category ASC NULLS LAST, name ASC
    `;
    const patterns = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      visibility: r.visibility,
      description: r.description || ''
    }));
    return res.status(200).json({ patterns });

  } catch (err) {
    console.error('Public error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
