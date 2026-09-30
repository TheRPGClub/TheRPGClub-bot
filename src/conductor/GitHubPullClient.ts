/**
 * The GitHub calls the conductor makes: read a pull request and the token's own
 * user, comment on a pull request, and approve it. The token is sent only as an
 * auth header and never logged or echoed.
 */
import axios, { type AxiosAdapter, type AxiosInstance } from "axios";

export interface IPullRequestInfo {
  number: number;
  state: string;
  headSha: string;
  body: string;
  htmlUrl: string;
  /** The login of the user who opened the pull request. */
  authorLogin: string;
}

export interface IGitHubRepoRef {
  owner: string;
  name: string;
}

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 15000;

export interface IGitHubPullClientOptions {
  /** Replaces the HTTP transport, so tests can read the requests the client builds. */
  adapter?: AxiosAdapter;
}

export class GitHubPullClient {
  private readonly http: AxiosInstance;
  private viewerLogin: string | null = null;

  constructor(
    token: string,
    private readonly repo: IGitHubRepoRef,
    options: IGitHubPullClientOptions = {},
  ) {
    this.http = axios.create({
      adapter: options.adapter,
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
      user: { login: string };
    };
    return {
      number: data.number,
      state: data.state,
      headSha: data.head.sha,
      body: data.body ?? "",
      htmlUrl: data.html_url,
      authorLogin: data.user.login,
    };
  }

  /** Returns the new comment's URL. */
  async postComment(pr: number, body: string): Promise<string> {
    const response = await this.http.post(`${this.repoPath}/issues/${pr}/comments`, { body });
    return (response.data as { html_url: string }).html_url;
  }

  /** The login the token acts as. It never changes while the process runs, so it is cached. */
  async getViewerLogin(): Promise<string> {
    if (this.viewerLogin) return this.viewerLogin;
    const response = await this.http.get("/user");
    this.viewerLogin = (response.data as { login: string }).login;
    return this.viewerLogin;
  }

  /**
   * Approves the pull request at `headSha`, so the review is tied to the commit that was
   * tested even if the head moves before GitHub records it. Returns the review's URL.
   */
  async approve(pr: number, headSha: string, body: string): Promise<string> {
    const response = await this.http.post(`${this.repoPath}/pulls/${pr}/reviews`, {
      commit_id: headSha,
      event: "APPROVE",
      body,
    });
    return (response.data as { html_url: string }).html_url;
  }
}
