import { spawn } from 'child_process';
import path from 'path';
import {
  fetchDiff,
  postReviewComment,
  createFixBranch,
  commitFixes,
  openFixPR,
  OrchestratorResult,
  PRData,
} from 'github-client';
import { JobQueue, Job } from './queue';

// Resolved at startup so it fails fast if the path is wrong.
const ORCHESTRATOR_PATH = path.resolve(__dirname, '..', '..', 'agents', 'orchestrator.py');
const ORCHESTRATOR_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Consumes jobs from the queue, orchestrates the full review pipeline,
 * posts the review comment, and opens a fix PR when required.
 */
export class PRHandler {
  constructor(private readonly queue: JobQueue) {}

  start(): void {
    this.queue.setHandler(this.handleJob.bind(this));
    this.queue.on('jobFailed', (job: Job, err: unknown) => {
      console.error(`[pr-handler] Job permanently failed for PR #${job.prNumber}:`, err);
    });
    console.log(`[pr-handler] Started — orchestrator: ${ORCHESTRATOR_PATH}`);
  }

  private async handleJob(job: Job): Promise<void> {
    const t0 = Date.now();
    const { owner, repo, prNumber } = job;
    console.log(`[pr-handler] ▶ PR #${prNumber} (${owner}/${repo})`);

    // 1. Fetch diff
    const diff = await fetchDiff(owner, repo, prNumber).catch((err) => {
      throw new Error(`Failed to fetch diff: ${err instanceof Error ? err.message : err}`);
    });
    console.log(`[pr-handler] Diff fetched — ${diff.length} chars`);

    // 2. Run orchestrator
    const prData: PRData & { diff: string } = { ...job, diff };
    const result = await this.runOrchestrator(prData);
    console.log(`[pr-handler] Verdict: ${result.verdict}`);

    // 3. Post review comment
    await postReviewComment(owner, repo, prNumber, result).catch((err) => {
      throw new Error(
        `Failed to post review comment: ${err instanceof Error ? err.message : err}`,
      );
    });

    // 4. Open fix PR (if applicable)
    if (result.verdict === 'fix' && result.fixedFiles && result.fixedFiles.length > 0) {
      try {
        const fixBranch = await createFixBranch(owner, repo, job.headSHA, prNumber);
        await commitFixes(owner, repo, fixBranch, result.fixedFiles);
        const fixPRUrl = await openFixPR(owner, repo, job, fixBranch);
        console.log(`[pr-handler] Fix PR opened: ${fixPRUrl}`);
      } catch (err) {
        // Non-fatal — review comment was already posted.
        console.error(`[pr-handler] Failed to open fix PR for #${prNumber}:`, err);
      }
    }

    console.log(`[pr-handler] ✓ PR #${prNumber} done in ${Date.now() - t0}ms`);
  }

  private runOrchestrator(prData: PRData & { diff: string }): Promise<OrchestratorResult> {
    return new Promise((resolve, reject) => {
      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      const child = spawn(pythonBin, [ORCHESTRATOR_PATH], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Orchestrator timed out after ${ORCHESTRATOR_TIMEOUT_MS / 1000}s`));
      }, ORCHESTRATOR_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
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
          reject(
            new Error(
              `Orchestrator exited with code ${code}.\n--- stderr ---\n${stderr}`,
            ),
          );
          return;
        }

        try {
          const result = JSON.parse(stdout.trim()) as OrchestratorResult;
          resolve(result);
        } catch (err) {
          reject(
            new Error(
              `Failed to parse orchestrator JSON output: ${err}\n--- stdout ---\n${stdout}`,
            ),
          );
        }
      });

      // Send all PR data to the orchestrator via stdin.
      child.stdin.write(JSON.stringify(prData), 'utf-8');
      child.stdin.end();
    });
  }
}
