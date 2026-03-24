import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express, { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { JobQueue } from './queue';
import { PRHandler } from './pr-handler';

// ─── Env validation ───────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!WEBHOOK_SECRET) {
  console.error('[server] WEBHOOK_SECRET env var is required');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('[server] GITHUB_TOKEN env var is required');
  process.exit(1);
}

// ─── Queue + handler ─────────────────────────────────────────────────────────

const queue = new JobQueue(3);
const handler = new PRHandler(queue);
handler.start();

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

// Raw body is required for HMAC signature validation.
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// ─── Signature validation ────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET!);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest('hex')}`;

  try {
    // timingSafeEqual requires equal-length buffers.
    return (
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    );
  } catch {
    return false;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    queue: { pending: queue.queueSize, active: queue.activeCount },
  });
});

app.post('/webhook', (req: Request, res: Response) => {
  try {
    // 1. Validate signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      console.warn('[webhook] Missing X-Hub-Signature-256 header');
      return res.status(401).json({ error: 'Missing signature header' });
    }

    const rawBody = req.body as Buffer;
    if (!verifySignature(rawBody, signature)) {
      console.warn('[webhook] Signature mismatch — ignoring request');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // 3. Only handle pull_request events
    const event = req.headers['x-github-event'] as string | undefined;
    if (event !== 'pull_request') {
      return res.status(200).json({ message: `Event "${event}" ignored` });
    }

    // 4. Only handle opened / synchronize actions
    const action = payload.action as string;
    if (action !== 'opened' && action !== 'synchronize') {
      return res.status(200).json({ message: `Action "${action}" ignored` });
    }

    // 5. Extract PR fields
    const pr = payload.pull_request as Record<string, unknown>;
    const repo = payload.repository as Record<string, unknown>;
    const repoOwner = repo.owner as Record<string, unknown>;
    const prBase = pr.base as Record<string, unknown>;
    const prHead = pr.head as Record<string, unknown>;

    const job = {
      owner: repoOwner.login as string,
      repo: repo.name as string,
      prNumber: pr.number as number,
      prTitle: pr.title as string,
      prBody: (pr.body as string | null) ?? '',
      baseBranch: prBase.ref as string,
      headBranch: prHead.ref as string,
      headSHA: prHead.sha as string,
    };

    console.log(
      `[webhook] Queuing job — PR #${job.prNumber} "${job.prTitle}" in ${job.owner}/${job.repo}`,
    );
    queue.push(job);

    // Return 200 immediately; processing happens asynchronously.
    return res.status(200).json({ message: 'Job queued', prNumber: job.prNumber });
  } catch (err) {
    console.error('[webhook] Unexpected error handling request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Global error handler ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  console.log(`[server] POST /webhook  — GitHub webhook receiver`);
  console.log(`[server] GET  /health   — Health check`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
});

export { app };
