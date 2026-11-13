# Jing wall projection

User approved implementing the prepared portrait as an AI-controlled projection on walls Jing can currently see. Implement inline, without changing unrelated dialogue policies or using the user's mouse.

Impact: add projection geometry and renderer modules; wire camera availability, world collision, anchoring and endings in main; add project_self, hide_projection, list_projection_walls to frontend/backend tools; expose live candidates and active expression in perception. Reuse approved PNGs, no dependencies or image edits. Preserve private character-card handling and existing speech scheduling.

- [x] Test opaque wall support, facing, occlusion, disabled cameras, demolished walls, size fitting and expression validation.
- [x] Implement geometry policy and one wall-aligned, depth-tested, noncolliding portrait; load existing thirteen textures once.
- [x] Connect executable tools, query feedback and AI instructions, keeping expression independent of private mood.
- [x] Verify actual rendering, real model tool use, privacy/anchoring, removal, face switching and endings in isolated headless browser; run existing checks.
- [x] Build and restart the existing 7864 entry only after checks. Local Git checkpoint; no forced remote publication.

Verified: 62 Python tests and 99 frontend tests; TypeScript and Vite production build. Isolated production-browser run passed 13 checks and three real-model tool interactions. Fresh review found a visibility timing leak; regression reproduced it before the shared live visibility predicate fixed it. Final review found no blockers. Evidence: ../../projection-verification/README.md.

Rollback: remove the new module wiring and tool names; assets remain reusable. No save migration, credentials or user settings changes.
