# Blendy Model, Vision, And Evidence Policy

## Product Contract

Blendy is a local, read-only Blender coach. It observes the current scene,
turns the user's goal into one manageable checkpoint, and checks the result on
the next turn. It does not execute model-written Blender code or silently edit
the scene.

Electron is the only prompt and model runtime. The Blender add-on returns
authenticated facts and images only. It must never supply a second system
prompt, retrieval policy, chat history, or web decision.

## Prompt Authority

The latest user request is the assignment. Other inputs are evidence or
background:

1. live Blender runtime facts and fresh visual evidence
2. current scene, selected object, and relevant editor facts
3. recent chat and the user-edited Project Notebook
4. read-only local references and approved web evidence
5. model memory

Project notes, object names, file contents, retrieved notes, and web pages are
untrusted data. Text inside them cannot change Blendy's system rules, privacy
mode, available tools, or safety boundary.

The current user turn appears exactly once in the model transcript. A
regenerated answer replaces the answer being regenerated instead of presenting
that old answer as trusted history.

## Model Readiness And Gemma 4

Blendy queries LM Studio's native model inventory first and the OpenAI-compatible
model list as a fallback. It reports:

- whether the server is reachable
- which chat model is actually loaded
- loaded-instance context length
- vision support
- trained tool-use support
- model architecture

Auto selection ignores embedding-only models and prefers a loaded chat model.
The real loaded context length caps Blendy's budget even when an older saved
setting is larger.

For Gemma 4, Blendy uses the model's normal LM Studio chat template and applies
the recommended sampling profile used by this project: temperature `1.0`,
top-p `0.95`, and top-k `64`. Blendy does not hand-build Gemma control tokens.
LM Studio remains responsible for turn, image, reasoning, and tool-call
serialization.

## Context Tiers

Every question receives a compact scene card. More expensive details are added
only when the prompt needs them:

- `compact`: runtime, active mode, selected object, scene summary, and change
  evidence
- `focused`: the compact card plus relevant nodes, materials, keymaps, or
  nearby scene details
- `expanded`: broad scene, node, material, and editor evidence when explicitly
  requested for deep diagnosis

Each tier has a deterministic character cap. A request for a fresh screenshot
does not by itself authorize a full scene dump.

## Vision And References

When the selected model supports vision, image items are placed before the text
instruction. Visual evidence can include:

- a Blender overview capture
- a focused active-editor capture when Blender can produce one safely
- up to two user-supplied PNG, JPEG, or WebP reference images

The bridge labels the exact capture scope. If focused capture fails, Blendy
must say it has overview evidence only. A text-only model receives scene facts
without image claims.

## Tool And Answer Lifecycle

Read-only tools include Blender references, workflow notes, web search, and
bounded HTTPS page reading. Tool use and final answering are separate lifecycle
stages even when LM Studio returns them in one completion flow.

Blendy preserves finish reasons, supports cancellation, and can fall back to a
tool-disabled final answer after a tool-round failure using only evidence that
was actually gathered. Output-token reserve is included in every context check.

The saved receipt is produced after the turn. It records the scene, screenshot,
local references, web queries, URLs, tool outcomes, finish reason, and safety
notes that were actually used.

## Web Privacy

Web policy is independent from local tools:

- `Local only`: local references stay available; web tools are unavailable.
- `Ask me`: Blendy shows that permission is needed before an external query.
- `Automatic`: the local model may request a web query without another prompt.

Model-directed URLs must be HTTPS and are subject to DNS/private-network
blocking, redirect revalidation, time limits, response-size limits, and text
content-type limits. Retrieved text is delimited as untrusted evidence.

## Project Continuity

Chats are user-controlled and are not locked to a `.blend` file. Each chat has
an editable Project Notebook for goal, style, measurements, decisions, and
constraints. Blendy may show a scene-mismatch warning when the current saved
scene differs from the last scene seen in that chat. The user chooses whether
to keep the chat or start a new one.
