# Statonic CLI

Headless CLI for the Statonic video editor. Build, preview, and export short-form video projects; analyze reels at scale; manage a structured clip library and template system.

## Installation

```bash
npm install
npm run build
# Run with:
node dist/cli.js <command>
# Or link globally:
npm link
```

## Configuration

```bash
statonic config                          # Show current config
statonic config set <key> <value>        # Set a config value
```

Config keys: `fontPath`, `telegramBotToken`, `telegramChatId`, `activeAccountId`.

Data is stored in `AppData/` (default: `/Users/<you>/Documents/2025/AppData`). Override with `STATONIC_DATA_DIR` env var.

---

## Commands

### `video`

Build and preview projects from templates.

```bash
statonic video build <template-id> \
  [--name "Project name"] \
  [--account <id>] \
  [--clips '{"slot_0":"clipId","slot_1":"clipId",...}'] \
  [--no-telegram]
```
Build a project from a template. Use `--clips` to specify exact clip IDs for each slot (recommended). Without `--clips`, picks randomly from each slot's category pool. Renders preview frames and sends to Telegram unless `--no-telegram`.

```bash
statonic video preview <project-path> \
  [--telegram] \
  [--times 1,3,5]
```
Render preview frames for an existing project. Use `--times` to specify exact timestamps (seconds). Without `--times`, samples midpoints of each video segment. Use `--telegram` to send to Telegram.

---

### `project`

Manage video project JSON files.

```bash
statonic project read <path> [--json]
statonic project list [--account <id>]
statonic project write <json> <filename>
statonic project export <path> [--output <output-path>] [--telegram]
```

---

### `segment`

Edit segments within an existing project.

```bash
statonic segment update <project-path> <segment-id> <json-patch>
statonic segment delete <project-path> <segment-id>
statonic segment add-text <project-path> \
  --text "Your text here" --start <seconds> --duration <seconds> \
  [--x 0] [--y 0.28] [--font-size 85]
statonic segment add-zoom <project-path> <segment-id> \
  --keyframes '[{"time_sec": 0, "scale": 1}, {"time_sec": 2, "scale": 1.3}]'
```

---

### `clip`

Manage the clip library. Clips are organized with hierarchical categories: `hook`, `gizmo`, `showcase/feynman`, `showcase/scribble`.

```bash
statonic clip analyze <video-path> --metadata '<json>'
```
Analyze a video clip and save metadata. Auto-fills duration and resolution from the file.

```bash
statonic clip update <clip-id> --metadata '<json>' [--account <id>]
```
Update metadata on an existing clip (e.g., change category, description, tags).

```bash
statonic clip list [--category <cat>] [--account <id>] [--json]
```
List clips. `--category showcase` matches all `showcase/*` children.

---

### `preview` / `frames` / `video-info`

```bash
statonic preview <project-path> [--time <seconds>] [--output <path>]
statonic frames <video-path> [--times 1,2.5,4] [--output-dir ./]
statonic video-info <video-path>
```

---

### `template`

```bash
statonic template list [--json]
```

---

### `hook`

```bash
statonic hook generate <topic>
statonic hook learn <video-path>
```

---

### `variation`

```bash
statonic variation create <project-path> \
  --variations '<json>' [--output-dir <path>]
```

---

### `audio`

```bash
statonic audio extract-reel <reel-id> [--drop-time <sec>] [--name "..."]
statonic audio list
statonic audio find --hook-duration <s> --total-duration <s>
```

---

### `account`

```bash
statonic account list
statonic account set <id>
statonic account create <name>
```

---

### `reel`

Analyze short-form video reels at scale.

```bash
statonic reel download <url> [--views <n>] [--company <name>]
statonic reel detect <id-or-path> [--threshold <0.3>]
statonic reel analyze <id> [--json '<analysis-json>']
statonic reel batch <csv-or-xlsx> [--limit <n>] [--min-views <n>] [--max-views <n>]
statonic reel inspect <id>
statonic reel insights
statonic reel top [--min-views <n>] [--limit <n>]
```

---

### Utility

```bash
statonic status [--json]                 # Show complete workspace state
statonic telegram <file-path> [--caption "..."]
statonic config                          # Show current config
```

---

## Data Structure

```
AppData/
  config.json
  accounts.json
  projects/accounts/<account-id>/
    <project-name>.json
  clip-library/accounts/<account-id>/clips/
    <clip-id>/
      video.mp4 (or .mov)
      metadata.json    # id, name, category, duration, description, tags
      thumb.jpg
  audio-library/<track-id>/
    metadata.json
    audio.mp3
  templates/
    <template-id>.json
  reels/
    index.json
    <reel-id>/
      video.mp4
      metadata.json
      scenes.json
      analysis.json
      keyframes/
```

Time values are in **microseconds** (multiply seconds by `1e6`). Canvas coordinates are in the range `-1` to `1` (center = 0).
