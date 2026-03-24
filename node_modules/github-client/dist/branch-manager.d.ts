import { FixedFile, PRData } from './types';
/**
 * Creates a new branch off the given SHA for housing auto-fixes.
 * Returns the created branch name.
 */
export declare function createFixBranch(owner: string, repo: string, headSHA: string, prNumber: number): Promise<string>;
/**
 * Commits each fixed file onto the specified branch.
 * Creates or updates files as needed.
 */
export declare function commitFixes(owner: string, repo: string, branch: string, files: FixedFile[]): Promise<void>;
/**
 * Opens a new "fix" PR targeting the original PR's head branch.
 * Returns the URL of the newly created PR.
 */
export declare function openFixPR(owner: string, repo: string, originalPR: PRData, fixBranch: string): Promise<string>;
//# sourceMappingURL=branch-manager.d.ts.map