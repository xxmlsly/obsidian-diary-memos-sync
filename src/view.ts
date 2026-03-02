import { ItemView, WorkspaceLeaf, setIcon, App } from "obsidian";
import type MemosSyncPlugin from "./main";

export const VIEW_TYPE_MEMOS_SYNC = "memos-sync-view";

/**
 * Extended App interface for accessing internal setting API
 */
interface AppWithSetting extends App {
  setting: {
    open: () => void;
    openTabById: (id: string) => void;
  };
}

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

  onOpen(): Promise<void> {
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
    syncBtn.addEventListener("click", () => {
      syncBtn.disabled = true;
      syncBtn.addClass("memos-sync-btn-loading");
      void this.plugin.syncMemos().then(() => {
        this.updateView();
      }).finally(() => {
        syncBtn.disabled = false;
        syncBtn.removeClass("memos-sync-btn-loading");
      });
    });

    // Test Connection button
    const testBtn = buttonsSection.createEl("button", {
      cls: "memos-sync-btn",
    });
    const testBtnIcon = testBtn.createSpan({ cls: "memos-sync-btn-icon" });
    setIcon(testBtnIcon, "activity");
    testBtn.createSpan({ text: " Test Connection" });
    testBtn.addEventListener("click", () => {
      testBtn.disabled = true;
      void this.plugin.memosApi.testConnectionDetailed().then((result) => {
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
        return import("obsidian").then(({ Notice }) => {
          if (result.ok) {
            new Notice(`✅ ${result.message}`);
          } else {
            new Notice(`❌ ${result.message}`, 10000);
          }
        });
      }).catch((e: Error) => {
        if (this.statusEl) {
          this.statusEl.setText("❌ " + (e?.message || "Unknown error"));
          this.statusEl.toggleClass("memos-sync-success", false);
          this.statusEl.toggleClass("memos-sync-error", true);
        }
      }).finally(() => {
        testBtn.disabled = false;
      });
    });

    // Settings button
    const settingsBtn = buttonsSection.createEl("button", {
      cls: "memos-sync-btn",
    });
    const settingsBtnIcon = settingsBtn.createSpan({ cls: "memos-sync-btn-icon" });
    setIcon(settingsBtnIcon, "settings");
    settingsBtn.createSpan({ text: " Settings" });
    settingsBtn.addEventListener("click", () => {
      // Open plugin settings using internal API
      const appWithSetting = this.app as AppWithSetting;
      appWithSetting.setting.open();
      appWithSetting.setting.openTabById("memos-sync");
    });

    // Info section
    const infoSection = container.createDiv({ cls: "memos-sync-info" });
    infoSection.createEl("p", {
      text: "Syncs your Memos to today's daily note. Configure server URL and access token in Settings.",
      cls: "memos-sync-info-text",
    });

    return Promise.resolve();
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

  onClose(): Promise<void> {
    // Cleanup if needed
    return Promise.resolve();
  }
}
