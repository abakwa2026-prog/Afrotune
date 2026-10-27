import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { v1 } from './routes/v1.js';
import { webhooks } from './routes/webhooks.js';
import { recoverStaleJobs } from './services/pipeline.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Cloudflare -> real client IP via X-Forwarded-For
app.use(helmet());

app.use('/webhooks', webhooks);                 // raw body, mounted BEFORE json parser
app.use(express.json({ limit: '32kb' }));
app.use('/v1', v1);
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error('unhandled', err.code || '', err.message);
  res.status(500).json({ error: 'internal_error' }); // never leak internals
});

await recoverStaleJobs();
app.listen(config.port, () => console.log(`yanga-core listening on :${config.port}`));
