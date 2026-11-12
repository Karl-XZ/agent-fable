# Jing Character Card Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user approved the character-card approach and first-escape unlock, and clarified that browser-only persistence permits transient inference requests. Complete implementation and verification without another approval gate.

**Goal:** Give Jing a consistent editable personality, with personal browser overrides unlocked after the first completed escape ending.

**Architecture:** A shared default card supplies stable character traits, motivations, preferences, speech style, relationships and clearly labelled fictional examples. Backend prompt assembly separates the card, actual dialogue, narrative disclosure, observed memories and a short scene note. Browser localStorage owns unlock/override data; requests may carry a sparse override, while custom-card requests write metadata-only diagnostics.

**Tech Stack:** Existing Python/FastAPI, TypeScript, localStorage, JSON, current settings styles; no added dependencies.

**Spec:** User-approved design in this chat, including local-only persistence and explicit permission to send overrides transiently for inference.

## Constraints and impact

- No physical mouse or foreground browser control; use isolated muted headless tests.
- The unrelated Git root is C:/; do not create a drive-wide worktree or commit. Back up changed project files only.
- Unlock at the completed `out` settlement, never at fall/cinematic start or other endings. Nothing overlays the wordless city film.
- Character identity/world facts, tool validation, perception, waiting and safety rules remain authoritative. Examples are style illustrations, never memories.
- Editing/resetting uses no network. Custom fields travel only in subsequent inference calls, never global/session server settings.
- Custom-card diagnostics exclude request/response/event/state text so accidental echo cannot persist card content.
- Existing dialogue and console channels remain distinct. No artwork, portrait or ending redesign.

## Tasks

- [x] Add shared default card and backend context builder; test field bounds, default isolation, scene notes, actual-history roles and privacy-safe logging red/green.
- [x] Add browser card store with escape-only unlock, sparse bounded overrides, reset, corrupt/blocked storage handling and transient request integration; test red/green.
- [x] Add a settings/editor view in the existing typography and card style, plus first-escape settlement notice. Lock before escape and survive refresh/replay; editing must not move the resident.
- [x] Run full tests, typecheck/build, actual-engine unlock/editor/network-isolation checks and representative actual-model personality checks. Capture screenshots and a concise report.
- [x] Perform a fresh-context final review, reconcile the diff with this scope, restart only verified project processes and verify the current build/API.

## Release and rollback

Use test port 7865 and current game port 7864. Publish the matching frontend/backend together with an additive character-card protocol field. Existing pages require refresh. localStorage keys are versioned and can be removed independently of game data; reset clears only overrides, retaining unlock. Targeted backups live under `.runtime/before-character-card`; reverse these edits and rebuild to roll back without deleting player settings.


## Final verification and rulings

- Python 60 + frontend 79 = 139 tests passed; TypeScript and production build passed.
- Seven actual-model cases passed (default preferences/banter, grounded preference memory, quiet waiting, browser override and independent default); no card marker in server logs.
- Isolated browser editor checks passed, including Tab focus cycle, Escape cancellation, typing isolation, reset/reload and a separate browser context.
- Actual falling/wordless city film/settlement/share/replay passed; local unlock absent during film and present at settlement.
- Fresh read-only review closed the focus-trap finding; no other high/medium blocker. Cleared held interaction input on editor open.
- Ruling: custom-card requests redact all content, not just the incoming card field, and the private flag remains for the current session after reset — generated replies/tools/memories could otherwise echo the card.
- Ruling: preserve current browser origin (7864); a separate 7865 preview used isolated static output, then current production backend/build were verified together. Existing user pages are not refreshed automatically.
- Production server PID 73992, interaction protocol 2, character-card protocol 1. Screenshot/report: docs/静的角色卡验收.html.
- Actual impact matches the planned modules. Existing navigation-contract test now inspects the final current-state message rather than an obsolete fixed index. No new dependency, migration, artwork or additional generation round.
