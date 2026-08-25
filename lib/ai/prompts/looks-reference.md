# Composed Looks — Reference

Reference for the `look` entries, the primitives each expands to, and the intent it captures. When the user asks for a look by name or paraphrase, emit a `COMPOSE_LOOK` command (inside `emitEditBatch`) with the closest matching `lookKey`. Use `searchRegistry` to confirm exact keys.

## Signature looks (v1 — 100 total)

**a24** — muted contrast, teal shadows, desaturated greens. LUT `a24-moonlight` + `vignette-soft` + `grain-fine-medium` + `curve-lift-blacks`.

**casey-jump** — Casey Neistat edit grammar. Fast ramps between clips, whip-pan transitions, time-remapped punches, caption lower-thirds.

**vhs-dream** — VHS approximation. LUT `vhs-worn` + `chromatic-aberration-drift` + `tape-lines-periodic` + `audio-saturation-soft`.

**skull-face-drop** — composite. Requires `analyzeBeats` + `detectFaces`. Places skull overlay on tracked face over the drop window (±1.5s), stacks `rgb-split-hard` + `zoom-punch` + `glitch-bars` + `chromatic-flash` in quick succession on the drop frame. Use `intensity: 'light' | 'medium' | 'hard'` to scale shader strengths.

**cinema-warm** — Kodachrome-ish warm grade. LUT `kodachrome-64` + `contrast-cream` + `halation-soft`.

**brutalist-mono** — desaturate to black & white, bump contrast, crush blacks, hairline frame.

**hypebeast-punch** — zoom punch on beats, chromatic on drops, oversized draft-mono lower-thirds.

**glossy-pop** — modern pop edit. Bright midtones, saturated skin, punchy transitions.

**document** — documentary grade: neutral, soft contrast, subtle grain, no stylization.

**…** (91 more, declared as `entries/looks/*.json` — call `searchRegistry({ query })` to find the right one, or ask the user which to pick).

## How to pick

- If the user says a look name verbatim → use that key.
- If the user paraphrases (*"like Casey"*, *"A24 vibe"*, *"VHS feel"*) → pick the closest look key.
- If the user describes novel aesthetics you don't have a key for → compose from primitives with individual `ADD_EFFECT` commands rather than `COMPOSE_LOOK`, and tell the user "going freehand on this one."
