// api/generate.js
// POST /api/generate { requestId, amplifiedText, mainScriptTemplateId, domainPlanTemplateId }
// Practitioner-only. Always runs after /api/amplify — requestId must already be
// at status='awaiting_review'. amplifiedText is whatever the practitioner has
// reviewed and possibly edited in the UI, NOT necessarily what /api/amplify
// originally produced, so it's taken fresh from the request body every time.
//
// Runs the main script template once for the main session, then the domain
// plan template once to outline domains, then the SAME main script template
// again per domain (reused, not a separate role) to write each domain's script.
// Result is saved as a draft pattern — visibility defaults to 'draft', which
// is already invisible to everyone but its creator via /api/data's existing
// visibility rules, so no separate approval flag is needed.

import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'weza-change-this-secret-in-vercel-env';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Testing on Gemini for now — see the matching note in api/amplify.js.
async function callGeminiJson(model, systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI provider request failed: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(raw);
}

const MAIN_SCRIPT_SYSTEM = `You write one guided-audio somatic integration script for the WEZA
method, calm and second person, no stage directions. Return ONLY a JSON object, no markdown
fences: { "title": "short title", "body": "the full spoken script" }`;

const DOMAIN_PLAN_SYSTEM = `You break a client's experience into 2 to 5 distinct emotional
domains worth separate guided sessions. Return ONLY a JSON object, no markdown fences:
{ "domains": [ { "title": "short domain title", "brief": "what this domain's script should cover" } ] }`;

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

  const { requestId, amplifiedText, mainScriptTemplateId, domainPlanTemplateId } = req.body || {};
  if (!requestId || !amplifiedText || !mainScriptTemplateId || !domainPlanTemplateId) {
    return res.status(400).json({ error: 'requestId, amplifiedText, mainScriptTemplateId and domainPlanTemplateId are all required' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
  }

  try {
    const reqRows = await sql`SELECT * FROM generation_requests WHERE id = ${requestId}`;
    const reqRow = reqRows.rows[0];
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const [mainTplRows, domainTplRows] = await Promise.all([
      sql`SELECT * FROM prompt_templates WHERE id = ${mainScriptTemplateId} AND created_by = ${userId} AND role = 'main_script'`,
      sql`SELECT * FROM prompt_templates WHERE id = ${domainPlanTemplateId} AND created_by = ${userId} AND role = 'domain_plan'`
    ]);
    const mainTpl = mainTplRows.rows[0];
    const domainTpl = domainTplRows.rows[0];
    if (!mainTpl) return res.status(404).json({ error: 'Main script template not found' });
    if (!domainTpl) return res.status(404).json({ error: 'Domain plan template not found' });

    await sql`UPDATE generation_requests SET status='generating', amplified_text=${amplifiedText}, main_script_template_id=${mainScriptTemplateId}, domain_plan_template_id=${domainPlanTemplateId}, updated_at=NOW() WHERE id=${requestId}`;

    // Main session script
    const mainPrompt = mainTpl.template_text.replace('{input}', amplifiedText);
    const mainResult = await callGeminiJson(mainTpl.model || 'gemini-3.5-flash', MAIN_SCRIPT_SYSTEM, mainPrompt);
    if (!mainResult?.body) throw new Error('Main script prompt did not return a body');

    // Domain plan
    const domainPlanPrompt = domainTpl.template_text.replace('{input}', amplifiedText);
    const planResult = await callGeminiJson(domainTpl.model || 'gemini-3.5-flash', DOMAIN_PLAN_SYSTEM, domainPlanPrompt);
    const domainOutlines = Array.isArray(planResult?.domains) ? planResult.domains : [];
    if (domainOutlines.length === 0) throw new Error('Domain plan prompt returned no domains');

    // Domain scripts — main script template reused, once per domain outline
    const domains = [];
    for (const outline of domainOutlines) {
      const domainInput = `${outline.title}: ${outline.brief}`;
      const domainPromptText = mainTpl.template_text.replace('{input}', domainInput);
      const domainResult = await callGeminiJson(mainTpl.model || 'gemini-3.5-flash', MAIN_SCRIPT_SYSTEM, domainPromptText);
      domains.push({ title: outline.title, body: domainResult?.body || '' });
    }

    const patternId = 'p' + Date.now();
    const dataJson = JSON.stringify({
      main: { title: mainResult.title || 'Main session', body: mainResult.body },
      domains,
      createdAt: Date.now(),
      description: '',
      showOnLanding: false
    });

    // visibility intentionally omitted -> defaults to 'draft'.
    await sql`
      INSERT INTO patterns (id, created_by, name, category, assigned_users, data)
      VALUES (${patternId}, ${userId}, ${mainResult.title || 'Untitled pattern'}, '[]'::jsonb, '[]'::jsonb, ${dataJson}::jsonb)
    `;

    await sql`
      UPDATE generation_requests
      SET status='draft_ready', result_pattern_id=${patternId}, updated_at=NOW()
      WHERE id=${requestId}
    `;

    return res.status(200).json({
      ok: true,
      patternId,
      name: mainResult.title || 'Untitled pattern',
      domainCount: domains.length
    });

  } catch (err) {
    console.error('Generate error:', err);
    try { await sql`UPDATE generation_requests SET status='failed', error=${String(err.message).slice(0,500)}, updated_at=NOW() WHERE id=${requestId}`; } catch {}
    return res.status(500).json({ error: err.message });
  }
}
