import { EventEmitter } from 'events';

export interface Job {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  baseBranch: string;
  headBranch: string;
  headSHA: string;
}

export type JobHandler = (job: Job) => Promise<void>;

const RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple in-memory async job queue with configurable concurrency and retry logic.
 */
export class JobQueue extends EventEmitter {
  private readonly pending: Job[] = [];
  private running = 0;
  private handler: JobHandler | null = null;

  constructor(private readonly concurrency: number) {
    super();
  }

  /** Register the async function that processes each job. */
  setHandler(handler: JobHandler): void {
    this.handler = handler;
    this.drain();
  }

  /** Enqueue a job. Processing starts immediately if capacity allows. */
  push(job: Job): void {
    this.pending.push(job);
    this.drain();
  }

  get queueSize(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.running;
  }

  private drain(): void {
    if (!this.handler) return;

    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.running++;
      this.execute(job).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async execute(job: Job, attempt = 1): Promise<void> {
    try {
      await this.handler!(job);
      console.log(`[queue] PR #${job.prNumber} completed successfully`);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[queue] PR #${job.prNumber} failed on attempt ${attempt}/${MAX_ATTEMPTS}, ` +
            `retrying in ${RETRY_DELAY_MS / 1000}s…`,
        );
        await sleep(RETRY_DELAY_MS);
        return this.execute(job, attempt + 1);
      }

      console.error(
        `[queue] PR #${job.prNumber} permanently failed after ${MAX_ATTEMPTS} attempts:`,
        err,
      );
      this.emit('jobFailed', job, err);
    }
  }
}
