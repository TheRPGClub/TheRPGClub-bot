/**
 * The two GitHub calls the conductor makes: read a pull request, and comment
 * on it. The token is sent only as an auth header and never logged or echoed.
 */
import axios, { type AxiosInstance } from "axios";

export interface IPullRequestInfo {
  number: number;
  state: string;
  headSha: string;
  body: string;
  htmlUrl: string;
}

export interface IGitHubRepoRef {
  owner: string;
  name: string;
}

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 15000;

export class GitHubPullClient {
  private readonly http: AxiosInstance;

  constructor(token: string, private readonly repo: IGitHubRepoRef) {
    this.http = axios.create({
      baseURL: GITHUB_API_BASE_URL,
      timeout: GITHUB_TIMEOUT_MS,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  }

  private get repoPath(): string {
    return `/repos/${this.repo.owner}/${this.repo.name}`;
  }

  async getPullRequest(pr: number): Promise<IPullRequestInfo> {
    const response = await this.http.get(`${this.repoPath}/pulls/${pr}`);
    const data = response.data as {
      number: number;
      state: string;
      head: { sha: string };
      body: string | null;
      html_url: string;
    };
    return {
      number: data.number,
      state: data.state,
      headSha: data.head.sha,
      body: data.body ?? "",
      htmlUrl: data.html_url,
    };
  }

  /** Returns the new comment's URL. */
  async postComment(pr: number, body: string): Promise<string> {
    const response = await this.http.post(`${this.repoPath}/issues/${pr}/comments`, { body });
    return (response.data as { html_url: string }).html_url;
  }
}
