"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const queue_1 = require("./queue");
const pr_handler_1 = require("./pr-handler");
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
const queue = new queue_1.JobQueue(3);
const handler = new pr_handler_1.PRHandler(queue);
handler.start();
// ─── Express app ─────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
exports.app = app;
// Raw body is required for HMAC signature validation.
app.use(express_1.default.raw({ type: 'application/json', limit: '10mb' }));
// ─── Signature validation ────────────────────────────────────────────────────
function verifySignature(rawBody, signature) {
    const hmac = crypto_1.default.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest('hex')}`;
    try {
        // timingSafeEqual requires equal-length buffers.
        return (expected.length === signature.length &&
            crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)));
    }
    catch {
        return false;
    }
}
// ─── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        queue: { pending: queue.queueSize, active: queue.activeCount },
    });
});
app.post('/webhook', (req, res) => {
    try {
        // 1. Validate signature
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            console.warn('[webhook] Missing X-Hub-Signature-256 header');
            return res.status(401).json({ error: 'Missing signature header' });
        }
        const rawBody = req.body;
        if (!verifySignature(rawBody, signature)) {
            console.warn('[webhook] Signature mismatch — ignoring request');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        // 2. Parse payload
        let payload;
        try {
            payload = JSON.parse(rawBody.toString('utf-8'));
        }
        catch {
            return res.status(400).json({ error: 'Invalid JSON payload' });
        }
        // 3. Only handle pull_request events
        const event = req.headers['x-github-event'];
        if (event !== 'pull_request') {
            return res.status(200).json({ message: `Event "${event}" ignored` });
        }
        // 4. Only handle opened / synchronize actions
        const action = payload.action;
        if (action !== 'opened' && action !== 'synchronize') {
            return res.status(200).json({ message: `Action "${action}" ignored` });
        }
        // 5. Extract PR fields
        const pr = payload.pull_request;
        const repo = payload.repository;
        const repoOwner = repo.owner;
        const prBase = pr.base;
        const prHead = pr.head;
        const job = {
            owner: repoOwner.login,
            repo: repo.name,
            prNumber: pr.number,
            prTitle: pr.title,
            prBody: pr.body ?? '',
            baseBranch: prBase.ref,
            headBranch: prHead.ref,
            headSHA: prHead.sha,
        };
        console.log(`[webhook] Queuing job — PR #${job.prNumber} "${job.prTitle}" in ${job.owner}/${job.repo}`);
        queue.push(job);
        // Return 200 immediately; processing happens asynchronously.
        return res.status(200).json({ message: 'Job queued', prNumber: job.prNumber });
    }
    catch (err) {
        console.error('[webhook] Unexpected error handling request:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Global error handler ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
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
//# sourceMappingURL=server.js.map