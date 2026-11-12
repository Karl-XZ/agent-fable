# Aliyun emotional TTS implementation plan

Goal: Replace browser speech synthesis with Qwen-Audio 3.1 TTS Flash, adding a per-utterance `emotion` direction while retaining DeepSeek for decisions.

Architecture: FastAPI validates POST `/api/tts`, connects to the configured workspace WebSocket, and streams 24 kHz mono signed 16-bit little-endian PCM. WebAudio plays incoming chunks. Credentials stay in backend environment variables. `emotion` describes delivery separately from game `mood`; missing directions fall back to mood defaults.

Scope/impact: `app.py` prompt, reply normalization and health; new `tts.py` transport; `web/src/audio.ts` playback/cancellation; `agent.ts` reply/log types; `main.ts` all existing speech callers; requirements, README and built assets. No saved-game migration or game-rule changes. Snapshot of edited originals is in `.runtime/before-aliyun-tts`; restore those files, remove the new TTS module, rebuild and restart to roll back. No credentials in snapshots or documentation.

Constraints: No foreground browser or OS input. Use the supplied workspace and credential only on the backend. Do not change the LLM provider. Live probes are short and bounded. Keep subtitles usable if TTS fails, show a concise error, and do not silently switch voices.

- [x] Write failing backend tests for instruction forwarding, PCM streaming, provider errors, validation and agent emotion defaults.
- [x] Implement backend transport and route; prove the tests pass.
- [x] Replace browser speech with cancellable streamed PCM; pass per-reply emotion through normal, phone and ending speech. Disabling speech stops active/pending audio.
- [x] Verify with frontend behavioral tests in a headless browser, backend suite, production build, and bounded real-provider synthesis. Check secret isolation.
- [x] Restart only this game's server and verify health and local HTTP streaming. Record actual results and remaining limits.

Initial provider probe: configured workspace accepted `qwen-audio-3.1-tts-flash` / `longanhuan_v3.1` with an emotion instruction and returned 186720 PCM bytes. Cold first audio was 5.6 seconds on this connection; this is not an end-to-end gameplay latency promise.


Final verification (2026-11-11): 7 backend tests and 5 audio behavior tests passed; TypeScript check and Vite production build passed. A headless, muted Chromium session exercised a real TTS stream through the game and verified that the reply direction reached the request, subtitles excluded the direction, WebAudio scheduled PCM frames, and no page errors occurred. A separate live DeepSeek call produced a non-empty per-utterance emotion. The final localhost:7860 service returned 48480 audio bytes with first audio at 5.64 seconds. Other probes measured 6.102/7.79 seconds and a loaded headless game measured 9.375 seconds; this is streaming playback but not instantaneous speech. The older Qwen3 Instruct realtime model returned Model not exist in this workspace and was not enabled.

Review/impact reconciliation: no gameplay rules or saved data changed. Additional verified fixes: encoded static path traversal could read backend configuration and now returns 404 (regression test); two existing optional smoke comparisons needed null defaults for the TypeScript check. API key scan found no credential in frontend source, built assets, docs or tests. No foreground browser or OS input was used. Local PID 18392 serves 127.0.0.1:7860; temporary verification server was stopped. Emotional acting quality still requires human listening; automated checks prove the direction and audio plumbing.
