import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type MemosSyncPlugin from "./main";

export const VIEW_TYPE_MEMOS_SYNC = "memos-sync-view";

export class MemosSyncView extends ItemView {
  plugin: MemosSyncPlugin;
  private statusEl: HTMLElement | null = null;
  private lastSyncEl: HTMLElement | null = null;
  private autoSyncStatusEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MemosSyncPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MEMOS_SYNC;
  }

  getDisplayText(): string {
    return "Diary Memos Sync";
  }

  getIcon(): string {
    return "refresh-cw";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("memos-sync-sidebar");

    // Header
    const header = container.createDiv({ cls: "memos-sync-header" });
    header.createEl("h4", { text: "📝 Memos Sync" });

    // Status section
    const statusSection = container.createDiv({ cls: "memos-sync-status" });

    // Connection status
    const connRow = statusSection.createDiv({ cls: "memos-sync-row" });
    connRow.createSpan({ text: "Server: ", cls: "memos-sync-label" });
    this.statusEl = connRow.createSpan({
      text: this.plugin.settings.memosServerUrl || "Not configured",
      cls: "memos-sync-value",
    });

    // Auto-sync status
    const autoRow = statusSection.createDiv({ cls: "memos-sync-row" });
    autoRow.createSpan({ text: "Auto Sync: ", cls: "memos-sync-label" });
    this.autoSyncStatusEl = autoRow.createSpan({
      text: this.plugin.settings.autoSync
        ? `ON (every ${this.plugin.settings.syncIntervalMinutes} min)`
        : "OFF",
      cls: "memos-sync-value",
    });

    // Last sync time
    const lastRow = statusSection.createDiv({ cls: "memos-sync-row" });
    lastRow.createSpan({ text: "Last Sync: ", cls: "memos-sync-label" });
    this.lastSyncEl = lastRow.createSpan({
      text: this.plugin.lastSyncTime || "Never",
      cls: "memos-sync-value",
    });

    // Buttons section
    const buttonsSection = container.createDiv({ cls: "memos-sync-buttons" });

    // Sync Now button
    const syncBtn = buttonsSection.createEl("button", {
      cls: "memos-sync-btn memos-sync-btn-primary",
    });
    const syncBtnIcon = syncBtn.createSpan({ cls: "memos-sync-btn-icon" });
    setIcon(syncBtnIcon, "refresh-cw");
    syncBtn.createSpan({ text: " Sync Now" });
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.addClass("memos-sync-btn-loading");
      try {
        await this.plugin.syncMemos();
        this.updateView();
      } finally {
        syncBtn.disabled = false;
        syncBtn.removeClass("memos-sync-btn-loading");
      }
    });

    // Test Connection button
    const testBtn = buttonsSection.createEl("button", {
      cls: "memos-sync-btn",
    });
    const testBtnIcon = testBtn.createSpan({ cls: "memos-sync-btn-icon" });
    setIcon(testBtnIcon, "activity");
    testBtn.createSpan({ text: " Test Connection" });
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      try {
        const result = await this.plugin.memosApi.testConnectionDetailed();
        if (this.statusEl) {
          if (result.ok) {
            this.statusEl.setText("✅ Connected" + (result.version ? ` (${result.version})` : ""));
            this.statusEl.toggleClass("memos-sync-success", true);
            this.statusEl.toggleClass("memos-sync-error", false);
          } else {
            this.statusEl.setText("❌ " + result.message.split("\n")[0]);
            this.statusEl.toggleClass("memos-sync-success", false);
            this.statusEl.toggleClass("memos-sync-error", true);
          }
        }
        // Also show a Notice with full details
        const { Notice } = await import("obsidian");
        if (result.ok) {
          new Notice(`✅ ${result.message}`);
        } else {
          new Notice(`❌ ${result.message}`, 10000);
        }
      } catch (e: any) {
        if (this.statusEl) {
          this.statusEl.setText("❌ " + (e?.message || "Unknown error"));
          this.statusEl.toggleClass("memos-sync-success", false);
          this.statusEl.toggleClass("memos-sync-error", true);
        }
      } finally {
        testBtn.disabled = false;
      }
    });

    // Settings button
    const settingsBtn = buttonsSection.createEl("button", {
      cls: "memos-sync-btn",
    });
    const settingsBtnIcon = settingsBtn.createSpan({ cls: "memos-sync-btn-icon" });
    setIcon(settingsBtnIcon, "settings");
    settingsBtn.createSpan({ text: " Settings" });
    settingsBtn.addEventListener("click", () => {
      // Open plugin settings
      (this.app as any).setting.open();
      (this.app as any).setting.openTabById("memos-sync");
    });

    // Info section
    const infoSection = container.createDiv({ cls: "memos-sync-info" });
    infoSection.createEl("p", {
      text: "Syncs your Memos to today's daily note. Configure server URL and access token in Settings.",
      cls: "memos-sync-info-text",
    });

    // Add styles
    this.addStyles(container);
  }

  updateView() {
    if (this.lastSyncEl) {
      this.lastSyncEl.setText(this.plugin.lastSyncTime || "Never");
    }
    if (this.autoSyncStatusEl) {
      this.autoSyncStatusEl.setText(
        this.plugin.settings.autoSync
          ? `ON (every ${this.plugin.settings.syncIntervalMinutes} min)`
          : "OFF"
      );
    }
    if (this.statusEl) {
      this.statusEl.setText(
        this.plugin.settings.memosServerUrl || "Not configured"
      );
    }
  }

  private addStyles(container: Element) {
    const style = container.createEl("style");
    style.textContent = `
      .memos-sync-sidebar {
        padding: 12px;
      }
      .memos-sync-header h4 {
        margin: 0 0 12px 0;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--background-modifier-border);
      }
      .memos-sync-status {
        margin-bottom: 16px;
        padding: 8px;
        background: var(--background-secondary);
        border-radius: 6px;
      }
      .memos-sync-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
        font-size: 12px;
      }
      .memos-sync-label {
        font-weight: 600;
        color: var(--text-muted);
      }
      .memos-sync-value {
        color: var(--text-normal);
        max-width: 60%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }
      .memos-sync-success {
        color: var(--text-success) !important;
      }
      .memos-sync-error {
        color: var(--text-error) !important;
      }
      .memos-sync-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }
      .memos-sync-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
        color: var(--text-normal);
        cursor: pointer;
        font-size: 13px;
        transition: all 0.15s ease;
      }
      .memos-sync-btn:hover {
        background: var(--background-modifier-hover);
      }
      .memos-sync-btn-primary {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
        font-weight: 600;
      }
      .memos-sync-btn-primary:hover {
        opacity: 0.9;
      }
      .memos-sync-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .memos-sync-btn-loading .memos-sync-btn-icon {
        animation: memos-spin 1s linear infinite;
      }
      .memos-sync-btn-icon {
        display: inline-flex;
        align-items: center;
        margin-right: 4px;
      }
      .memos-sync-btn-icon svg {
        width: 14px;
        height: 14px;
      }
      @keyframes memos-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .memos-sync-info {
        padding: 8px;
        border-top: 1px solid var(--background-modifier-border);
      }
      .memos-sync-info-text {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.5;
      }
    `;
  }

  async onClose() {
    // Cleanup if needed
  }
}
