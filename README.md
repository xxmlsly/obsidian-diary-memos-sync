# Diary Memos Sync

An [Obsidian](https://obsidian.md/) plugin that syncs your [Memos](https://www.usememos.com/) to daily notes automatically or manually.

## ✨ Features

- **📥 Sync Memos to Daily Notes** — Fetches memos from your Memos server and writes them into Obsidian daily notes
- **🔄 Auto Sync** — Set a sync interval (e.g., every 30 minutes) and let it run in the background
- **📂 Lookback Sync** — Sync not just today, but also the past N days to catch edits to older memos
- **🚀 Startup Sync** — Optionally sync on Obsidian startup with a configurable delay
- **📝 Sync on File Open** — Automatically sync when opening a daily note within the lookback range
- **🧠 Smart Merge** — Uses UID-based tracking to update existing memos, add new ones, and preserve your manual notes
- **🏷️ Tag Filtering** — Only sync memos that contain a specific tag
- **🎨 Customizable Templates** — Full control over how memos are formatted with template placeholders
- **🔗 Test Connection** — Built-in connection test to verify your server and token setup

## 📦 Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian **Settings** → **Community Plugins** → **Browse**
2. Search for **"Diary Memos Sync"**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/xxmlsly/obsidian-diary-memos-sync/releases)
2. Create a folder `obsidian-diary-memos-sync` in your vault's `.obsidian/plugins/` directory
3. Copy `main.js` and `manifest.json` into that folder
4. Restart Obsidian and enable the plugin in **Settings → Community Plugins**

## ⚙️ Configuration

Open **Settings → Diary Memos Sync** to configure the plugin.

### Memos Server

| Setting | Description |
|---------|-------------|
| **Memos Server URL** | The base URL of your Memos instance (e.g., `https://memos.example.com`) |
| **Access Token** | Your Memos API access token ([how to get it](#getting-an-access-token)) |

### Sync Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Auto Sync** | Off | Automatically sync memos at a regular interval |
| **Sync Interval** | 30 min | How often to auto-sync |
| **Sync Limit** | 100 | Maximum number of memos to fetch per sync |

### File & Folder

| Setting | Default | Description |
|---------|---------|-------------|
| **Daily Notes Folder** | `DailyNotes` | Folder where daily notes are stored |
| **File Name Format** | `YYYY-MM-DD` | Date format for daily note filenames (supports `YYYY/MM/YYYY-MM-DD` for subfolder structures) |

### Content Formatting

| Setting | Default | Description |
|---------|---------|-------------|
| **Memos Section Heading** | `## Memos` | The heading under which memos are inserted |
| **Insert Position** | Bottom | Where to insert the memos section (`top` or `bottom`) |
| **Memo Template** | `- ⏰ {{time}} \| {{content}}` | Template for each memo item |
| **Time Format** | `HH:mm` | Timestamp format (e.g., `HH:mm`, `HH:mm:ss`) |
| **Tag Prefix** | `#` | Prefix for memo tags |

#### Template Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{time}}` | The memo timestamp |
| `{{content}}` | The memo content |
| `{{tags}}` | The memo tags (formatted with tag prefix) |
| `{{uid}}` | The unique ID of the memo |

### Auto Triggers

| Setting | Default | Description |
|---------|---------|-------------|
| **Sync on Startup** | Off | Sync once after Obsidian starts (configurable delay: 1s / 10s / 30s) |
| **Sync on Daily Note Open** | Off | Sync when opening a daily note within the lookback range |

### Filter

| Setting | Default | Description |
|---------|---------|-------------|
| **Sync Lookback Days** | 3 | How many past days to sync (0 = today only, max 30) |
| **Filter by Tag** | *(empty)* | Only sync memos with this specific tag (empty = sync all) |

## 🚀 Usage

### Manual Sync

- Click the **🔄 ribbon icon** in the left sidebar, or
- Use the command palette: `Diary Memos Sync: Sync Memos Now`

### Toggle Auto Sync

- Use the command palette: `Diary Memos Sync: Toggle Auto Sync`

### Example Output

After syncing, your daily note will contain a section like:

```markdown
## Memos

- ⏰ 09:15 | Had a great idea for the new feature
- ⏰ 12:30 | Meeting notes: discussed Q1 roadmap
- ⏰ 18:45 | Remember to review the PR tomorrow
```

## 🔑 Getting an Access Token

1. Open your Memos web interface
2. Go to **Settings** → **Access Tokens**
3. Click **Create** to generate a new token
4. Copy the token and paste it into the plugin settings

> **Note:** This plugin requires **Memos v0.22+** (latest API).

## 🧠 Smart Merge

This plugin uses a smart merge strategy to avoid data loss:

- Each memo is tracked by its unique ID (invisible `<span>` tag in the note)
- **Updated memos** are replaced in-place
- **New memos** are inserted in chronological order
- **Deleted memos** (removed from Memos server) are automatically cleaned up
- **Manual content** you add within the memos section is preserved in its original position

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/xxmlsly/obsidian-diary-memos-sync.git

# Install dependencies
npm install

# Build the plugin
npm run build

# Development build (watch mode)
npm run dev
```

## 📄 License

[MIT](LICENSE) © xmxiong
