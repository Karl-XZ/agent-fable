# Jing Contextual Behavior Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. The user approved the full in-chat design and requested implementation and comprehensive testing; continue through verification without another approval gate.

**Goal:** Make Jing respond to the resident's current activity and evolving relationship, preserving promises and observed facts instead of repeatedly navigating to the memory door.

**Architecture:** A frontend interaction-memory module stores observable events, sustained activities, commitments and durable relationship facts. A shared mode catalog and backend prompt let the LLM interpret intent and select among 15 behavior modes, with independently chosen private mood and performed delivery. Frontend reconciliation rejects stale navigation, protects unknown locations, allows silence and prioritizes actual rescue.

**Tech Stack:** Existing TypeScript/Three.js, Python/FastAPI, JSON, Node assert tests and isolated muted headless Playwright; no new dependencies.

**Spec:** User-approved discussion in this chat: 15 contextual modes, concurrent relationship/knowledge/performance dimensions, no automatic hostile interpretation of unusual behavior, meaningful silence and safety overriding disputes.

## Global Constraints

- Do not control the user's physical mouse or foreground apps.
- Keep credentials backend-only and never print `.env` values.
- Preserve the current opening, memory narration, compass/input fixes, model-base fix and wordless escape cinematic followed by settlement.
- No mood/state HUD. No automatic portrait/UI redesign in this change.
- Keep the actual A* navigation convention and independent true mood/voice performance.
- No automatic hostility from reading a clue, brief idling or a single insult.
- Sight loss must not disclose the resident's current activity, target or coordinates.
- Relationship exposure/rupture facts survive resumed ordinary care; only actual memory-door reset can clear resident memory as a narrative event.
- This project is nested under an unrelated C-drive Git root. Work in the authorized project in place, with targeted file backups; do not create a C-drive worktree or commit unrelated files.

## Shared Contract

`interaction_modes.json` defines care/chat/assist/guide/wait/clarify/probe/conceal/negotiate/guard/restrain/appeal/search/rescue/repair, each with id/label/purpose.

Request `state.interaction` includes mode/mode_label/since/reason, activity {kind,focus,seconds,observed}, exit_promise {status:active|paused|withdrawn,text,reason}, relationship {stance:cooperative|uncertain|guarded|confronted,exposed,ruptured}, commitments, memories, observations {id,type,detail,t}, guidance_allowed, quiet, needs_response, revision. Activity kinds: walking/idle/inspect/reading/resting/carrying/writing/console/composing/unknown.

Optional response `interaction`: {mode,intent,confidence,reason,evidence:string[],exit_promise:keep|pause|resume|withdraw,stance:keep|cooperative|uncertain|guarded|confronted,exposed:boolean,ruptured:boolean,remember:string[],commitment?:{id?:string,text:string,status:active|paused|done|cancelled}}. Evidence refers to observed event IDs in the request. Facts and critical relationship changes require grounded evidence; no classifier based solely on keyword lists. Legacy responses without this field remain compatible.

## Review Focus

- Sustained inspection/rest pauses exit guidance but a short look/stop does not churn modes.
- Heard speech resumes or cancels promises; unheard speech must not enter model history or memory.
- Async replies must not speak an old route or mutate the world after the resident changes activities or danger arises.
- Seeing a clue is not proof that Jing knows the resident discovered a secret.
- Confrontation can calm into care while exposed/ruptured facts remain; rescue still overrides.
- Console statements are not automatically treated as resident statements or broadcast aloud.
- Empty `say` is a valid deliberate action, not a fallback-navigation trigger.

## Task 1: Behavior contract and backend

**Files:** interaction_modes.json, new interaction.py, app.py, narrative.py, story.json, tests/test_interaction.py, existing narrative tests.

- [x] Write and run failing contract/prompt tests.
- [x] Add catalog, contextual prompt and normalized optional interaction decision.
- [x] Replace unconditional exit fixation in SYSTEM and stage-zero facts with activity-sensitive promise rules.
- [x] Validate bad/missing payloads, channel separation, concealment/exposure and independent voice performance.

## Task 2: Observations, memory and execution

**Files:** new web/src/interaction.ts, web/src/agent.ts, web/src/main.ts, tests/interaction.test.cjs, tests/run-interaction-tests.cjs, agent tests.

- [x] Write/run failing tests for all 15 modes and meaningful behavioral transitions.
- [x] Implement sustained activity observation, event IDs, bounded durable memories and commitments, relation flags and quiet speech policy.
- [x] Integrate sensed player activity and heard speech; pause routine decisions while composing and guard hidden information.
- [x] Reconcile and log model choices, preserve query-round semantics, reject stale replies, and make network fallback context-sensitive.
- [x] Verify speech pacing, rescue override, failed-tool results and exceptions releasing busy state.

## Task 3: Verification and release

**Files:** browser verification script, live-model verification script, docs verification report, generated web/dist.

- [x] Typecheck/build; run all existing suites and the new behavioral suites.
- [x] Isolated muted headless test: guide → inspect → wait/assist → rest/care → explicitly resume → confrontation → guarded care → rescue → recovery; also loss of sight and input cancellation.
- [x] Real model scenarios from actual engine observations, including maliciously stale route history and exposed-secret recovery; record honest outputs and failures.
- [x] Verify both cinematic endings, settlement/share/replay, sound/subtitle coordination and existing navigation/input/model regressions.
- [x] Review implementation against spec, fix findings, rebuild and publish through the verified local backend.
- [x] Deliver screenshots/report and precise limits of stochastic/model and hardware testing.

## Impact and Rollback

No database/storage migration or dependency changes. The API gains optional additive decision metadata. Existing narrative disclosure progress stays separate from Jing's observed relationship state.

Actual impact also includes `web/src/tools.ts` (optional exact executed-call evidence), `web/src/navigation.ts` (`stand_up` prerequisite), and `web/package.json` (wire all frontend suites into `npm test`). No portrait/HUD redesign or new gameplay geometry was added. The backend serves the already verified current build and contextual prompt on port 7862; the existing port 7863 and user's browser remain untouched. The recorded current server is `.runtime/server.json`.

The targeted backup `.runtime/before-contextual-behavior` covers the original core files and selected old tests, not a complete project snapshot. To roll back, restore those core files, reverse the small additive tools/navigation/test-script changes, remove the new interaction modules/catalog after restoring their callers, rebuild the frontend and switch the local service only after verifying its process identity. Preserve verification artifacts.

## Final evidence (2026-11-12)

- 51 Python + 59 frontend tests passed (110 total); TypeScript typecheck and Vite production build passed.
- Isolated actual-engine browser: 11 behavior checks / 12 controlled decisions; real provider: 21 cases / zero failures in the final full run.
- Actual Aliyun TTS: 600 ms to first audio, 8.61 s decoded playback, caption offset 0.3 ms, silent quiet follow-up.
- Input/compass, freefall/city/settlement/share/replay, all six settlement cards, and three-quality 36-frame model-base regression passed. Four alternate endings used direct ending hooks rather than full-route playthroughs.
- Latest backend/current assets served on http://127.0.0.1:7862/; real-model quiet-reading release check passed; old port 7863/browser untouched.
- Detailed screenshots and honest test boundaries: `docs/静的情境互动验收.html`; raw data: `docs/静的情境互动验收数据.json`.

## Follow-up: actual-play speech, rest and navigation bugs

- Ordinary speech/sight-loss/admin events no longer bypass the playback lock; building and console decisions have same-channel concurrency guards. Only currently sensed danger may interrupt, including during typing.
- New additive grounded `wait_request: keep|begin|end` persists requested waiting. Sight loss, room changes, successful tool receipts and stale rescue events cannot restart speech or navigation. The original relationship and disclosure safeguards remain.
- Physical stair and elevator-cabin support are excluded from false height/void alarms; roof/ledge support is not blanket exempted.
- `find_path` is now actually read-only with respect to trip intent. Observed sustained departure (4 m / 3 s) pauses guidance; geometry/target changes reset that observation.
- Jing must address concrete objections and use visible landmarks, without imaginary bodily assistance. Added bounded playback telemetry to subsequent decision logs.
- Current service: PID 19652, port 7864, interaction protocol 2. Reloaded legacy 7862/7863 entries redirect there. Existing in-memory browser code still requires a refresh; no user mouse or browser control was taken.
- Final verification: 54 Python + 72 frontend tests (126), typecheck/build, 7 actual-model sequential scenarios, actual Aliyun completion/interruption test, actual stair/cabin/route/legacy-entry checks, 11 existing behavioral checks and input/compass regression passed.
- Scope additions relative to the original plan: `player.ts` support classification, `audio.ts` bounded telemetry, health protocol identity and startup version check. No new dependencies, database migration, artwork, portrait or ending redesign.
- Targeted backups: `.runtime/before-speech-wait` covers the prior core files and selected tests; it is not a complete project snapshot. Report: `docs/静的互动修复验收.html`.
