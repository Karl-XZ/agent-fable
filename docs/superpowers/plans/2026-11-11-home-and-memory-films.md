# Home opening and memory-door ending

User direction: Show the player's comfortable daily life, then a request to go outside, the AI's objections, the player's insistence and the AI's reluctant agreement to guide them out. Begin playable exploration afterwards. The guided door erases the recent escape intention and leads into an identical home, where the player forgets what they were doing and resumes a happy routine.

Implementation: Add fixed storyboard beats and delivery instructions to `story.json`. Reuse one Three.js home builder for both films. A pure timeline controls shots, captions, daylight and the door. Pre-render narrator/AI speech through the existing backend-only Qwen TTS and ship local WAV assets, retaining emotion instructions; player dialogue uses subtitles. Add recorded-clip playback to the current audio manager. The game clock, AI ticks, movement and input stay stopped during films. The opening can be skipped; after natural completion a click begins exploration and grants pointer lock from a user gesture. Memory ending plays before the ending record, with replay starting a fresh round rather than retaining knowledge and altered rooms.

Affected: `story.json`, AI prompt, new `homefilm.ts`, `audio.ts`, `main.ts`, UI overlay/styles, fake ending name/copy, tests, local audio assets and documentation. Existing true-ending keys, ruined-city scene, puzzle coordinates, TTS credentials and tools stay unchanged. Originals are in `.runtime/before-home-films`; restore, rebuild and restart to roll back.

- [x] Add failing timeline/audio/prompt tests.
- [x] Write opening and memory dialogue and align memory-door lore.
- [x] Build the identical home and film timeline; render bounded local Qwen voice clips.
- [x] Integrate films, paused simulation, skip/continue and fresh replay.
- [x] Run complete suites, types and build. Check opening, memory ending, skip, delayed network, narration and ruined-city regression in a headless muted browser; capture shots.
- [x] Update copy export, review the diff, restart the local service and verify health.

Design calls: This is an in-engine film, not a video dependency. It does not reveal the global Three-Law background at the start. The AI calls the memory procedure rest/relief, not a commercial retention tactic. Memory ending remains `fake` internally for compatibility and appears as “如常” in the record. Static clips are content-hashed by text, emotion, model and voice; no credential is embedded in audio paths or frontend assets.


Verification: 13 backend tests, 6 audio tests, 3 city-ending tests and 3 home-film tests passed; TypeScript and production build passed. A headless muted browser watched the entire 57.63s opening and 39.61s memory ending, decoded all 16 real local voice clips, verified no runtime TTS calls during these films, compared matching room layouts, checked paused simulation, walked through the actual memory-door trigger, tested natural continuation, skip and fresh replay. City true-ending and clue-reading regressions also passed. No foreground window or OS input was used.

Evidence: `.runtime/home-films-verification.json`, seven `home-*.png` captures, the city/clue reports and screenshots. Script exported to `docs/开场与失忆门分镜文案.md`, world/copy export synchronized. Final root/health, all WAV URLs and configuration traversal checks passed; credentials absent from frontend/assets/docs/scripts/tests. Initial cloud handshake timed out; bounded retry and sequential synthesis completed all 16 clips.

Scope reconciliation: fake ending uses the same existing `fake` key but displays 如常; its replay now reloads a fresh round. Static narrator/AI lines use Qwen-generated assets; player lines are subtitled. Interactive exploration still uses live LLM/TTS, and the ruined-city ending is unchanged. The room and character actions are represented by camera montage and lighting rather than a full body/hand eating animation.


Wordless-ending revision: Per the later user instruction, memory and city conclusions now have no displayed text, narration, automatic fable request or ending report. The city sign has no readable writing. Memory instead uses a look back at the door, hesitation/hand gesture, lifting a cup and diminishing food, then lying down and closing eyes. The city holds the distant-figure frame. Escape returns to title after either conclusion. Opening dialogue remains intact; legacy four non-cinematic endings are outside this revision. Originals are in `.runtime/before-wordless-endings`.

Verification: 13 backend + 6 audio + 3 city + 5 home-film tests passed (27 total), types and production build passed. Headless muted runs checked both endings at start, middle and after completion: document.body.innerText was empty, no narration/agent/fable requests were made after entry, the report stayed hidden, no page errors occurred, and Escape returned to title. Reports and captures are `.runtime/wordless-ending-verification.json` and `wordless-*.png`. Final local root, health and configuration-isolation checks passed; temporary server stopped. Documentation synchronized.


Short-opening revision: compressed the opening to 9 beats (~28.47s) with the same daily-life/request/objection/insistence/reluctant-guidance arc. Clicking the screen skips exactly one current line and stops its voice; clicking past the final line enters exploration directly. Natural completion still waits for a user click. A full-screen native button provides click/keyboard activation, while the whole-film skip remains independent. Opening conversation history now derives from the actual script. Wordless conclusions stay unchanged. Originals are in `.runtime/before-short-intro`.

Verification for short opening: all 28 automated tests (13 backend, 6 audio, 3 city, 6 home-film), TypeScript and production build passed. Headless testing froze the clock for deterministic per-line clicking, then used a separate normal-clock page for full playback. All nine beats advanced one at a time; six active sources were observed stopped; last-line click and natural-completion click both entered exploration; the memory conclusion still showed no text. Report: `.runtime/short-intro-verification.json`. Movie duration is 28.47s; reported wall time also includes click/automation overhead. Test-only timing setup initially raced automatic advancement and was corrected; no product bug was masked. Local service and audio durations verified; temporary server stopped.
