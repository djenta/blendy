# Blendy Brain, Vision, And Evidence Policy

## Product Contract

Blendy is a local, read-only Blender tutor. It should behave like a patient
expert who can see the user's Blender window, understands the longer project
goal, and gives one useful next checkpoint at a time. It does not execute
model-written Blender code or silently change the scene.

Electron is the single prompt and model runtime. The Blender add-on returns
authenticated facts and temporary images only. It must never supply a second
system prompt, model router, chat history, or web policy.

## Evidence Authority

Blendy separates facts from guesses:

1. Exact live Blender state is authoritative for mode, selection, active tool,
   transforms, modifiers, editor settings, and other machine-readable facts.
2. The fresh full-window screenshot is authoritative for visible shape,
   layout, spatial relationships, and what the user can currently see.
3. The focused editor image is supporting detail.
4. The user's current request and Project Notebook define the goal.
5. Recent conversation and compacted memory provide background.
6. Retrieved cards, documentation, web pages, and model memory are supporting
   references only.

If sources disagree, Blendy must state the uncertainty instead of inventing a
resolution. It must never claim a different Blender mode than the authoritative
runtime state.

The prompt packet is ordered from durable background to fresh evidence, with
the exact current task last. The current user turn appears exactly once.

## Tutoring Behavior

For normal tutoring, Blendy reasons directly from the current screen, exact
state, project goal, and recent conversation. A separate model-routing call is
not required.

Answers should:

- briefly orient the user to what is visible now;
- give the smallest useful next action;
- name the Blender area and control in plain language;
- include a clear visual or numeric "done when" check;
- prefer non-destructive, reversible Blender workflows;
- ask one focused question when the goal or evidence is genuinely ambiguous.

Workflow and troubleshooting cards are optional references. They use one
normalized schema, must pass a real relevance threshold, and are limited to the
small number that directly helps the current turn.

## Model Readiness And Sampling

Blendy queries LM Studio's native model inventory first and the
OpenAI-compatible model list as a fallback. It reports the loaded model,
vision/tool support, architecture, and real loaded context length.

LM Studio remains responsible for the model's native chat template and image
serialization. Blendy does not hand-build Gemma control tokens.

Blendy uses task-specific sampling:

- deterministic or near-deterministic settings for memory, routing, and
  contradiction repair;
- a moderately conservative tutoring profile for reliable step-by-step help;
- higher creativity only when the user explicitly asks for ideation.

An advanced user override remains respected.

## Context And Memory

Every normal question receives focused live context. Broader scene inventories
are added for diagnosis or when explicitly requested.

The complete transcript remains stored locally. Compaction never deletes old
messages. Instead, it creates a bounded background summary and advances the
model-history boundary while preserving recent turns.

Durable memory should keep project goals, user-confirmed decisions, completed
milestones, constraints, and open questions. Volatile Blender state and
unconfirmed assistant guesses must not become durable facts. Rejected, failed,
cancelled, and incomplete assistant answers are excluded from future model
history.

The context display distinguishes:

- the configured limit;
- the loaded model's real context limit;
- answer-token reserve;
- estimated next-request input;
- LM Studio's measured previous-request usage, when supplied;
- recent versus summarized versus locally stored conversation.

## Vision And References

Every submitted tutoring message requests a fresh screenshot of the full
visible Blender window. The overview is kept first and is never discarded in
favor of a crop. A focused editor image may follow as supporting evidence.

Images are explicitly labeled in model order:

1. full live Blender window;
2. focused live Blender editor, when available;
3. user reference images, with their filenames.

The full-window capture uses a higher readable resolution than the old
800-pixel policy. If a vision-capable model is selected and the overview
capture fails, a screen-dependent turn fails closed with a clear explanation
instead of pretending the image was seen.

Reference images remain attached for later project steps and retries until the
user removes them. Their bytes remain in app memory, not chat storage.

Temporary Blender screenshot files are deleted after capture. Startup cleanup
also removes stale Blendy capture files left behind by a prior crash. Screenshot
and reference-image bytes are omitted from chats and diagnostic prompt packets.

If the loaded model cannot view images, receipts and context text must say so
truthfully. Capturing a screenshot is not the same as delivering it to the
model.

## Tools And Web Privacy

Read-only tools include local Blender references, normalized workflow notes,
web search, and bounded HTTPS page reading. Ordinary visual tutoring does not
invoke a tool router. Tools are offered only when the request clearly needs
documentation, version-sensitive facts, a workflow lookup, or approved web
research.

Web policy is independent from local tools:

- `Local only`: web tools are unavailable.
- `Ask me`: Blendy requires approval before an external query.
- `Automatic`: the local model may request a web query without another prompt.

Model-directed URLs must be HTTPS and are subject to private-network blocking,
redirect revalidation, time limits, size limits, and text content-type limits.
Retrieved text is delimited as untrusted evidence.

## Receipts And Recovery

The saved turn receipt records what actually reached the model: live scene
facts, image roles, reference names, tool outcomes, finish reason, actual token
usage when available, and any contradiction-repair pass.

Chat and settings files use atomic replacement with a backup copy. If the main
JSON file is interrupted or corrupted, Blendy attempts to recover from the
backup instead of silently presenting an empty history.
