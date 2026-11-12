# Repository history migration plan

> **For agentic workers:** Use superpowers:executing-plans to execute sequentially. One final fresh-context review covers the restored history and publication checks.

**Goal:** Preserve the existing Karl-XZ/agent-fable main branch as old and publish the current local project as a sequence of recoverable milestones.

**Architecture:** Build five snapshots in an isolated clone, working backwards from the current files through the saved before-* overlays. Parent the new commits on the existing remote main, so publication is a normal fast-forward. Keep the original running directory and credentials untouched.

**Tech stack:** Git, Python, TypeScript/Vite, existing test runners.

**Spec:** The user's 2026-11-13 request in this chat: archive remote content in old, import local versions in separate commits, finish at the current version, and compare old with current.

## Global constraints

- Never operate on the accidentally enclosing drive-level Git repository. Every Git command names the isolated clone.
- Never publish real .env files, credentials, runtime logs, caches, node_modules or built dist folders.
- These local backups are partial overlays, not original Git commits. Document reconstruction and use current commit dates.
- Do not change current gameplay or run foreground browser/mouse automation.
- Preserve old exactly at the inspected original SHA. Do not force-push main or overwrite an existing old branch.
- The user already authorized pushing this repository and preserving its old content; no additional publication confirmation is required.

## Review focus

- Earlier snapshots must not import modules introduced later.
- Each milestone must build and expose tests appropriate to that feature set.
- The latest snapshot must match current production source, apart from repository documentation and ignore/config templates.
- No private configuration or real play logs may appear in any imported commit.
- Publication must verify remote heads and checkpoint refs, not merely local commits.

## Tasks

- [x] Inspect remote main, branch names and permissions; preserve its exact SHA locally.
- [x] Build provenance manifests for pre-interaction, initial interaction, pre-character-card, initial character-card and latest snapshots.
- [x] Validate each snapshot (TypeScript, Vite, Python and applicable frontend tests), record genuine historical defects separately, and commit each milestone.
- [x] Compare old architecture, navigation, AI scheduling, tool execution and testing with the current project; document specific useful ideas without silently merging them.
- [x] Review the complete commit chain, scan every imported tree for secrets, and verify latest-source equality.
- [ ] Publish old first, verify it, fast-forward main and push checkpoint tags; verify the remote refs. If permission is unavailable, retain the complete local clone and recovery bundle and state the precise blocker.

## Recovery

The original remote commit stays reachable through old. The original running local source and .runtime backups remain unchanged. Checkpoint tags permit creating a recovery branch without resetting another branch or deleting uncommitted work.
