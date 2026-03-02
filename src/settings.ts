import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type MemosSyncPlugin from "./main";

/**
 * Plugin settings interface
 */
export interface MemosSyncSettings {
  // Memos server configuration
  memosServerUrl: string;
  memosAccessToken: string;

  // Sync configuration
  autoSync: boolean;
  syncIntervalMinutes: number;

  // File/folder configuration
  dailyNotesFolder: string;
  fileNameFormat: string; // e.g., "YYYY-MM-DD"
  memosHeading: string; // heading under which memos are appended
  insertPosition: "top" | "bottom"; // where to insert memos section

  // Content formatting
  memoTemplate: string; // template for each memo item
  dateTimeFormat: string; // date-time format for memo timestamps
  tagPrefix: string; // prefix for memos tags

  // Filter
  filterTag: string; // only sync memos with this tag (empty = all)
  syncLimit: number; // max memos to fetch per sync
  syncLookbackDays: number; // how many past days to sync (0 = today only)

  // Startup & Auto triggers
  syncOnStartup: string; // "off" | "1" | "10" | "30" — delay in seconds after startup
  syncOnFileOpen: boolean; // sync memos when opening a daily note within lookback range
}

export const DEFAULT_SETTINGS: MemosSyncSettings = {
  memosServerUrl: "",
  memosAccessToken: "",
  autoSync: false,
  syncIntervalMinutes: 30,
  dailyNotesFolder: "DailyNotes",
  fileNameFormat: "YYYY-MM-DD",
  memosHeading: "## Memos",
  insertPosition: "bottom",
  memoTemplate: "- ⏰ {{time}} | {{content}}",
  dateTimeFormat: "HH:mm",
  tagPrefix: "#",
  filterTag: "",
  syncLimit: 100,
  syncLookbackDays: 3,
  syncOnStartup: "off",
  syncOnFileOpen: false,
};

export class MemosSyncSettingTab extends PluginSettingTab {
  plugin: MemosSyncPlugin;

  constructor(app: App, plugin: MemosSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Memos Server ---
    new Setting(containerEl)
      .setName("Memos server configuration")
      .setHeading();

    new Setting(containerEl)
      .setName("Memos server URL")
      .setDesc(
        "The base URL of your Memos instance (e.g., https://memos.example.com)"
      )
      .addText((text) =>
        text
          .setPlaceholder("https://memos.example.com")
          .setValue(this.plugin.settings.memosServerUrl)
          .onChange(async (value) => {
            this.plugin.settings.memosServerUrl = value.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Access token")
      .setDesc("Your Memos API access token for authentication")
      .addText((text) =>
        text
          .setPlaceholder("Enter your access token")
          .setValue(this.plugin.settings.memosAccessToken)
          .onChange(async (value) => {
            this.plugin.settings.memosAccessToken = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Sync Settings ---
    new Setting(containerEl)
      .setName("Sync settings")
      .setHeading();

    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Automatically sync memos at a regular interval")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
          this.plugin.resetAutoSync();
        })
      );

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often to auto-sync memos (in minutes)")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.syncIntervalMinutes = parsed;
              await this.plugin.saveSettings();
              this.plugin.resetAutoSync();
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync limit")
      .setDesc("Maximum number of memos to fetch per sync")
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(String(this.plugin.settings.syncLimit))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.syncLimit = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    // --- File & Folder ---
    new Setting(containerEl)
      .setName("File and folder settings")
      .setHeading();

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where daily notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("DailyNotes")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("File name format")
      .setDesc(
        "Date format for daily note file names (e.g., YYYY-MM-DD, YYYY/MM/YYYY-MM-DD)"
      )
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.fileNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.fileNameFormat = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Content Formatting ---
    new Setting(containerEl)
      .setName("Content formatting")
      .setHeading();

    new Setting(containerEl)
      .setName("Memos section heading")
      .setDesc("The heading text for the memos section in your daily note")
      .addText((text) =>
        text
          .setPlaceholder("## Memos")
          .setValue(this.plugin.settings.memosHeading)
          .onChange(async (value) => {
            this.plugin.settings.memosHeading = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Insert position")
      .setDesc("Where to insert the memos section in the daily note")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bottom", "Bottom of file")
          .addOption("top", "Top of file")
          .setValue(this.plugin.settings.insertPosition)
          .onChange(async (value) => {
            this.plugin.settings.insertPosition = value as "top" | "bottom";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Memo template")
      .setDesc(
        "Template for each memo. Placeholders: {{time}}, {{content}}, {{tags}}, {{uid}}"
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("- ⏰ {{time}} | {{content}}")
          .setValue(this.plugin.settings.memoTemplate)
          .onChange(async (value) => {
            this.plugin.settings.memoTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Time format")
      .setDesc("Format for memo timestamps (e.g., HH:mm, HH:mm:ss)")
      .addText((text) =>
        text
          .setPlaceholder("HH:mm")
          .setValue(this.plugin.settings.dateTimeFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateTimeFormat = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tag prefix")
      .setDesc("Prefix for tags in memos (e.g., # or #memos/)")
      .addText((text) =>
        text
          .setPlaceholder("#")
          .setValue(this.plugin.settings.tagPrefix)
          .onChange(async (value) => {
            this.plugin.settings.tagPrefix = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Startup & Auto Triggers ---
    new Setting(containerEl)
      .setName("Auto triggers")
      .setHeading();

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc(
        "Automatically sync once after Obsidian starts. Changes take effect on next launch."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("off", "Off")
          .addOption("1", "After 1 second")
          .addOption("10", "After 10 seconds")
          .addOption("30", "After 30 seconds")
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync on daily note open")
      .setDesc(
        "When you open a daily note within the lookback range, automatically sync the latest memos for that date."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnFileOpen)
          .onChange(async (value) => {
            this.plugin.settings.syncOnFileOpen = value;
            await this.plugin.saveSettings();
            this.plugin.resetFileOpenSync();
          })
      );

    // --- Filter ---
    new Setting(containerEl)
      .setName("Filter")
      .setHeading();

    new Setting(containerEl)
      .setName("Sync lookback days")
      .setDesc(
        "How many past days to sync in addition to today (0 = today only, 3 = today + past 3 days). Useful for catching edits to older memos."
      )
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.syncLookbackDays))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 30) {
              this.plugin.settings.syncLookbackDays = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Filter by tag")
      .setDesc("Only sync memos that contain this tag (leave empty to sync all)")
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.filterTag)
          .onChange(async (value) => {
            this.plugin.settings.filterTag = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Actions ---
    new Setting(containerEl)
      .setName("Actions")
      .setHeading();

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Test the connection to your Memos server")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const result = await this.plugin.memosApi.testConnectionDetailed();
            if (result.ok) {
              new Notice(`✅ ${result.message}`);
            } else {
              // Show detailed error with longer duration
              new Notice(`❌ ${result.message}`, 10000);
            }
          } catch (e) {
            new Notice("❌ Unexpected error: " + (e as Error).message, 10000);
          } finally {
            button.setButtonText("Test");
            button.setDisabled(false);
          }
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Manually trigger a sync right now")
      .addButton((button) =>
        button.setButtonText("Sync Now").onClick(async () => {
          await this.plugin.syncMemos();
        })
      );
  }
}
