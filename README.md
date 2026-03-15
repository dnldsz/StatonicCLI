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

### `project`

Manage video project JSON files.

```bash
statonic project read <path>
```
Read and pretty-print a project file — shows all tracks, segments, durations, and clip sources.

```bash
statonic project list [--account <id>]
```
List all saved projects for the active account (or a specified one).

```bash
statonic project write <json> <filename>
```
Write a raw project JSON to the projects directory. `<json>` is the full project JSON string; `<filename>` is the output filename (without path).

```bash
statonic project export <path> [--output <output-path>]
```
Export a project to MP4 via FFmpeg. If `--output` is omitted, writes to the same directory as the project file.

---

### `segment`

Edit segments within an existing project.

```bash
statonic segment update <project-path> <segment-id> <json-patch>
```
Merge a JSON patch object into a segment. Example: `statonic segment update proj.json abc123 '{"fontSize":100}'`

```bash
statonic segment delete <project-path> <segment-id>
```
Remove a segment by ID from its track.

```bash
statonic segment add-text <project-path> \
  --text "Your text here" \
  --start <seconds> \
  --duration <seconds> \
  [--x 0] [--y 0.28] [--font-size 85] \
  [--color "#ffffff"] [--bold true] [--italic false] \
  [--stroke-enabled true] [--stroke-color "#000000"] \
  [--text-align center]
```
Add a new text segment to the project. Coordinates `x`/`y` are in canvas space (`-1` to `1`). Appends to an existing text track or creates one.

```bash
statonic segment add-zoom <project-path> <segment-id> \
  --keyframes '[{"time_sec": 0, "scale": 1}, {"time_sec": 2, "scale": 1.3}]'
```
Attach zoom keyframes to a video segment. `time_sec` is relative to the segment start; `scale` is the zoom multiplier.

---

### `preview` / `frames` / `video-info`

Inspect videos and render frame previews.

```bash
statonic preview <project-path> [--time <seconds>] [--output <path>]
```
Render a single frame from a project at the given time (default: 0s). Outputs a JPEG.

```bash
statonic frames <video-path> [--times 1,2.5,4] [--output-dir ./]
```
Extract frames from a raw video file at specified timestamps (comma-separated seconds).

```bash
statonic video-info <video-path>
```
Print duration, resolution, codec, and frame rate for a video file.

---

### `video`

Build and preview projects from templates.

```bash
statonic video build <template-id> \
  [--name "Project name"] \
  [--topic "Topic text"] \
  [--hook <clip-id>] \
  [--gizmo <clip-id>] \
  [--slot '{"slot_id":"hook","clip_id":"abc","text":"Override"}'] \
  [--no-telegram]
```
Build a project from a template. Clips are selected from the library by category. `--hook` and `--gizmo` are shorthand slot overrides. `--topic` replaces `[TOPIC]` placeholders in template example text. Renders preview frames at segment midpoints and sends to Telegram unless `--no-telegram`.

```bash
statonic video preview <project-path> \
  [--telegram] \
  [--times 1,3,5]
```
Render preview frames for an existing project. Use `--times` to specify exact timestamps (seconds). Without `--times`, samples midpoints of each video segment. Use `--telegram` to send to Telegram.

---

### `clip`

Manage the clip library.

```bash
statonic clip analyze <video-path> \
  [--metadata '{"category":"hook","name":"My Clip"}'] \
  [--keyframes <n>]
```
Analyze a video clip and add it to the library. Extracts duration, resolution, and optionally sample keyframes. The `--metadata` JSON can include `category`, `name`, `tags`.

```bash
statonic clip index [<folder>] [--regenerate]
```
Index all clips in the library (or a specific folder). Scans for `.mp4`/`.mov`/`.m4v` files, reads or creates `metadata.json` per clip. `--regenerate` re-runs analysis on already-indexed clips.

```bash
statonic clip search <query> [--category <cat>] [--account <id>]
```
Search the clip library by text query against clip names and tags. Filter by category.

```bash
statonic clip list [--category <cat>] [--account <id>]
```
List all clips in the library, grouped by category.

---

### `template`

Manage video templates.

```bash
statonic template list
```
List all available templates with their ID, name, number of slots, and total duration.

```bash
statonic template use <template-id> [--name "Project name"] [--slots <json>]
```
Create a project from a template. `--slots` is a JSON array of slot overrides: `[{"slot_id":"hook","clip_id":"abc123","text":"Custom text"}]`. Saves the project and prints its path.

---

### `hook`

Generate and learn from hook content.

```bash
statonic hook generate <topic>
```
Generate hook text variations for a given topic using accumulated hook knowledge. Outputs multiple hook options with format analysis.

```bash
statonic hook learn <video-path>
```
Analyze a high-performing video's hook and add structural patterns to the hook knowledge base. Used to continuously improve hook generation.

---

### `variation`

Create multiple project variations.

```bash
statonic variation create <project-path> \
  --variations '[{"name":"V1","segments":{"id1":{"text":"Alt text"}}}]' \
  [--output-dir <path>]
```
Generate multiple project files from one base project. Each variation specifies segment patches by ID. Useful for A/B testing different text or timing. Outputs one JSON file per variation.

---

### `audio`

Find suitable background audio.

```bash
statonic audio find \
  --hook-duration <seconds> \
  --total-duration <seconds> \
  [--prefer-closest]
```
Search the audio library for tracks that fit the video structure. `--hook-duration` filters for tracks that have an energy shift at approximately that point. `--prefer-closest` picks the single closest match rather than listing all candidates.

---

### `account`

Manage accounts (separate clip libraries and project spaces per account).

```bash
statonic account list
```
List all accounts.

```bash
statonic account set <id>
```
Set the active account.

```bash
statonic account create <name>
```
Create a new account with the given name. Generates a unique ID.

---

### `reel`

Analyze short-form video reels at scale to extract structural patterns.

#### Pipeline

1. Obtain a reel (download externally or place `video.mp4` in `AppData/reels/<id>/`)
2. `reel detect <id>` — FFmpeg scene detection → `scenes.json` + keyframe images
3. Claude reads keyframes → writes `analysis.json` (logical scenes, hook type, text overlays)
4. `reel inspect <id>` — pretty-print full analysis
5. `reel insights` — aggregate statistics across all analyzed reels
6. `reel top` — ranked table of top performers

#### Commands

```bash
statonic reel detect <id-or-path> [--threshold <0.3>]
```
Run FFmpeg scene change detection on a reel. `<id>` must match a folder in `AppData/reels/`. `--threshold` controls sensitivity (0–1; lower = more cuts detected; default 0.3). Writes `scenes.json` and extracts one keyframe JPEG per scene into `keyframes/`.

```bash
statonic reel analyze <id> [--json '<analysis-json>']
```
Without `--json`: prints scene data and keyframe file paths for Claude to analyze visually.
With `--json`: saves the `ReelAnalysis` JSON that Claude produces after viewing the keyframes. Fields: `logical_scenes`, `hook_type`, `hook_duration`, `persistent_text`, `structure_summary`, `notes`.

```bash
statonic reel batch <csv-or-xlsx> \
  [--company <name>] \
  [--min-views <n>] \
  [--max-views <n>] \
  [--limit <n>]
```
Bulk process reels from a spreadsheet. The file must have columns containing `url`/`link` and `view` in their headers. Runs `metadata.json` + scene detection for each reel whose `video.mp4` is already present. `--company` filters by company/brand name. Sorts by views descending (ascending when only `--max-views` is set).

```bash
statonic reel inspect <id>
```
Print full reel details: metadata (URL, views, duration, resolution), logical scenes with text overlays and visual descriptions, hook type, persistent text, and notes. Falls back to raw scene data if no `analysis.json` exists yet.

```bash
statonic reel insights
```
Aggregate statistics across all reels with scene data. Outputs per-tier breakdowns (1M+, 100K–1M, 50K–100K, <50K): average hook duration, scene count, clip duration, cuts per second. Pearson correlations with view count. Common structure patterns with average views. Writes `AppData/reels/insights.json`.

```bash
statonic reel top [--min-views <n>] [--limit <n>]
```
Print a ranked table of top-performing reels. Columns: ID, views, duration, scene count, hook duration, cuts/sec, company. Default minimum: 100K views; default limit: 20 rows.

---

### `telegram`

Send files to Telegram.

```bash
statonic telegram <file-path> [--caption "Message"]
```
Send any file to the configured Telegram bot/chat. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars (or set via `statonic config set`).

---

### `migrate`

```bash
statonic migrate
```
Migrate project and clip data from the legacy Electron app format to the current CLI data structure.

---

## Data Structure

```
AppData/
  config.json
  projects/accounts/<account-id>/
    <project-name>.json
  clip-library/accounts/<account-id>/clips/
    <clip-id>/
      video.mp4 (or .mov)
      metadata.json    # id, name, category, duration, width, height, tags
  audio-library/
    <track>.mp3
  templates/
    <template-id>.json
  reels/
    index.json
    <reel-id>/
      video.mp4
      metadata.json    # id, url, views, company, date, duration, width, height
      scenes.json      # raw cuts + aggregate stats
      analysis.json    # Claude's logical scene analysis
      keyframes/
        scene-0.jpg
        scene-1.jpg
        ...
```

## Project JSON Format

```json
{
  "name": "My Video",
  "canvas": { "width": 1080, "height": 1920 },
  "tracks": [
    {
      "id": "...",
      "type": "video",
      "label": "VIDEO",
      "segments": [
        {
          "id": "...",
          "type": "video",
          "src": "/path/to/clip.mp4",
          "name": "Clip name",
          "startUs": 0,
          "durationUs": 4000000,
          "sourceStartUs": 0,
          "sourceDurationUs": 4000000,
          "fileDurationUs": 10000000,
          "sourceWidth": 1080,
          "sourceHeight": 1920,
          "clipX": 0, "clipY": 0, "clipScale": 1,
          "cropLeft": 0, "cropRight": 0, "cropTop": 0, "cropBottom": 0
        }
      ]
    },
    {
      "id": "...",
      "type": "text",
      "label": "TEXT",
      "segments": [
        {
          "id": "...",
          "type": "text",
          "text": "Your text here",
          "startUs": 0,
          "durationUs": 4000000,
          "x": 0, "y": 0.28,
          "fontSize": 85,
          "color": "#ffffff",
          "bold": false,
          "italic": false,
          "strokeEnabled": true,
          "strokeColor": "#000000",
          "strokeWidth": 4,
          "textAlign": "center",
          "textScale": 1
        }
      ]
    }
  ]
}
```

Time values are in **microseconds** (multiply seconds by `1e6`). Canvas coordinates are in the range `-1` to `1` (center = 0).
