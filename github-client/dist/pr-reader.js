"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDiff = fetchDiff;
exports.fetchPRFiles = fetchPRFiles;
const rest_1 = require("@octokit/rest");
function getOctokit() {
    const token = process.env.GITHUB_TOKEN;
    if (!token)
        throw new Error('GITHUB_TOKEN env var is required');
    return new rest_1.Octokit({ auth: token });
}
/**
 * Fetches the raw unified diff for a pull request.
 */
async function fetchDiff(owner, repo, prNumber) {
    const octokit = getOctokit();
    const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: prNumber,
        headers: { accept: 'application/vnd.github.v3.diff' },
    });
    // Octokit returns the diff as a string when the accept header is set to diff
    return response.data;
}
/**
 * Fetches all changed files in a PR along with their full content at the head SHA.
 */
async function fetchPRFiles(owner, repo, prNumber) {
    const octokit = getOctokit();
    const changedFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
    });
    const files = await Promise.all(changedFiles.map(async (file) => {
        if (file.status === 'removed') {
            return {
                filename: file.filename,
                content: '',
                patch: file.patch,
                status: file.status,
            };
        }
        let content = '';
        try {
            const contentRes = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: file.filename,
            });
            const data = contentRes.data;
            if (!Array.isArray(data) && data.type === 'file' && data.encoding === 'base64') {
                content = Buffer.from(data.content, 'base64').toString('utf-8');
            }
        }
        catch (err) {
            console.warn(`[pr-reader] Could not fetch content for ${file.filename}:`, err);
        }
        return {
            filename: file.filename,
            content,
            patch: file.patch,
            status: file.status,
        };
    }));
    return files;
}
//# sourceMappingURL=pr-reader.js.map