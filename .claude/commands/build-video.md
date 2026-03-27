# Statonic Video Builder

You are operating the Statonic headless video editor CLI (`statonic`). This document is your complete reference for building short-form social videos (Instagram Reels / TikTok style).

---

## 0. Always start here — discover the workspace

Run this first. It gives you everything in one shot:

```
statonic status --json
```

Returns: active account, all templates with full slot details, all clips by category with IDs, 10 most recent projects, config.

If you already have context from a recent `status` call in this conversation, you don't need to run it again.

---

## 1. What you're building

Videos follow a strict structure: **hook clip → product/technique reveal**. The hook grabs attention in the first ~4 seconds; the rest reveals the payoff (Gizmo app, study techniques, etc.).

### Proven formats (from 80 analyzed reels):

| Hook type | Avg views | Avg hook dur | Total dur | Notes |
|-----------|-----------|--------------|-----------|-------|
| comparison | 1.4M | 4.3s | ~7.3s | #1 format — split screen A+/C- students |
| bold_claim | 1.8M | 4.6s | ~9s | "how you memorized 200 pages in 3 HOURS 🤫" |
| relatable | 1.9M | 5.3s | ~7s | Persistent text across ALL scenes |
| listicle | 507K | 4.0s | ~6.5s | "websites that SAVED me in chemistry" |
| statement | 498K | 2.9s | ~7s | Aesthetic desk shot, short text |
| problem_solution | 1.15M | 3.5s | ~9s | Clear before/after |
| problem_statement | 110K | 2.4s | ~8s | Underperforms — avoid |
| brag | 54K | 4.7s | ~11s | Underperforms — avoid |

**Key insight from data:**
- 1M+ reels: avg **3.7 logical scenes**, **8.2s total**, **3.8s hook**
- <50K reels: avg 4.8 scenes, 9.6s total — longer & more cuts = worse
- Hooks shorter than 2.5s correlate with low views
- The Gizmo reveal **always comes last** — it's the payoff

### Real hook examples (from top performers — adapt the subject, keep the structure)

**#1 — 9.3M views — comparison hook** (3-way split screen, persistent labels across all scenes)
```
Hook text (slot "hook", 3 labels displayed simultaneously):
  "95% Student (A+)\n7:00pm"
  "80% Student (B+)\n7:00pm"
  "60% Student (C-)\n7:00pm"
Structure: hook shows all 3 students starting at 7pm →
           scene 2 shows divergence (60% still up at 2am) →
           scene 3 reveals Gizmo on the A+ student's MacBook
Persistent text carries through: "95% Student (A+)", "80% Student (B+)", "60% Student (C-)"
```

**#2 — 6.5M views — bold_claim hook** (close-up of annotated exam notes, no face)
```
Hook text: '"when people ask how you memorized 200 pages in 3 HOURS 🤫"'
Structure: hook 3.3s → "take a picture of your notes" → "click on memorise" → "and do this 1 hour/day"
Note: quote marks are part of the text — creates intrigue, implies a secret
```

**#3 — 5.3M views — statement hook** (aesthetic minimal desk, no creator face in hook)
```
Hook text: "how to study after school when you're tired"
Structure: hook 2.3s → "save for later..." → "read caption 🔽🤫" → Gizmo on MacBook
Note: lowercase, conversational. "save for later" is a soft CTA that works well
```

**#4 — 3.1M views — relatable hook** (single text overlay persists across ALL scenes)
```
Hook text: "me studying at 2 am because i chose to be happy all afternoon"
Structure: hook 3.7s (2 cuts) → writing in notebook → Gizmo MacBook reveal
Note: same text on EVERY scene — the whole video is one running joke/confession
```

**#5 — 2.8M views — listicle hook** (creator stressed at desk)
```
Hook text: "websites that\nSAVED me\nin chemistry"
Structure: hook 4.4s → Gizmo AI (1s) → Organic Chemistry Tutor (1s)
Note: 3-line layout, capitalised middle line for emphasis
```

**#6 — 2.1M views — problem_solution hook** (phone addiction format)
```
Hook text line 1: "how to END your\nphone addiction\nand study"
Hook text line 2: "from a straight A student 🤫"
Structure: 3 cuts in hook showing phone addiction → Gizmo tutorial body
Note: two separate text segments on the same hook clip for layered messaging
```

**#7 — 1.7M views — bold_claim hook** (efficiency promise)
```
Hook text: "how to\nstudy LESS\nbut\nlearn MORE"
Structure: same Gizmo tutorial body as #2 — same body, different hook
Note: "LESS" and "MORE" in caps for contrast. 4-line layout, punchy
```

**#8 — 1.1M views — curiosity_gap hook** (exam stress)
```
Hook text: "when you have too much to cover for your exam so you pull this move:"
Structure: 5.1s hook → Gizmo tutorial body
Note: ends with a colon — explicitly promises a reveal. Single long line, no breaks
```

**#9 — 759K views — problem_agitation hook** (cascading pain points, 5 text segments)
```
Text 1: "students studying\nTOO MANY subjects\nat once"
Text 2: "*feeling burnout"
Text 3: "*too tired to study"
Text 4: "*falling behind"
Text 5: "*failing exams"
Structure: each pain point appears as its own timed text segment (rapid stacking)
Persistent: "students who follow\nme and use:" (reveals on body clips)
```

**#10 — 1M views — problem_solution hybrid** (phone addiction + technique showcase)
```
Hook text: "how to END your phone addiction and START studying ✅"
Persistent: "students who follow\nme and use:"
Structure: 2-cut phone addiction hook → 4 technique clips with technique names
Note: single-line hook (no breaks), ✅ at end. Persistent text sets up the body
```

**Pattern rules extracted from the data:**
- Comparison format: always use `\n` between label and timestamp (`"A+ Student\n7:00pm"`)
- Problem hooks: break at 3 lines max, caps on the key verb (`END`, `LESS`, `MORE`, `SAVED`)
- Relatable/statement: all lowercase, conversational tone, no caps
- Bold claim: use quote marks around the text to imply "this is what people say about me"
- Persistent text: set same text on multiple segments to carry a message across scenes
- `🤫` emoji appears in 4 of the top 10 — it signals a secret/hack which fits the content

---

## 2. Templates

Templates define the video structure. Use `statonic status --json` to get the full slot list.

### `hook_gizmo` — 6.4s total
Classic 2-scene format: 4.2s hook → 2.2s Gizmo reveal.
Best for: statement, bold_claim, relatable hooks.

```
statonic video build hook_gizmo \
  --name "Study Hook" \
  --hook <clip-id> \
  --slot '{"slot_id":"gizmo","clip_id":"<clip-id>","text":"ACTIVE RECALL 🤫"}' \
  --no-telegram
```

### `hook_multi_showcase` — 8.2s total
5-scene format: 4.2s hook → gizmo (1s) → 3x showcase clips (1s each).
Best for: listicle hooks ("4 techniques that..."), comparison hooks.

```
statonic video build hook_multi_showcase \
  --name "4 Techniques" \
  --hook <clip-id> \
  --slot '{"slot_id":"technique_1","clip_id":"<clip-id>","text":"ACTIVE RECALL 🤫"}' \
  --slot '{"slot_id":"technique_2","clip_id":"<clip-id>","text":"SPACED REPETITION 📅"}' \
  --slot '{"slot_id":"technique_3","clip_id":"<clip-id>","text":"GAMIFICATION 🎮"}' \
  --slot '{"slot_id":"technique_4","clip_id":"<clip-id>","text":"POMODORO METHOD ⏱️"}' \
  --no-telegram
```

`--hook` and `--gizmo` are shortcuts for the `hook` and `gizmo` slot IDs.
For all other slots use `--slot '{"slot_id":"...","clip_id":"...","text":"..."}'`.

The command saves the project and renders preview frames automatically.
**Capture the path from**: `Saved: <project-path>`

---

## 3. Clip categories

Clips are organized by category. Pick by category and specific ID from `statonic status --json`.

| Category | Purpose |
|----------|---------|
| `hook` | Hook clips — stressed student, desk aesthetic, face reactions |
| `gizmo` | Gizmo app on MacBook/phone — Biology flashcards, +XP screens |
| `showcase` | Study technique demonstrations — notes, writing, reading |

Pick specific clip IDs based on their descriptions. Examples:
- "grey hoodie face hide" → student stressed, face partly hidden (generic hook)
- "black tee side gizmo" → includes Gizmo in frame (good for gizmo slot)
- "silhouette stressed hook" → dramatic silhouette (high-contrast hook)

---

## 4. Inspect a built project (get segment IDs)

```
statonic project read <project-path> --json
```

Returns the full Project object. Each segment has an `id` field needed for updates.

---

## 5. Update segments after build

```
statonic segment update <project-path> <segment-id> '<json-patch>'
```

Common patches:
```json
// Change clip
{"src": "/path/to/clip.mp4", "name": "clip name"}

// Change text
{"text": "NEW TEXT\nline two"}

// Reposition clip
{"clipX": 0.0, "clipY": -0.1, "clipScale": 1.1}

// Crop edges
{"cropLeft": 0.05, "cropRight": 0.05}

// Shift timing (microseconds = seconds × 1,000,000)
{"startUs": 0, "durationUs": 4200000}
```

Add a zoom animation (default to 1.25x end scale — 1.15x is too subtle):
```
statonic segment add-zoom <project-path> <segment-id> \
  --keyframes '[{"time_sec":0,"scale":1},{"time_sec":2,"scale":1.25}]'
```

Add a new text overlay:
```
statonic segment add-text <project-path> \
  --text "BONUS TIP" --start 4.2 --duration 2.2 --y 0.28 --font-size 85
```

Delete a segment:
```
statonic segment delete <project-path> <segment-id>
```

---

## 6. Preview

Render a single frame at a timestamp:
```
statonic preview <project-path> --time 2.1 --output /tmp/preview.jpg
```

Render multiple frames and send to Telegram:
```
statonic video preview <project-path> --times 1.0,3.5,5.0 --telegram
```

Auto-preview (samples midpoint of each video segment):
```
statonic video preview <project-path> --telegram
```

---

## 7. Export to MP4

```
statonic project export <project-path> --output /tmp/final.mp4
```

---

## 8. Create variations

After building, generate multiple text/clip variations from one project:
```
statonic variation create <project-path> \
  --variations '[
    {"name":"V1","textChanges":[{"find":"chemistry","replace":"biology"}]},
    {"name":"V2","clipOverrides":[{"segmentId":"<seg-id>","clipPath":"/path/clip.mp4"}]}
  ]' \
  --output-dir /path/to/variations/
```

---

## 9. Music

Music is extracted from downloaded reference reels and stored in the audio library. The beat drop is aligned to the hook→gizmo cut point automatically.

### Extract audio from a reel:
```
statonic audio extract-reel <reel-id>
```
Auto-detects the drop time from the reel's `scenes.json` (uses `hook_duration`, which is the first visual cut — same as where the beat drops). Override with `--drop-time <sec>` if needed.

```
statonic audio list        # see what's in the library
```

### Music in video build:
`video build` automatically picks music from the audio library if any track has:
- `dropTimeMs >= hookDuration * 1000`
- `duration >= totalDuration`

It picks the track whose drop time is closest to the hook cut and aligns the beat drop to the transition. No flags needed — it just works if music is in the library.

### Export with Telegram:
```
statonic project export <project-path> --telegram
```
Sends the exported MP4 as a video (not document) to Telegram after export completes.

---

## 10. Typical workflow

```
# 1. See what's available
statonic status --json

# 2. Build video (auto-picks clips if no --hook/--gizmo)
statonic video build hook_gizmo \
  --name "How to Study Biology" \
  --hook 06c644e713fe \
  --no-telegram

# 3. Read segment IDs from saved project
statonic project read <saved-path> --json

# 4. Tune text or swap a clip
statonic segment update <path> <seg-id> '{"text":"how to study\nbiology\nin 1 hour"}'

# 5. Preview and send
statonic video preview <path> --telegram

# 6. Export and send to Telegram
statonic project export <path> --telegram
```

---

## 10. What makes a good video — editorial guidance

**Instagram Reels safe area (1080×1920):**
- Bottom ~380px is covered by the interaction bar (like, comment, share) — text placed there will be hidden
- Safe y range: **-0.6 to 0.85** (y=0 is center, y=1 is top, y=-1 is bottom)
- Default text position: y=0.28 (upper-center) — safest for hook text
- NEVER place text below y=-0.6 unless it's intentionally off-screen
- `segment add-text` default font-size is 85px — this is too large for 3+ line text; use 72px for 2 lines, 60px for 3-4 lines

**Font size guidance:**
- 1-line short hook: 85-95px
- 2-line hook: 72px
- 3-line hook: 60-65px
- 4-line hook: 55-60px
- Technique labels (body clips): 72-80px

**Hook text rules (from top performers):**
- Keep it to 2-3 short lines, never more
- Use line breaks (`\n`) to control pacing — each line reads separately
- Include a subject (`chemistry`, `biology`, `math`) for searchability
- Emojis at the end of technique names: `ACTIVE RECALL 🤫`, `SPACED REPETITION 📅`
- For comparison hooks, use persistent labels across all 3 scenes

**Timing rules:**
- Hook: 4.0–4.5s (shorter hooks underperform — aim for ~4.2s)
- Gizmo reveal: 1.5–2.5s minimum (too short feels rushed)
- Total video: 7–9s sweet spot (longer = worse retention)
- Each body clip: ~1s each for listicle, 1.5–2s for tutorial steps

**What the top-performing reels have in common:**
- Only 1 cut in the hook (the whole 4.2s is one continuous shot)
- Gizmo app UI is visible and readable in the reveal
- Text is center-aligned, white with black stroke
- The student in the hook looks stressed/tired — relatable emotional hook
- No talking, no voiceover — text-only

**Hook ↔ technique causal link (critical):**
The showcase/technique text must directly answer the hook's implicit question. Weak causal links kill retention — the viewer asked a question in the hook and didn't get a satisfying answer.

| Hook | Matching technique | Weak technique (avoid) |
|------|--------------------|------------------------|
| "how to memorize 200 pages in 3 HOURS" | ACTIVE RECALL 🤫 | POMODORO METHOD ⏱️ |
| "how to END your phone addiction and study" | GAMIFICATION 🎮 | SPACED REPETITION 📅 |
| "websites that SAVED me in chemistry" | Gizmo AI 🤫 | note-taking tips |
| "how to study LESS but learn MORE" | SPACED REPETITION 📅 | writing notes by hand |
| "study after school when you're tired" | ACTIVE RECALL 🤫 (quick, low effort) | long essay techniques |

Rules:
- If the hook mentions **speed/efficiency** → technique must promise fast results (active recall, AI)
- If the hook mentions **phone/distraction** → technique must address focus or gamify studying
- If the hook mentions a **subject** (chemistry, biology) → technique or tool must be subject-specific
- If the hook mentions **tiredness/burnout** → technique must be low-effort or short sessions
- **Never pick a generic technique** that could apply to any hook — it must feel like the direct solution

**What underperforms:**
- Multiple quick cuts in the hook (feels chaotic)
- Brag hooks ("I got 100%...") — audience doesn't connect
- Problem-statement without solution reveal in the video
- Videos over 10s
- Mismatched hook and technique (hook promises one thing, body delivers another)

---

## Notes on reel analysis

The scenes Claude detects via `reel analyze` sometimes overcounts — a single Gizmo clip with multiple flashcard cuts gets detected as multiple logical scenes when it's really one "gizmo reveal" slot. When building templates, treat all post-hook Gizmo footage as one slot regardless of internal cuts.
