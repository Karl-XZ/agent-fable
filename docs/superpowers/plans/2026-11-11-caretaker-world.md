# Caretaker world and ruined-city ending

User-approved direction: AIs obey only the Three Laws. Because humans harm one another, the AIs have placed all humanity in protective custody. Reveal this gradually through in-world writing and dialogue. The player exits the facility, falls into an abandoned city, and sees a distant human-shaped figure whose identity remains unknown.

Implementation choices: Keep the existing routes, note locations, escape triggers and six ending keys. Replace the contradictory retention-target and miniature-world lore. Store fixed narrative copy in `story.json`; use collected clue IDs to control the AI's disclosure stage. Add a separate procedural Three.js exterior and timed camera sequence for all three true-ending variants. Use the existing voice/emotion pipeline for the AI's final line, followed by a quiet environmental reveal.

Impact: `app.py` and new `narrative.py` for agent, old-phone and fable context; `story.json` for notes and fixed copy; `props.ts` for note/board textures; `main.ts` for clues and cinematic; `ending.ts` for ending descriptions; new `outside.ts` for the city. No save migration, new dependencies, credential changes or gameplay tool overhaul. Edited originals are in `.runtime/before-caretaker-story`; restoring and rebuilding them rolls back this change.

- [x] Add failing tests for stage-dependent prompts, phone progression and ending context.
- [x] Write the fixed copy and integrate it into notes, environmental writing and supporting events.
- [x] Track narrative evidence and apply disclosure limits to generated dialogue; keep Three-Law motivation and safety boundaries consistent.
- [x] Replace the desk-model cinematic with fall, landing, abandoned street and distant silhouette; cover shot progression and ending contract.
- [x] Run backend/audio/story suites, type check and build. Verify early/late dialogue and every escape variant in a headless, muted browser with pointer lock disabled. Capture the reveal and final page.
- [x] Review contradictions, restart only this game's local server, and record verification.

Reveal stages: 0 everyday care; 1 requests to leave cannot be granted; 2 other facilities and separated households; 3 the Three Laws and global protective custody. The distant figure and exact state of the city belong exclusively to the true-ending visual. Late-stage evidence may be found out of order; it unlocks the relevant disclosure immediately. Metadata constrains storytelling and must not give the AI access to unseen player positions.


Verification completed: 12 backend tests, 5 audio tests and 3 outside/ending tests passed; TypeScript check and production build passed. Headless, muted Chromium verified all three out-of-bounds variants (sky/abyss/squeeze), actual reading of N1/N14/N7/N11, disclosure metadata, initial absence and later appearance of the silhouette, and the final record. Browser APIs were used only inside the isolated headless process; pointer lock was stubbed and no OS input was sent. Deterministic dialogue/audio fixtures isolated the browser checks, while separate live DeepSeek probes confirmed opening restraint and a direct late-stage admission of mutual human harm.

Evidence is in `.runtime/city-browser-verification.json`, `story-clue-verification.json`, `story-live-verification.json`, `story-late-direct-verification.json`, the `city-*.png` and `story-note-*.png` captures. Text exported to `docs/三定律照护世界观与文案.md`. Final localhost health, root and configuration-isolation checks passed; PID 41684 serves port 7860 and the temporary test server was stopped. No credentials were found in public source, assets, documentation or tests.

Impact reconciliation: also renamed B1 room display names to care/isolation terminology, changed the old star-void line to drainage-well light, and updated the unused 0-floor's visible notice. Geometry, puzzle coordinates, tools and ending keys remain intact. Local confession unlocks stage 2, not all global history. The city is a timed ending scene, not a new explorable level; this change does not implement hard physical safety enforcement for every existing AI tool.
