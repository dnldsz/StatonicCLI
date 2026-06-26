# Statonic CLI

Headless video editor CLI for building short-form study content videos. Run with `node dist/cli.js` (build first with `npm run build`).

## Key commands

```bash
# Build a video from a template for an account
node dist/cli.js video build <template-id> --account <id> [--no-telegram]

# Export a project to MP4 (and optionally send to Telegram)
node dist/cli.js project export <project-path> [--output <path>] [--telegram]

# Preview a single frame
node dist/cli.js preview <project-path> --time <seconds> --output <path>

# Send any file to Telegram
node dist/cli.js telegram <file-path> --caption "..."

# Import a CapCut project as a template
node dist/cli.js template import <capcut-project-name> [--id <id>]

# List projects/clips/templates
node dist/cli.js project list --account <id>
node dist/cli.js clip list --account <id>
node dist/cli.js template list
```

## Project structure

- **statonic-core** (`../statonic-core`): Shared library — FFmpeg export/preview, text rendering, types, config
- **StatonicCLI** (this repo): CLI commands, CapCut import, video build, clip management
- **iterate-editor** (`../iterate-editor`): WYSIWYG Electron editor

## Data locations

- Templates: `~/Documents/2025/AppData/templates/`
- Projects: `~/Documents/2025/AppData/projects/accounts/<id>/`
- Clip library: `~/Documents/2025/AppData/clip-library/accounts/<id>/clips/`
- Accounts: daniel, stacy

## FFmpeg export pipeline rules

- **NEVER** add `format=yuv420p` or any format filter between an animated `scale` (eval=frame) and the overlay. It kills the zoom animation.
- The base black canvas needs `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` to prevent green tint.
- Text lineHeight is 1.05 (matching editor CSS). Drawtext uses `(lineH-th)/2` for vertical glyph centering.
- All CapCut imports normalize to 1080x1920 canvas.
