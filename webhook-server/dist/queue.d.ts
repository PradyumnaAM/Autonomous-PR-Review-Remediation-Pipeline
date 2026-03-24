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
/**
 * Simple in-memory async job queue with configurable concurrency and retry logic.
 */
export declare class JobQueue extends EventEmitter {
    private readonly concurrency;
    private readonly pending;
    private running;
    private handler;
    constructor(concurrency: number);
    /** Register the async function that processes each job. */
    setHandler(handler: JobHandler): void;
    /** Enqueue a job. Processing starts immediately if capacity allows. */
    push(job: Job): void;
    get queueSize(): number;
    get activeCount(): number;
    private drain;
    private execute;
}
