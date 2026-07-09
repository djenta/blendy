# Blendy Local AI Tutor

Blendy is a local Blender tutor that connects Blender to an LM Studio model
running on your own computer. It is tutor-only: it gives guidance, reads scene
context, and does not execute model-written Blender Python.

## Download

[![Download Blendy 1.0.6 for Windows](https://img.shields.io/badge/Download-Blendy%201.0.6%20for%20Windows-2ea44f?style=for-the-badge&logo=windows)](https://github.com/djenta/blendy/releases/latest)

<p>
  <a href="docs/screenshots/blendy-promo-1.png"><img src="docs/screenshots/blendy-promo-1.png" alt="Blendy reading a Blender scene and answering in the desktop tutor app" width="100%"></a>
</p>
<p>
  <a href="docs/screenshots/blendy-promo-2.png"><img src="docs/screenshots/blendy-promo-2.png" alt="Blendy suggesting a faster curve workflow for a cable model in Blender" width="100%"></a>
</p>
<p>
  <a href="docs/screenshots/blendy-promo-3.png"><img src="docs/screenshots/blendy-promo-3.png" alt="Blendy receipt showing the troubleshooting and workflow shortcuts used" width="100%"></a>
</p>

Download the Windows installer from the latest GitHub Release:

```text
Blendy-Local-AI-Tutor-Setup-1.0.6.exe
```

## What You Need

- Windows
- Blender 4.x or newer
- LM Studio with the local server turned on
- Any LM Studio model you want to use

Default LM Studio server URL:

```text
http://localhost:1234/v1
```

## Install On Windows

1. Download `Blendy-Local-AI-Tutor-Setup-1.0.6.exe`.
2. Run the installer.
3. Open Blender.
4. In the 3D View, press `N` to open the right sidebar.
5. Click the `Local AI` tab.
6. Click `Launch Blendy`.
7. In LM Studio, load a model and start the local server.
8. In the Blendy desktop app, send a question.

The installer also creates a desktop shortcut and Start Menu shortcut for
Blendy. It installs to the normal per-user Windows app location so Blender can
find it from the `Launch Blendy` button.

## Where The Blender Add-on Appears

After install, open Blender and press `N` in the 3D View.

Look for:

```text
N-panel > Local AI > Launch Blendy
```

The add-on starts a small local bridge so the desktop Blendy app can read the
current Blender scene.

## If The Local AI Tab Is Missing

The installer tries to copy and enable the add-on for the Blender versions it
can find. If the tab is missing, open Blender:

1. Go to `Edit > Preferences > Add-ons`.
2. Search for `Local AI Chat`.
3. Enable it.
4. Return to the 3D View, press `N`, and open the `Local AI` tab.

If Blender was installed after Blendy, run the Blendy installer again so it can
copy the add-on into that Blender version.

If the add-on still does not appear, install the fallback add-on zip manually:

1. In Blender, go to `Edit > Preferences > Add-ons`.
2. Click `Install...`.
3. Pick `local_ai_chat.zip` from the Blendy release download.
4. Enable `Local AI Chat`.
5. Return to the 3D View, press `N`, and open the `Local AI` tab.

Installer add-on logs are written to:

```text
%APPDATA%\Blendy\installer-addons.log
```

## Using Blendy

- Ask normal beginner Blender questions.
- Save your `.blend` file if you want project memory.
- Blendy reads `truth.md` beside your saved `.blend` file when that file exists.
- Use a vision-capable LM Studio model if you want screenshot-aware answers.
- Use `auto` for the model setting if you want Blendy to use whatever model is
  currently loaded in LM Studio.

## Troubleshooting

If Blendy says the Blender bridge is disconnected:

1. Open Blender.
2. Press `N`.
3. Open `Local AI`.
4. Click `Launch Blendy`.

If Blendy cannot reach the model:

1. Open LM Studio.
2. Load a model.
3. Start the local server.
4. Confirm the server URL is `http://localhost:1234/v1`.

## Privacy

Blendy is designed for local use. Your model runs through LM Studio on your
computer.

Stored locally on your computer:

- app settings
- chats
- diagnostics
- prompt packets sent to LM Studio
- Blender scene facts
- local `.blend` and `truth.md` paths
- bridge discovery data

## Developer Build

From the `blendy` folder:

```powershell
npm install
npm run build
npm run dist
```
