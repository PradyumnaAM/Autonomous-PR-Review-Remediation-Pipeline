import { PRFile } from './types';
/**
 * Fetches the raw unified diff for a pull request.
 */
export declare function fetchDiff(owner: string, repo: string, prNumber: number): Promise<string>;
/**
 * Fetches all changed files in a PR along with their full content at the head SHA.
 */
export declare function fetchPRFiles(owner: string, repo: string, prNumber: number): Promise<PRFile[]>;
//# sourceMappingURL=pr-reader.d.ts.map