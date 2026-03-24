import { JobQueue } from './queue';
/**
 * Consumes jobs from the queue, orchestrates the full review pipeline,
 * posts the review comment, and opens a fix PR when required.
 */
export declare class PRHandler {
    private readonly queue;
    constructor(queue: JobQueue);
    start(): void;
    private handleJob;
    private runOrchestrator;
}
