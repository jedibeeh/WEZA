// api/data.js

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

    // ── GET /api/data?users=1 ─────────────────────────────────────────────────
    if (req.method === 'GET' && req.query.users) {
      if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });
      const rows = await sql`
        SELECT id, name, email FROM users
        WHERE role != 'practitioner'
        ORDER BY COALESCE(NULLIF(name,''), email)
      `;
      return res.status(200).json({ users: rows.rows });
    }

    // ── GET /api/data ─────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      await sql`
        INSERT INTO user_data (user_id, patterns, active, cfg)
        VALUES (${userId}, '[]', '[]', '{}')
        ON CONFLICT (user_id) DO NOTHING
      `;
      const udRow = await sql`SELECT active, cfg FROM user_data WHERE user_id = ${userId}`;
      const { active, cfg } = udRow.rows[0] || { active: [], cfg: {} };

      let patRows;
      if (role === 'practitioner') {
        patRows = await sql`
          SELECT id, name, category, visibility, assigned_users, data
          FROM patterns
          WHERE created_by = ${userId}
          ORDER BY created_at ASC
        `;
      } else {
        const userIdInt = Number(userId);
        const userIdStr = String(userId);
        patRows = await sql`
          SELECT id, name, category, visibility, assigned_users, data
          FROM patterns
          WHERE visibility = 'global'
             OR visibility = 'global+private'
             OR (
               visibility IN ('private', 'global+private')
               AND (
                 assigned_users @> ${JSON.stringify([userIdInt])}::jsonb
                 OR assigned_users @> ${JSON.stringify([userIdStr])}::jsonb
               )
             )
          ORDER BY created_at ASC
        `;
      }

      const patterns = patRows.rows.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        visibility: r.visibility,
        assignedUsers: r.assigned_users || [],
        ...(r.data || {})
      }));

      const cfgObj = cfg || {};
      return res.status(200).json({
        patterns,
        active: active || [],
        cfg: cfgObj,
        updatedAt: cfgObj.updatedAt || 0
      });
    }

    // ── POST /api/data?action=save_pattern ────────────────────────────────────
    if (req.method === 'POST' && req.query.action === 'save_pattern') {
      if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });
      const { id, name, category, visibility, assignedUsers, main, domains, createdAt, description, showOnLanding } = req.body || {};
      if (!id || !name) return res.status(400).json({ error: 'id and name required' });

      const assignedInts = (assignedUsers || []).map(Number).filter(n => !isNaN(n) && n > 0);
      const dataJson = JSON.stringify({ main, domains, createdAt, description: description || '', showOnLanding: showOnLanding === true });

      // assigned_users column is JSONB — pass as jsonb literal
      await sql`
        INSERT INTO patterns (id, created_by, name, category, visibility, assigned_users, data, updated_at)
        VALUES (
          ${id},
          ${userId},
          ${name},
          ${category || null},
          ${visibility || 'draft'},
          ${JSON.stringify(assignedInts)}::jsonb,
          ${dataJson}::jsonb,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name           = EXCLUDED.name,
          category       = EXCLUDED.category,
          visibility     = EXCLUDED.visibility,
          assigned_users = EXCLUDED.assigned_users,
          data           = EXCLUDED.data,
          updated_at     = NOW()
      `;

      // Auto-opt-in assigned clients
      for (const sid of assignedInts) {
        await sql`
          INSERT INTO user_data (user_id, patterns, active, cfg)
          VALUES (${sid}, '[]', '[]', '{}')
          ON CONFLICT (user_id) DO NOTHING
        `;
        const existing = await sql`SELECT active FROM user_data WHERE user_id = ${sid}`;
        const activeArr = Array.isArray(existing.rows[0]?.active) ? existing.rows[0].active : [];
        const alreadyIn = activeArr.some(a => a.pid === id);
        if (!alreadyIn) {
          const updated = [...activeArr, { pid: id, progress: 0, lastAt: Date.now() }];
          await sql`
            UPDATE user_data
            SET active = ${JSON.stringify(updated)}::jsonb
            WHERE user_id = ${sid}
          `;
        }
      }

      return res.status(200).json({ ok: true });
    }

    // ── POST /api/data?action=delete_pattern ──────────────────────────────────
    if (req.method === 'POST' && req.query.action === 'delete_pattern') {
      if (role !== 'practitioner') return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM patterns WHERE id = ${id} AND created_by = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    // ── POST /api/data (save active + cfg) ────────────────────────────────────
    if (req.method === 'POST') {
      const { active, cfg, updatedAt } = req.body || {};
      const cfgWithTs = { ...(cfg || {}), updatedAt: updatedAt || Date.now() };
      await sql`
        INSERT INTO user_data (user_id, patterns, active, cfg, updated_at)
        VALUES (${userId}, '[]', ${JSON.stringify(active || [])}::jsonb, ${JSON.stringify(cfgWithTs)}::jsonb, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          active     = EXCLUDED.active,
          cfg        = EXCLUDED.cfg,
          updated_at = NOW()
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Data error:', err);
    return res.status(500).json({ error: err.message });
  }
}
