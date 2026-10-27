// Input sanitization + validation of everything the LLM returns.
// Rule: the LLM is untrusted. Nothing it emits touches GitHub or MySQL unvalidated.

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export function sanitizePrompt(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(CONTROL, '')          // control + bidi-override chars
    .replace(/\s{3,}/g, '  ')
    .trim()
    .slice(0, 4000);
}

export function toSlug(s, max = 24) {
  const slug = String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return slug || 'app';
}

// ---- Generated file manifest -------------------------------------------------
const LIMITS = { maxFiles: 60, maxFileBytes: 200_000, maxTotalBytes: 600_000 };
const PATH_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\-/]{1,160}$/;
const BLOCKED = [
  /^\.github\//i,            // no CI workflows in OUR org (would run with our minutes/secrets)
  /(^|\/)\.env(\.|$)(?!example$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)(id_rsa|.*\.pem|.*\.key)$/i,
  /\.(exe|dll|so|bin|sh|bat|ps1)$/i,
];

export function validateManifest(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.files)) throw badOutput('manifest_shape');
  if (m.files.length === 0 || m.files.length > LIMITS.maxFiles) throw badOutput('file_count');
  let total = 0; const seen = new Set();
  const files = m.files.map((f) => {
    const path = String(f?.path ?? '');
    const content = String(f?.content ?? '');
    if (!PATH_RE.test(path) || BLOCKED.some((r) => r.test(path))) throw badOutput(`path:${path.slice(0, 60)}`);
    if (seen.has(path.toLowerCase())) throw badOutput('dup_path');
    seen.add(path.toLowerCase());
    const bytes = Buffer.byteLength(content);
    if (bytes > LIMITS.maxFileBytes) throw badOutput('file_too_large');
    total += bytes;
    return { path, content };
  });
  if (total > LIMITS.maxTotalBytes) throw badOutput('bundle_too_large');
  // Offline-first contract: every app must ship a manifest + service worker.
  for (const must of ['manifest.webmanifest', 'sw.js', 'index.html']) {
    if (!files.some((f) => f.path.endsWith(must))) throw badOutput(`missing_pwa:${must}`);
  }
  const sql = typeof m.db_schema_sql === 'string' ? m.db_schema_sql.slice(0, 50_000) : '';
  return { files, sql, appName: String(m.app_name || 'app').slice(0, 60) };
}

// Allowlist for generated SQL. It runs as a user scoped ONLY to the new DB,
// so this is defence-in-depth, not the only barrier.
const SQL_ALLOWED = /^(CREATE\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|ALTER\s+TABLE|INSERT\s+INTO)\b/i;
const SQL_FORBIDDEN = /\b(GRANT|REVOKE|DROP\s+DATABASE|CREATE\s+(USER|DATABASE|TRIGGER|PROCEDURE|FUNCTION|EVENT)|INTO\s+OUTFILE|LOAD_FILE|LOAD\s+DATA|SET\s+GLOBAL|USE\s+)/i;

export function splitAndValidateSql(sql) {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  // Split on ';' outside quotes/backticks, so "CREATE ...; DROP ..." on one line can't hide a statement.
  const stmts = []; let cur = '', q = null;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (q) { cur += ch; if (ch === '\\') { cur += stripped[++i] ?? ''; } else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (q) throw badOutput('sql_unterminated_quote');
  if (cur.trim()) stmts.push(cur.trim());
  if (stmts.length > 80) throw badOutput('sql_too_many');
  for (const s of stmts) {
    if (!SQL_ALLOWED.test(s) || SQL_FORBIDDEN.test(s)) throw badOutput(`sql_stmt:${s.slice(0, 40)}`);
  }
  return stmts;
}

function badOutput(code) {
  const e = new Error(`LLM output rejected: ${code}`);
  e.code = 'BAD_LLM_OUTPUT'; e.detail = code;
  return e;
}
