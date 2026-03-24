"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const events_1 = require("events");
const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Simple in-memory async job queue with configurable concurrency and retry logic.
 */
class JobQueue extends events_1.EventEmitter {
    constructor(concurrency) {
        super();
        this.concurrency = concurrency;
        this.pending = [];
        this.running = 0;
        this.handler = null;
    }
    /** Register the async function that processes each job. */
    setHandler(handler) {
        this.handler = handler;
        this.drain();
    }
    /** Enqueue a job. Processing starts immediately if capacity allows. */
    push(job) {
        this.pending.push(job);
        this.drain();
    }
    get queueSize() {
        return this.pending.length;
    }
    get activeCount() {
        return this.running;
    }
    drain() {
        if (!this.handler)
            return;
        while (this.running < this.concurrency && this.pending.length > 0) {
            const job = this.pending.shift();
            this.running++;
            this.execute(job).finally(() => {
                this.running--;
                this.drain();
            });
        }
    }
    async execute(job, attempt = 1) {
        try {
            await this.handler(job);
            console.log(`[queue] PR #${job.prNumber} completed successfully`);
        }
        catch (err) {
            if (attempt < MAX_ATTEMPTS) {
                console.warn(`[queue] PR #${job.prNumber} failed on attempt ${attempt}/${MAX_ATTEMPTS}, ` +
                    `retrying in ${RETRY_DELAY_MS / 1000}s…`);
                await sleep(RETRY_DELAY_MS);
                return this.execute(job, attempt + 1);
            }
            console.error(`[queue] PR #${job.prNumber} permanently failed after ${MAX_ATTEMPTS} attempts:`, err);
            this.emit('jobFailed', job, err);
        }
    }
}
exports.JobQueue = JobQueue;
//# sourceMappingURL=queue.js.map