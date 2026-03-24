import { Octokit } from '@octokit/rest';
import { PRFile } from './types';

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var is required');
  return new Octokit({ auth: token });
}

/**
 * Fetches the raw unified diff for a pull request.
 */
export async function fetchDiff(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  const octokit = getOctokit();
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    {
      owner,
      repo,
      pull_number: prNumber,
      headers: { accept: 'application/vnd.github.v3.diff' },
    },
  );
  // Octokit returns the diff as a string when the accept header is set to diff
  return response.data as unknown as string;
}

/**
 * Fetches all changed files in a PR along with their full content at the head SHA.
 */
export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRFile[]> {
  const octokit = getOctokit();

  const changedFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const files: PRFile[] = await Promise.all(
    changedFiles.map(async (file): Promise<PRFile> => {
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
      } catch (err) {
        console.warn(`[pr-reader] Could not fetch content for ${file.filename}:`, err);
      }

      return {
        filename: file.filename,
        content,
        patch: file.patch,
        status: file.status,
      };
    }),
  );

  return files;
}
