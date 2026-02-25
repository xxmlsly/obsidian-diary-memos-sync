import { requestUrl, RequestUrlParam } from "obsidian";
import type { MemosSyncSettings } from "./settings";

/**
 * Represents a single Memo from the Memos API
 */
export interface Memo {
  uid: string;
  name: string;
  content: string;
  createTime: string;
  updateTime: string;
  displayTime: string;
  tags: string[];
  pinned: boolean;
  resources: MemoResource[];
}

export interface MemoResource {
  name: string;
  filename: string;
  externalLink: string;
  type: string;
  size: string;
}

/**
 * Response wrapper for safe HTTP requests
 */
interface SafeResponse {
  status: number;
  body: any;
  error?: string;
}

/**
 * Memos API client for Memos v0.22+ (latest)
 */
export class MemosApi {
  private settings: MemosSyncSettings;

  constructor(settings: MemosSyncSettings) {
    this.settings = settings;
  }

  updateSettings(settings: MemosSyncSettings) {
    this.settings = settings;
  }

  private get baseUrl(): string {
    return this.settings.memosServerUrl.replace(/\/+$/, "");
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.settings.memosAccessToken) {
      h["Authorization"] = `Bearer ${this.settings.memosAccessToken}`;
    }
    return h;
  }

  /**
   * Safe request wrapper.
   * Obsidian's requestUrl throws on non-2xx status codes,
   * so we catch those and extract the status from the error.
   */
  private async safeRequest(
    url: string,
    method: string = "GET",
    includeAuth: boolean = true
  ): Promise<SafeResponse> {
    try {
      const params: RequestUrlParam = {
        url,
        method,
        headers: includeAuth ? this.headers : { "Content-Type": "application/json" },
      };

      const resp = await requestUrl(params);
      // requestUrl succeeded (2xx status)
      let body: any = null;
      try {
        body = resp.json;
      } catch {
        // Response may not be JSON
        body = resp.text;
      }
      return { status: resp.status, body };
    } catch (e: any) {
      // Obsidian's requestUrl throws on non-2xx responses
      // Try to extract status code from the error
      const status = this.extractStatusFromError(e);
      const errorMsg = e?.message || String(e);
      console.log(`Memos Sync: Request to ${url} failed - status: ${status}, error: ${errorMsg}`);
      return { status, body: null, error: errorMsg };
    }
  }

  /**
   * Try to extract HTTP status code from Obsidian requestUrl error
   */
  private extractStatusFromError(e: any): number {
    // Obsidian may set status on the error object
    if (e?.status) return e.status;
    // Some versions include it in the message
    const msg = e?.message || String(e);
    const match = msg.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1], 10);
    // Network error or unknown
    return 0;
  }

  /**
   * Test connection to the Memos server.
   * Throws an Error with a descriptive message on failure.
   * Returns true on success.
   */
  async testConnection(): Promise<boolean> {
    const result = await this.testConnectionDetailed();
    if (!result.ok) {
      throw new Error(result.message);
    }
    return true;
  }

  /**
   * Detailed connection test for latest Memos (v0.22+).
   *
   * Step 1: Hit /api/v1/workspace/profile (no auth) to verify server is reachable
   * Step 2: Hit /api/v1/memos?pageSize=1 (with auth) to verify token works
   */
  async testConnectionDetailed(): Promise<{
    ok: boolean;
    message: string;
    version?: string;
  }> {
    if (!this.settings.memosServerUrl) {
      return { ok: false, message: "Server URL is not configured." };
    }
    if (!this.settings.memosAccessToken) {
      return { ok: false, message: "Access token is not configured." };
    }

    // Step 1: Check if the server is reachable via workspace profile (no auth needed)
    const profileUrl = `${this.baseUrl}/api/v1/workspace/profile`;
    console.log(`Memos Sync: Testing server reachability at ${profileUrl}`);
    const profileResult = await this.safeRequest(profileUrl, "GET", false);

    if (profileResult.status === 0) {
      // Network-level failure
      return {
        ok: false,
        message: `Cannot reach server at ${this.baseUrl}.\n\nPossible causes:\n• The server URL is incorrect\n• The server is not running\n• Network/firewall/CORS issues\n\nError: ${profileResult.error || "Network error"}`,
      };
    }

    if (profileResult.status === 404) {
      // Maybe not a Memos server, or very old version
      // Try a fallback endpoint
      const fallbackUrl = `${this.baseUrl}/api/v1/memos?pageSize=1`;
      console.log(`Memos Sync: Profile endpoint not found, trying ${fallbackUrl}`);
      const fallbackResult = await this.safeRequest(fallbackUrl, "GET", true);

      if (fallbackResult.status === 200) {
        return {
          ok: true,
          message: "Connected successfully! (workspace/profile not available, but memos API works)",
          version: "unknown",
        };
      }

      if (fallbackResult.status === 401 || fallbackResult.status === 403) {
        return {
          ok: false,
          message: `Server found but authentication failed (HTTP ${fallbackResult.status}).\n\nPlease check your access token:\n• Go to Memos → Settings → Access Tokens\n• Create a new token and paste it in the plugin settings`,
        };
      }

      return {
        ok: false,
        message: `Server at ${this.baseUrl} does not appear to be a Memos instance.\n\n/api/v1/workspace/profile returned HTTP ${profileResult.status}\n/api/v1/memos returned HTTP ${fallbackResult.status || "no response"}\n\nPlease verify the URL is correct.`,
      };
    }

    // Profile endpoint returned something (possibly 200, 401, etc.)
    let version = "unknown";
    if (profileResult.status === 200 && profileResult.body) {
      version = profileResult.body?.version || "unknown";
      console.log(`Memos Sync: Server version detected: ${version}`);
    }

    // Step 2: Verify authentication by fetching memos with token
    const memosUrl = `${this.baseUrl}/api/v1/memos?pageSize=1`;
    console.log(`Memos Sync: Testing authentication at ${memosUrl}`);
    const memosResult = await this.safeRequest(memosUrl, "GET", true);

    if (memosResult.status === 200) {
      const versionDisplay = version !== "unknown" ? ` (version: ${version})` : "";
      return {
        ok: true,
        message: `Connected successfully!${versionDisplay}`,
        version,
      };
    }

    if (memosResult.status === 401 || memosResult.status === 403) {
      return {
        ok: false,
        message: `Server is reachable but authentication failed (HTTP ${memosResult.status}).\n\nPlease check your access token:\n• Go to Memos → Settings → Access Tokens\n• Create a new token and paste it in the plugin settings\n• Make sure you're using the token value, not the token name`,
      };
    }

    return {
      ok: false,
      message: `Server is reachable${version !== "unknown" ? ` (version: ${version})` : ""} but memos API returned HTTP ${memosResult.status}.\n\nError: ${memosResult.error || "Unknown error"}\n\nPlease check your Memos version is v0.22+ and the token has proper permissions.`,
    };
  }

  /**
   * Fetch memos for a specific date (YYYY-MM-DD)
   * For latest Memos v0.22+, we fetch all memos and filter by date client-side,
   * because the filter CEL syntax for time ranges can vary between versions.
   */
  async fetchMemosByDate(dateStr: string): Promise<Memo[]> {
    // Calculate the date range in local time
    const startOfDay = new Date(`${dateStr}T00:00:00`);
    const nextDay = this.getNextDay(dateStr);
    const endOfDay = new Date(`${nextDay}T00:00:00`);

    let allMemos: Memo[] = [];
    let pageToken = "";
    const pageSize = Math.min(this.settings.syncLimit, 50);

    // Paginated fetching - no filter parameter to avoid 400 errors
    do {
      let url = `${this.baseUrl}/api/v1/memos?pageSize=${pageSize}`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      console.log(`Memos Sync: Fetching memos from ${url}`);
      const result = await this.safeRequest(url);

      if (result.status === 401 || result.status === 403) {
        throw new Error(
          `Authentication failed (HTTP ${result.status}). Please check your access token.`
        );
      }

      if (result.status !== 200) {
        throw new Error(
          `Failed to fetch memos: HTTP ${result.status}${result.error ? " - " + result.error : ""}`
        );
      }

      const data = result.body;
      if (!data) {
        throw new Error("Empty response from Memos API");
      }

      const memos: Memo[] = (data.memos || []).map((m: any) =>
        this.parseMemo(m)
      );

      // Filter memos by date client-side
      for (const memo of memos) {
        const memoTime = new Date(memo.displayTime || memo.createTime);
        if (memoTime >= startOfDay && memoTime < endOfDay) {
          allMemos.push(memo);
        }
      }

      pageToken = data.nextPageToken || "";

      // If the oldest memo in this page is before our target date, stop fetching
      // (memos are returned in reverse chronological order by default)
      if (memos.length > 0) {
        const oldestMemo = memos[memos.length - 1];
        const oldestTime = new Date(oldestMemo.displayTime || oldestMemo.createTime);
        if (oldestTime < startOfDay) {
          break;
        }
      }

      if (allMemos.length >= this.settings.syncLimit) {
        allMemos = allMemos.slice(0, this.settings.syncLimit);
        break;
      }
    } while (pageToken);

    // Filter by tag if configured
    if (this.settings.filterTag) {
      allMemos = allMemos.filter((m) =>
        m.tags.some((t) => t === this.settings.filterTag)
      );
    }

    // Sort by display time ascending
    allMemos.sort(
      (a, b) =>
        new Date(a.displayTime).getTime() - new Date(b.displayTime).getTime()
    );

    return allMemos;
  }

  private parseMemo(raw: any): Memo {
    return {
      uid: raw.uid || raw.name || "",
      name: raw.name || "",
      content: raw.content || "",
      createTime: raw.createTime || "",
      updateTime: raw.updateTime || "",
      displayTime: raw.displayTime || raw.createTime || "",
      tags: raw.tags || [],
      pinned: raw.pinned || false,
      resources: (raw.resources || []).map((r: any) => ({
        name: r.name || "",
        filename: r.filename || "",
        externalLink: r.externalLink || "",
        type: r.type || "",
        size: r.size || "0",
      })),
    };
  }

  private getNextDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}
