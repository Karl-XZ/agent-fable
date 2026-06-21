# Agent Fable

A first-person maze narrative game where the player explores an Agent-controlled space, sends SMS-like prompts, destroys consoles, and tries to escape the map boundary.

## Features

- Real-time 3D maze scene built with React and Three.js
- Local Codex orchestrator that replies to the player and can modify `runtime/ai-zone`
- Pathfinding summaries for routes to the door and boundary gap
- Multiple endings: door ending, boundary escape, and falling out of the world
- Run logs, subtitle queue, compass, and environmental settings

## Commands

```bash
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5231 --strictPort
pnpm run ai:server
pnpm exec tsc --noEmit
```
