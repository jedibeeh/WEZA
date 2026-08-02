// api/auth.js
// POST /api/auth  { action: 'register'|'login', email, password }
// Returns { token } on success

import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';

export default async function handler(req, res) {
  // CORS headers for same-origin HTML requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password } = req.body || {};
  if (!action || !email || !password) {
    return res.status(400).json({ error: 'action, email and password are required' });
  }
  const emailClean = email.trim().toLowerCase();

  try {
    if (action === 'register') {
      // Check if already exists
      const existing = await sql`SELECT id FROM users WHERE email = ${emailClean}`;
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      const hash = await bcrypt.hash(password, 10);
      const result = await sql`
        INSERT INTO users (email, password_hash, role) VALUES (${emailClean}, ${hash}, 'student') RETURNING id, role
      `;
      const userId = result.rows[0].id;
      const role = result.rows[0].role;
      await sql`
        INSERT INTO user_data (user_id, patterns, active, cfg)
        VALUES (${userId}, '[]', '[]', '{}')
        ON CONFLICT (user_id) DO NOTHING
      `;
      const token = jwt.sign({ userId, email: emailClean, role }, JWT_SECRET, { expiresIn: '90d' });
      return res.status(201).json({ token, email: emailClean, role });
    }

    if (action === 'login') {
      const result = await sql`SELECT id, password_hash, role FROM users WHERE email = ${emailClean}`;
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'No account found with that email' });
      }
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      const role = user.role || 'student';
      const token = jwt.sign({ userId: user.id, email: emailClean, role }, JWT_SECRET, { expiresIn: '90d' });
      return res.status(200).json({ token, email: emailClean, role });
    }

    return res.status(400).json({ error: 'action must be register or login' });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
