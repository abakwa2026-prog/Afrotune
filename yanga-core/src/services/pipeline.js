// Job pipeline: hold -> generate -> validate -> GitHub -> DB provision -> settle.
// In-process queue (no Redis on shared hosting). Job state lives in MySQL, so a
// restart is recoverable: recoverStaleJobs() fails + releases orphaned holds.
import { pool } from '../db.js';
import { config } from '../config.js';
import { seal } from '../lib/crypto.js';
import { validateManifest, splitAndValidateSql } from '../lib/sanitize.js';
import { resolveRoute, estimateHold, complete } from './llmRouter.js';
import { buildMessages, parseManifest } from './codegen.js';
import { createRepoWithFiles } from './github.js';
import { provisionAppDatabase } from './provisioner.js';
import { hold, settle } from './credits.js';

const setStatus = (id, status, extra = {}) =>
  pool.query('UPDATE generation_jobs SET status=?, error_code=COALESCE(?, error_code) WHERE id=?', [status, extra.error ?? null, id]);

/** Synchronous part (runs inside the HTTP request): route + credit hold. */
export async function admitJob(user, job, preferredProvider) {
  const route = await resolveRoute(user, preferredProvider);
  const messages = buildMessages(job.prompt, { country: user.country_iso2, locale: user.locale });
  const holdAmount = route.route === 'INTERNAL' ? estimateHold(route, messages) : 0n;
  await hold(user.id, job.id, holdAmount); // throws INSUFFICIENT_CREDITS before any spend
  await pool.query('UPDATE generation_jobs SET hold_micro=? WHERE id=?', [holdAmount.toString(), job.id]);
  return { route, messages, holdAmount };
}

/** Async part (queued). */
export async function runJob(user, job, { route, messages, holdAmount }) {
  let charged = 0n;
  try {
    await setStatus(job.id, 'generating');
    let out;
    try {
      out = await complete(route, messages);
    } finally {
      await pool.query(
        `INSERT INTO llm_calls (job_id,user_id,billing_route,provider,model,rate_id,prompt_tokens,cached_tokens,completion_tokens,cost_micro,charged_micro,latency_ms,status,error_code)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [job.id, user.id, route.route, route.provider, route.model, route.rate?.id ?? null,
         out?.usage.prompt ?? 0, out?.usage.cached ?? 0, out?.usage.completion ?? 0,
         (out?.cost ?? 0n).toString(), (out?.charged ?? 0n).toString(), out?.latencyMs ?? 0,
         out ? 'ok' : 'error', out ? null : 'call_failed']);
    }
    // Tokens were consumed: user pays for them even if output is later rejected.
    charged = out.charged + (route.route === 'BYOK' ? config.llm.byokFeeMicro : 0n);
    if (out.finish === 'length') throw Object.assign(new Error('truncated'), { code: 'OUTPUT_TRUNCATED' });

    const { files, sql, appName } = validateManifest(parseManifest(out.text));
    const statements = sql ? splitAndValidateSql(sql) : [];
    files.push({ path: 'schema.sql', content: statements.join(';\n\n') + (statements.length ? ';\n' : '') });

    await setStatus(job.id, 'committing');
    const repoName = `${job.app_slug}-${job.public_id.slice(-6).toLowerCase()}`;
    const repo = await createRepoWithFiles(repoName, appName, files);
    await pool.query("INSERT INTO provisioned_resources (job_id,user_id,kind,identifier) VALUES (?,?,'github_repo',?)",
      [job.id, user.id, repo.fullName]);

    await setStatus(job.id, 'provisioning');
    const dbn = await provisionAppDatabase(statements);
    const s = seal(dbn.password, `db:${dbn.db}`);
    await pool.query(
      "INSERT INTO provisioned_resources (job_id,user_id,kind,identifier,secret_ct,secret_iv,secret_tag) VALUES (?,?,'mysql_db',?,?,?,?)",
      [job.id, user.id, `${dbn.db}|${dbn.user}`, s.ct, s.iv, s.tag]);

    await setStatus(job.id, 'done');
  } catch (e) {
    console.error(`[job ${job.public_id}] ${e.code || 'ERR'}: ${e.message}`); // no prompt/keys in logs
    await setStatus(job.id, 'failed', { error: String(e.code || 'INTERNAL').slice(0, 40) });
  } finally {
    const debited = await settle(user.id, job.id, holdAmount, charged).catch((e) => { console.error('settle_failed', job.id, e.code); return 0n; });
    await pool.query('UPDATE generation_jobs SET charged_micro=? WHERE id=?', [debited.toString(), job.id]);
    route.apiKey = null; // drop decrypted BYOK key reference
  }
}

// ---- Minimal bounded queue -------------------------------------------------
const queue = []; let active = 0;
export function enqueue(task) {
  queue.push(task); pump();
}
function pump() {
  while (active < config.jobConcurrency && queue.length) {
    const t = queue.shift(); active++;
    t().finally(() => { active--; pump(); });
  }
}
export const queueDepth = () => queue.length + active;

/** On boot: anything mid-flight was lost with the process. Fail it and release its hold. */
export async function recoverStaleJobs() {
  const [rows] = await pool.query(
    "SELECT id, user_id, hold_micro FROM generation_jobs WHERE status IN ('queued','generating','committing','provisioning')");
  for (const r of rows) {
    await settle(r.user_id, r.id, BigInt(r.hold_micro), 0n).catch(() => {});
    await setStatus(r.id, 'failed', { error: 'SERVER_RESTART' });
  }
}
