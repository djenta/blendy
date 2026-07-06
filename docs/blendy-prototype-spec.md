# Blendy Prototype Spec

Blendy is a Windows desktop companion app for Blender tutoring. The first
prototype validates the floating app shell and user experience before wiring
the full Blender bridge and LM Studio backend.

## Product Shape

- Windows-only v1.
- Electron + React + Vite prototype.
- Real always-on-top desktop window, not a browser mockup.
- Custom frameless, rounded, draggable, resizable window.
- Pinned-on-top by default, with a pin toggle in the top bar.
- Manual launch from Blender's N panel later; no autostart for v1.
- Blender add-on becomes the lightweight bridge. Blendy owns chat, prompts,
  model calls, settings, app data, and display.

## Brand

- App name: Blendy.
- Version label in top bar: `Blendy 0.1`.
- Logo asset: tracked app artwork under `blendy/src/assets/`.
- Logo use:
  - Windows app icon.
  - Small top-left app mark beside `Blendy 0.1`.
  - Subtle empty-state mark.
  - Do not repeat in message rows.

## Themes

- `Scholastic Solar`: warm light, Claude-inspired mood, solid warm surface,
  charcoal text, restrained warm accent.
- `Neon Sprint`: dark slate, legible digital/gruff mood, cyan/neon green
  accents inspired by sci-fi UI without copying any source.
- Mostly solid surfaces. Avoid readability-breaking transparency.

## Typography

- Typeface setting with `Geist` and `Red Hat Display`.
- Default typeface: Geist.
- Numeric text size setting.
- Recommended default: 15px.
- Range: 14px to 20px, 1px steps.

## Main Chat Experience

- Professional chat-thread style, not cartoon/iMessage bubbles.
- User messages are compact and distinct.
- Blendy responses are open, readable text blocks.
- No repeated avatars.
- No timestamps in v1.
- No command buttons in v1.
- Enter sends. Shift+Enter inserts a newline.
- Responses stream in later, but the prototype can use simulated messages.
- Streaming must not pull the scroll position away when the user is reading
  older content.
- Completion feedback should be subtle and visual only. No sounds.

## Context Grounding

- Every Send will inspect Blender first once backend integration exists.
- No manual Inspect button in v1.
- Auto screenshot inclusion based on prompt wording.
- Manual Capture control is secondary in the Visual context area.
- No confirmation prompts before local screenshot use.
- Full screenshots are temporary and deleted after send.
- No per-message screenshot thumbnail history.
- User message shows compact context line, for example:
  `Used: Units mm · Cube selected · Bevel 0.01mm / 5 seg · Viewport inspected`
- Context line can expand later to show exact captured context.

## Context Drawer

- Context remains a drawer/panel available from chat.
- Settings is a full app page, not a popover.
- Drawer content should avoid clutter and default to Scene/Selected facts.
- Drawer sections:
  - Selected
  - Modifiers
  - Scene
  - Visual
  - Project Brief
- The Project Brief is `truth.md` under the hood, but called Project Brief in UI.
- Blendy reads Project Brief often, especially on Send.
- Project Brief updates require user approval.

## Settings Page

- Settings replaces the chat page while open.
- Top bar remains visible.
- Back button returns to chat.
- Settings groups:
  - Theme
  - Typeface
  - Text size
  - Tutor style
  - LM Studio
  - Window
  - Screenshot
  - Project
  - Diagnostics
- Tutor style options:
  - Balanced
  - Detailed
- No Short mode.
- Style changes answer depth, not factual grounding.

## Persistence

- Blendy gets its own app data folder.
- Prototype persists:
  - Theme
  - Typeface
  - Text size
  - Window size
  - Window position
  - Pinned state
- Full chat history later lives in Blendy app data per `.blend` project, not
  inside `.blend` files.

## Installer Direction

- Project should be shaped toward a Windows installer.
- Use electron-builder later for NSIS installer.
- Installer should eventually install both:
  - Blendy desktop app.
  - Blender bridge add-on.
- Blender version detection should inspect installed local versions and use the
  newest detected Blender add-ons folder, not a hardcoded Blender version.

## Prototype Scope

Included now:
- Electron floating shell.
- Always-on-top and pinned toggle.
- Frameless rounded UI.
- Logo in top bar.
- Scholastic Solar and Neon Sprint themes.
- Typeface and text size settings.
- Chat thread mock data.
- Context chips and context drawer.
- Settings page.
- Persistent settings and window state.

Not included yet:
- Real Blender bridge endpoints.
- Real LM Studio calls.
- Streaming model responses.
- Per-project chat app data.
- Installer packaging.
