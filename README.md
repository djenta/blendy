# Local AI Chat for Blender

`local_ai_chat` is a Blender 4.x add-on that adds a `Local AI` sidebar tutor.
It reads `truth.md`, selected scene context, targeted Blender tool notes,
optional viewport screenshots, and sends the prompt to a local
LM Studio local server.

## Install

### Windows Installer

1. Download `Blendy Local AI Tutor Setup`.
2. Run the installer.
3. Open Blendy from the desktop or Start Menu shortcut.
4. Open Blender, then use the 3D View sidebar with `N` and choose the
   `Local AI` tab.

The Windows installer bundles the Blender add-on and tries to install it for
every Blender version it can find for the current Windows user. If it can find
`blender.exe`, it also asks Blender to enable the add-on and save that
preference.

If Blender is installed after Blendy, run the Blendy installer again so it can
copy the add-on into the new Blender version folder.

### Manual Add-on Install

If you only want the Blender add-on, build or use `dist/local_ai_chat.zip`, then
in Blender open `Edit > Preferences > Add-ons > Install...`, pick
`local_ai_chat.zip`, enable the add-on, open the 3D View sidebar with `N`, and
choose the `Local AI` tab.

## Local Model Setup

- Default base URL: `http://localhost:1234/v1`
- Start LM Studio's local server before sending prompts.
- Load any LM Studio model you want to use. Blendy defaults to `auto`, which
  asks LM Studio for `/v1/models` and uses the first loaded model ID.
- Use a vision-capable model if you want screenshot-aware answers.
- Use `Test Connection` in the sidebar to see which model IDs the server reports.
- The first response can be slow while a local model wakes up.

## Context Modes

- `Auto`: always sends compact scene data and adds a viewport image for visual
  prompts like "does this shape look right?"
- `Scene Data Only`: sends Blender facts without an image to save context.
- `Viewport Screenshot`: sends a viewport image whenever `Visual` is enabled.

The context meter shows approximate text usage by prompt, `truth.md`, scene
data, tool references, recent chat, and compacted summary. Image cost depends
on the local vision model.

## Scene Diff

After each send, the add-on stores a compact internal snapshot of the scene.
On the next send, it includes only meaningful changes such as selected object,
dimensions, mesh counts, modifiers, materials, added objects, or removed
objects. This keeps follow-up prompts like "done, what's next?" useful without
re-sending a full previous scene.

## Chat Display

Blender sidebars do not render Markdown, so the add-on strips common Markdown
syntax before drawing chat messages. The latest tutor answer is allowed enough
wrapped lines to avoid cutting off mid-instruction.

The main sidebar is now a compact control dock. Use `Open Chat Split` to create
or focus a Blender Text Editor area showing the `Blender Tutor Chat` transcript.
That transcript uses Blender's native text editor scrolling instead of trying to
force a modern chat log into the narrow N-panel. Connection, project memory, and
context settings open from small icon buttons below the reply box instead of
living as permanent sections in the panel.

## Project Memory

Save your `.blend` file first. The add-on reads `truth.md` beside that saved
file and can create/open it for you. It never auto-writes model suggestions into
`truth.md`; suggested updates are shown in chat for you to copy manually.

## User Paths

Blendy should not depend on the original developer's folders. At runtime it uses
the current user's install and app-data locations:

- Project memory is `truth.md` beside the user's saved `.blend` file.
- App settings, chats, diagnostics, and bridge discovery live in the user's
  Blendy app-data folder.
- The Blender bridge writes its current local URL to that app-data folder so the
  desktop app can find the user's own Blender session.

So if Alice installs Blendy, it should use Alice's folders. If Bob installs it,
it should use Bob's folders.

## Safety

V1 is tutor-only. It does not execute Blender Python returned by the model and
does not change objects, materials, modifiers, or scene data.
