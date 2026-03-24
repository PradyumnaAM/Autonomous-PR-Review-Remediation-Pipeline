"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRHandler = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const github_client_1 = require("github-client");
// Resolved at startup so it fails fast if the path is wrong.
const ORCHESTRATOR_PATH = path_1.default.resolve(__dirname, '..', '..', 'agents', 'orchestrator.py');
const ORCHESTRATOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Consumes jobs from the queue, orchestrates the full review pipeline,
 * posts the review comment, and opens a fix PR when required.
 */
class PRHandler {
    constructor(queue) {
        this.queue = queue;
    }
    start() {
        this.queue.setHandler(this.handleJob.bind(this));
        this.queue.on('jobFailed', (job, err) => {
            console.error(`[pr-handler] Job permanently failed for PR #${job.prNumber}:`, err);
        });
        console.log(`[pr-handler] Started — orchestrator: ${ORCHESTRATOR_PATH}`);
    }
    async handleJob(job) {
        const t0 = Date.now();
        const { owner, repo, prNumber } = job;
        console.log(`[pr-handler] ▶ PR #${prNumber} (${owner}/${repo})`);
        // 1. Fetch diff
        const diff = await (0, github_client_1.fetchDiff)(owner, repo, prNumber).catch((err) => {
            throw new Error(`Failed to fetch diff: ${err instanceof Error ? err.message : err}`);
        });
        console.log(`[pr-handler] Diff fetched — ${diff.length} chars`);
        // 2. Run orchestrator
        const prData = { ...job, diff };
        const result = await this.runOrchestrator(prData);
        console.log(`[pr-handler] Verdict: ${result.verdict}`);
        // 3. Post review comment
        await (0, github_client_1.postReviewComment)(owner, repo, prNumber, result).catch((err) => {
            throw new Error(`Failed to post review comment: ${err instanceof Error ? err.message : err}`);
        });
        // 4. Open fix PR (if applicable)
        if (result.verdict === 'fix' && result.fixedFiles && result.fixedFiles.length > 0) {
            try {
                const fixBranch = await (0, github_client_1.createFixBranch)(owner, repo, job.headSHA, prNumber);
                await (0, github_client_1.commitFixes)(owner, repo, fixBranch, result.fixedFiles);
                const fixPRUrl = await (0, github_client_1.openFixPR)(owner, repo, job, fixBranch);
                console.log(`[pr-handler] Fix PR opened: ${fixPRUrl}`);
            }
            catch (err) {
                // Non-fatal — review comment was already posted.
                console.error(`[pr-handler] Failed to open fix PR for #${prNumber}:`, err);
            }
        }
        console.log(`[pr-handler] ✓ PR #${prNumber} done in ${Date.now() - t0}ms`);
    }
    runOrchestrator(prData) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('python3', [ORCHESTRATOR_PATH], {
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error(`Orchestrator timed out after ${ORCHESTRATOR_TIMEOUT_MS / 1000}s`));
            }, ORCHESTRATOR_TIMEOUT_MS);
            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on('data', (chunk) => {
                const line = chunk.toString();
                stderr += line;
                // Pipe agent logs to our stdout so they appear in the server log.
                process.stdout.write(line);
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`Orchestrator spawn error: ${err.message}`));
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new Error(`Orchestrator exited with code ${code}.\n--- stderr ---\n${stderr}`));
                    return;
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                }
                catch (err) {
                    reject(new Error(`Failed to parse orchestrator JSON output: ${err}\n--- stdout ---\n${stdout}`));
                }
            });
            // Send all PR data to the orchestrator via stdin.
            child.stdin.write(JSON.stringify(prData), 'utf-8');
            child.stdin.end();
        });
    }
}
exports.PRHandler = PRHandler;
//# sourceMappingURL=pr-handler.js.map