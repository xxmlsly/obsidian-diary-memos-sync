import {
  Plugin,
  Notice,
  TFile,
} from "obsidian";
import {
  MemosSyncSettings,
  DEFAULT_SETTINGS,
  MemosSyncSettingTab,
} from "./settings";
import { MemosApi } from "./api";
import {
  getDailyNotePath,
  buildMemosSection,
  mergeMemosIntoNote,
  formatDate,
} from "./utils";

export default class MemosSyncPlugin extends Plugin {
  settings: MemosSyncSettings = DEFAULT_SETTINGS;
  memosApi: MemosApi = new MemosApi(DEFAULT_SETTINGS);
  lastSyncTime: string = "";
  private syncInterval: number | null = null;
  private startupTimeout: number | null = null;
  private fileOpenRegistered = false;
  private recentlySynced = new Map<string, number>();

  async onload() {
    await this.loadSettings();
    this.memosApi = new MemosApi(this.settings);

    // Add ribbon icon
    this.addRibbonIcon("refresh-cw", "Diary Memos Sync", () => {
      void this.syncMemos();
    });

    // Add commands
    this.addCommand({
      id: "sync-memos-now",
      name: "Sync Memos Now",
      callback: () => {
        void this.syncMemos();
      },
    });

    this.addCommand({
      id: "toggle-auto-sync",
      name: "Toggle Auto Sync",
      callback: () => {
        this.settings.autoSync = !this.settings.autoSync;
        void this.saveSettings();
        this.resetAutoSync();
        new Notice(
          `Memos auto-sync ${this.settings.autoSync ? "enabled" : "disabled"}`
        );
      },
    });

    // Add settings tab
    this.addSettingTab(new MemosSyncSettingTab(this.app, this));

    // Start auto-sync if enabled
    this.resetAutoSync();

    // Sync on startup if configured
    this.setupStartupSync();

    // Register file-open listener once (checks setting inside callback)
    this.app.workspace.onLayoutReady(() => {
      this.setupFileOpenSync();
    });
  }

  onunload() {
    this.clearAutoSync();
    this.clearStartupSync();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.memosApi.updateSettings(this.settings);
  }

  /**
   * Main sync logic — syncs today + past N lookback days
   */
  async syncMemos() {
    if (!this.settings.memosServerUrl) {
      new Notice("⚠️ Please configure Memos server URL in settings");
      return;
    }

    if (!this.settings.memosAccessToken) {
      new Notice("⚠️ Please configure Memos access token in settings");
      return;
    }

    try {
      const lookbackDays = this.settings.syncLookbackDays || 0;

      let totalSynced = 0;
      let daysUpdated = 0;

      // Build list of dates to sync: today, yesterday, ..., today - lookbackDays
      const datesToSync: { dateStr: string; date: Date }[] = [];
      for (let i = 0; i <= lookbackDays; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = formatDate(d, "YYYY-MM-DD");
        datesToSync.push({ dateStr, date: new Date(d) });
      }

      for (const { dateStr, date } of datesToSync) {
        const memos = await this.memosApi.fetchMemosByDate(dateStr);
        console.debug(`Memos Sync: [syncMemos] Date ${dateStr}: fetched ${memos.length} memo(s)`);
        for (const m of memos) {
          console.debug(`Memos Sync: [syncMemos]   uid=${m.uid}, updateTime=${m.updateTime}, content="${m.content.substring(0, 50)}"`);
        }

        if (memos.length === 0) {
          continue;
        }

        // Build the memos section
        const memosSection = buildMemosSection(memos, this.settings);

        // Get or create the daily note for this date
        const notePath = getDailyNotePath(date, this.settings);
        let noteContent = "";

        const existingFile = this.app.vault.getAbstractFileByPath(notePath);

        if (existingFile && existingFile instanceof TFile) {
          noteContent = await this.app.vault.read(existingFile);
        } else {
          // Ensure folder exists
          await this.ensureFolderExists(notePath);
        }

        // Merge memos into the note
        const updatedContent = mergeMemosIntoNote(
          noteContent,
          memosSection,
          this.settings
        );

        // Only write if content actually changed
        if (updatedContent !== noteContent) {
          console.debug(`Memos Sync: [syncMemos] Content changed for ${dateStr}, writing file.`);
          if (existingFile && existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, updatedContent);
          } else {
            await this.app.vault.create(notePath, updatedContent);
          }
          daysUpdated++;
        } else {
          console.debug(`Memos Sync: [syncMemos] Content UNCHANGED for ${dateStr}, skipping write.`);
        }

        totalSynced += memos.length;
      }

      this.updateLastSyncTime();

      console.debug(
        `Memos Sync: Synced ${totalSynced} memo(s) across ${daysUpdated} day(s)`
      );
    } catch (error) {
      console.error("Memos Sync Error:", error);
      new Notice(`❌ Sync failed: ${(error as Error).message}`, 8000);
    }
  }

  /**
   * Ensure the folder for the note exists
   */
  private async ensureFolderExists(filePath: string) {
    const parts = filePath.split("/");
    parts.pop(); // Remove filename

    if (parts.length === 0) return;

    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  /**
   * Update the last sync timestamp
   */
  private updateLastSyncTime() {
    this.lastSyncTime = formatDate(new Date(), "YYYY-MM-DD HH:mm:ss");
  }

  /**
   * Reset auto-sync interval
   */
  resetAutoSync() {
    this.clearAutoSync();

    if (this.settings.autoSync && this.settings.syncIntervalMinutes > 0) {
      const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
      this.syncInterval = window.setInterval(() => {
        console.debug("Memos Sync: Auto-sync triggered");
        void this.syncMemos();
      }, intervalMs);

      // Register the interval so Obsidian cleans it up
      this.registerInterval(this.syncInterval);
    }
  }

  /**
   * Clear auto-sync interval
   */
  private clearAutoSync() {
    if (this.syncInterval !== null) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Setup sync on startup with configured delay
   */
  private setupStartupSync() {
    this.clearStartupSync();

    const delaySetting = this.settings.syncOnStartup;
    if (delaySetting === "off") return;

    const delaySeconds = parseInt(delaySetting, 10);
    if (isNaN(delaySeconds) || delaySeconds < 1) return;

    this.startupTimeout = window.setTimeout(() => {
      console.debug(`Memos Sync: Startup sync triggered after ${delaySeconds}s`);
      void this.syncMemos();
    }, delaySeconds * 1000);

    // Register so Obsidian cleans it up
    this.registerInterval(this.startupTimeout);
  }

  /**
   * Clear startup sync timeout
   */
  private clearStartupSync() {
    if (this.startupTimeout !== null) {
      window.clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
  }

  /**
   * Setup file-open sync listener (registered once, checks setting inside callback)
   */
  setupFileOpenSync() {
    if (this.fileOpenRegistered) return;
    this.fileOpenRegistered = true;

    const DEBOUNCE_MS = 10000; // 10 seconds debounce per date

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        console.debug(`Memos Sync: [file-open] event fired, file=${file?.path ?? "null"}, syncOnFileOpen=${this.settings.syncOnFileOpen}`);

        // Check the toggle inside the callback so it responds to setting changes immediately
        if (!this.settings.syncOnFileOpen) return;

        if (!file || !(file instanceof TFile)) return;
        if (file.extension !== "md") return;

        // Check if this file is a daily note within our lookback range
        const dateStr = this.extractDateFromDailyNote(file);
        if (!dateStr) {
          return;
        }

        // Check if this date is within the lookback range
        const lookbackDays = this.settings.syncLookbackDays || 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const fileDate = new Date(dateStr + "T00:00:00");
        const diffDays = Math.floor((today.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0 || diffDays > lookbackDays) {
          console.debug(`Memos Sync: [file-open] Date ${dateStr} is outside lookback range (${diffDays} days ago, max ${lookbackDays}), skipping.`);
          return;
        }

        // Debounce: skip if we recently synced this date
        const lastSync = this.recentlySynced.get(dateStr);
        if (lastSync && (Date.now() - lastSync) < DEBOUNCE_MS) {
          console.debug(`Memos Sync: [file-open] Date ${dateStr} was recently synced, debouncing.`);
          return;
        }

        this.recentlySynced.set(dateStr, Date.now());
        console.debug(`Memos Sync: [file-open] Sync triggered for ${dateStr} (file: ${file.path})`);
        void this.syncSingleDate(dateStr, fileDate);
      })
    );

    console.debug("Memos Sync: File-open sync listener registered.");
  }

  /**
   * Called from settings toggle — no need to re-register, just log the change
   */
  resetFileOpenSync() {
    // Ensure listener is registered (no-op if already registered)
    this.setupFileOpenSync();
    console.debug(`Memos Sync: syncOnFileOpen is now ${this.settings.syncOnFileOpen ? "enabled" : "disabled"}`);
  }

  /**
   * Extract date string from a daily note file path.
   * Uses the configured fileNameFormat to reverse-parse the date from the file name.
   * Returns YYYY-MM-DD string if the file matches daily note pattern, null otherwise.
   */
  private extractDateFromDailyNote(file: TFile): string | null {
    const folder = this.settings.dailyNotesFolder.replace(/^\/*|\/*$/g, "");
    const filePath = file.path;
    const fmt = this.settings.fileNameFormat || "YYYY-MM-DD";

    console.debug(`Memos Sync: [extractDate] filePath="${filePath}", folder="${folder}", fileNameFormat="${fmt}"`);

    // Check if the file is inside the daily notes folder
    if (folder) {
      const normalizedPath = filePath.toLowerCase();
      const normalizedFolder = folder.toLowerCase();
      if (!normalizedPath.startsWith(normalizedFolder + "/")) {
        console.debug(`Memos Sync: [extractDate] Path does not start with folder "${folder}/", skipping.`);
        return null;
      }
    }

    // Get the relative path after the folder (or the full path if no folder)
    const relativePath = folder ? filePath.slice(folder.length + 1) : filePath;
    // Remove .md extension
    const pathWithoutExt = relativePath.replace(/\.md$/i, "");

    console.debug(`Memos Sync: [extractDate] pathWithoutExt="${pathWithoutExt}"`);

    // Build a regex from the fileNameFormat to extract YYYY, MM, DD parts
    // The format can contain path separators like "YYYY/MM/YYYY-MM-DD"
    const dateStr = this.parseDateFromFormat(pathWithoutExt, fmt);
    if (dateStr) {
      console.debug(`Memos Sync: [extractDate] Parsed date ${dateStr} using format "${fmt}"`);
      return dateStr;
    }

    // Fallback: try common date patterns
    // YYYY-MM-DD
    const dashMatch = filePath.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dashMatch) {
      const d = `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
      if (!isNaN(new Date(d + "T00:00:00").getTime())) {
        console.debug(`Memos Sync: [extractDate] Fallback matched YYYY-MM-DD: ${d}`);
        return d;
      }
    }
    // YYYYMMDD
    const compactMatch = filePath.match(/(\d{4})(\d{2})(\d{2})/);
    if (compactMatch) {
      const d = `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
      if (!isNaN(new Date(d + "T00:00:00").getTime())) {
        console.debug(`Memos Sync: [extractDate] Fallback matched YYYYMMDD: ${d}`);
        return d;
      }
    }

    console.debug(`Memos Sync: [extractDate] No date found in "${filePath}"`);
    return null;
  }

  /**
   * Parse a date string from a formatted path using the user's fileNameFormat.
   * E.g., format="YYYYMMDD", input="20260225" → "2026-02-25"
   * E.g., format="YYYY-MM-DD", input="2026-02-25" → "2026-02-25"
   * E.g., format="YYYY/MM/YYYY-MM-DD", input="2026/02/2026-02-25" → "2026-02-25"
   */
  private parseDateFromFormat(input: string, format: string): string | null {
    // Build a regex by replacing YYYY, MM, DD with capture groups
    // Escape any regex special chars first, then replace tokens
    let regexStr = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regexStr = regexStr.replace(/YYYY/g, "(\\d{4})");
    regexStr = regexStr.replace(/MM/g, "(\\d{2})");
    regexStr = regexStr.replace(/DD/g, "(\\d{2})");

    // Determine capture group order based on token positions in the original format
    const tokenPositions: { token: string; index: number }[] = [];
    let searchFmt = format;
    const tokens = ["YYYY", "MM", "DD"];
    for (const token of tokens) {
      let pos = searchFmt.indexOf(token);
      while (pos !== -1) {
        tokenPositions.push({ token, index: pos });
        // Mark this position so we don't match it again (replace with placeholder of same length)
        searchFmt = searchFmt.substring(0, pos) + "X".repeat(token.length) + searchFmt.substring(pos + token.length);
        pos = searchFmt.indexOf(token);
      }
    }
    tokenPositions.sort((a, b) => a.index - b.index);

    const regex = new RegExp("^" + regexStr + "$");
    const match = input.match(regex);

    if (!match) {
      console.debug(`Memos Sync: [parseDateFromFormat] No match. input="${input}", regex=${regex}`);
      return null;
    }

    // Extract year, month, day from capture groups
    let year = "", month = "", day = "";
    for (let i = 0; i < tokenPositions.length; i++) {
      const val = match[i + 1];
      switch (tokenPositions[i].token) {
        case "YYYY": year = val; break;
        case "MM": month = val; break;
        case "DD": day = val; break;
      }
    }

    if (!year || !month || !day) {
      console.debug(`Memos Sync: [parseDateFromFormat] Missing date parts: year=${year}, month=${month}, day=${day}`);
      return null;
    }

    const dateStr = `${year}-${month}-${day}`;
    const parsed = new Date(dateStr + "T00:00:00");
    if (isNaN(parsed.getTime())) {
      console.debug(`Memos Sync: [parseDateFromFormat] Invalid date: ${dateStr}`);
      return null;
    }

    return dateStr;
  }

  /**
   * Sync memos for a single date
   */
  private async syncSingleDate(dateStr: string, date: Date) {
    if (!this.settings.memosServerUrl || !this.settings.memosAccessToken) {
      return;
    }

    try {
      const memos = await this.memosApi.fetchMemosByDate(dateStr);

      if (memos.length === 0) return;

      const memosSection = buildMemosSection(memos, this.settings);
      const notePath = getDailyNotePath(date, this.settings);
      let noteContent = "";

      const existingFile = this.app.vault.getAbstractFileByPath(notePath);

      if (existingFile && existingFile instanceof TFile) {
        noteContent = await this.app.vault.read(existingFile);
      } else {
        await this.ensureFolderExists(notePath);
      }

      const updatedContent = mergeMemosIntoNote(
        noteContent,
        memosSection,
        this.settings
      );

      if (updatedContent !== noteContent) {
        if (existingFile && existingFile instanceof TFile) {
          await this.app.vault.modify(existingFile, updatedContent);
        } else {
          await this.app.vault.create(notePath, updatedContent);
        }
        console.debug(`Memos Sync: Updated memos for ${dateStr}`);
      }

      this.updateLastSyncTime();
    } catch (error) {
      console.error(`Memos Sync Error (${dateStr}):`, error);
      new Notice(`❌ Sync failed for ${dateStr}: ${(error as Error).message}`, 8000);
    }
  }
}
