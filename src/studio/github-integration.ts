// ---------------------------------------------------------------------------
// Oscorpex — GitHub Integration
// Octokit tabanlı PR oluşturma ve repo bilgisi çekme.
// ---------------------------------------------------------------------------

import { Octokit } from '@octokit/rest';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRCreateOptions {
  owner: string;
  repo: string;
  head: string;   // source branch
  base: string;   // target branch (usually 'main')
  title: string;
  body: string;
}

export interface PRResult {
  number: number;
  url: string;
  title: string;
}

// ---------------------------------------------------------------------------
// GitHubIntegration
// ---------------------------------------------------------------------------

export class GitHubIntegration {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async createPR(opts: PRCreateOptions): Promise<PRResult> {
    const { data } = await this.octokit.pulls.create({
      owner: opts.owner,
      repo: opts.repo,
      head: opts.head,
      base: opts.base,
      title: opts.title,
      body: opts.body,
    });
    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
    };
  }

  /**
   * Git remote URL'sinden owner/repo bilgisini parse eder.
   * SSH:   git@github.com:owner/repo.git
   * HTTPS: https://github.com/owner/repo.git
   * GitHub dışı remote için null döner.
   */
  static getRepoInfo(repoPath: string): { owner: string; repo: string } | null {
    try {
      const remote = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();

      const sshMatch = remote.match(/git@github\.com:([^/]+)\/([^/.]+)/);
      if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

      const httpsMatch = remote.match(/github\.com\/([^/]+)\/([^/.]+)/);
      if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

      return null;
    } catch {
      return null;
    }
  }
}
