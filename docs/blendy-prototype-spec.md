# Blendy 2 Product Contract

This filename is retained for old links. It now describes the shipped Blendy 2
architecture rather than the original prototype.

## Product Promise

Blendy is a Windows desktop companion that teaches Blender one checkpoint at a
time using a local LM Studio model. It should answer four beginner questions
clearly:

- Is the tutor actually ready?
- What should I do next?
- Where is that control?
- Did my change work?

The app stays tutor-only. It can inspect read-only evidence, but it does not run
model-written Blender Python or change the scene.

## Runtime Ownership

- Electron owns chat persistence, prompts, model discovery, LM Studio calls,
  tools, privacy policy, receipts, and diagnostics.
- React owns the visible coach workflow, settings, readiness, notebook,
  references, and recovery states.
- The Blender add-on owns a loopback-only authenticated bridge that captures
  bounded scene facts and truthful screenshots on Blender's main thread.
- The legacy Blender chat/model operators are not registered.

The active backend source of truth is `blendy/electron/backend.cjs`.

## Main Coaching Loop

1. The user describes what they are making or what is wrong.
2. Blendy captures the smallest useful Blender evidence tier.
3. The selected local model gives a direct answer, one small action, and a
   simple done-when check.
4. The latest answer becomes the current checkpoint.
5. The user chooses `Check my work`, `I am stuck`, or `Show me where`.
6. Blendy captures fresh evidence and continues from the observed result.

## Readiness

The top readiness surface reports Blender, LM Studio, loaded model, chat,
vision, and tool capabilities. It must distinguish these states:

- ready with scene and model evidence
- LM Studio reachable but no chat model loaded
- model ready but Blender disconnected, allowing general guidance
- neither runtime ready, with plain corrective instructions

Raw model ID and token settings remain under Advanced controls.

## Project Continuity

The Project Notebook belongs to a chat, not to a file. It is the user's visible
place for goals, visual direction, measurements, decisions, and constraints.
Chats remain usable across unsaved files and related scenes.

When both paths are known and the active `.blend` differs from the last scene
seen in that chat, Blendy warns instead of silently mixing context. The user can
acknowledge the scene or create a new chat. No automatic file binding occurs.

## Interaction And Accessibility

- The supported minimum window is 380 by 520 pixels.
- Interactive targets are at least 40 pixels.
- All controls have keyboard focus treatment.
- Dialogs receive focus, trap focus, close on Escape, and restore focus.
- Motion communicates work or state change and respects reduced-motion.
- Slow local inference exposes named stages and a Stop action.
- Operational errors retry their own operation. Model retry is reserved for a
  failed answer.

## Privacy And Safety

- Default external-web policy is `Ask me`.
- Local Blender reference tools remain usable in `Local only`.
- Bridge context requires a rotating capability token and a bounded JSON body.
- Browser origins are denied except explicit app schemes.
- Web content is size, time, redirect, content-type, DNS, and private-network
  limited and is always treated as untrusted text.
- Evidence receipts are based on completed tool activity, not planned activity.

## Persistence

Stored in the user's Blendy app-data folder:

- settings and window state
- chats and per-chat Project Notebooks
- compacted conversation summaries
- prompt diagnostics and evidence receipts
- bridge discovery metadata

Reference image data is sent for the active turn and is not added to chat
history. Full screenshots are evidence for the turn, not a gallery feature.

## Release Acceptance

A release is ready only when all of the following pass:

- Python bridge and context tests
- executable Node backend and UI tests
- TypeScript and Vite production build
- dependency audit with no high or critical shipped vulnerability
- local NSIS build and rollback-safe add-on install
- installed-app smoke test at normal and minimum window sizes
- diff-scoped security scan with every changed source file reviewed
- GitHub CI on the merged main commit
