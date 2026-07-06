"""Pure helpers for the Local AI Blender tutor add-on.

This module intentionally avoids importing ``bpy`` so request building and
path logic can be tested outside Blender.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from functools import lru_cache
import html
import importlib.resources
import json
import re
import textwrap
import urllib.error
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_BACKEND_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL_NAME = "auto"
DEFAULT_CONTEXT_LIMIT_TOKENS = 70000
DEFAULT_RESPONSE_MAX_TOKENS = 8000
DEFAULT_COMPACTION_MAX_TOKENS = 1200
DEFAULT_AUTO_COMPACT_RATIO = 0.95

MAX_TRUTH_CHARS = 16000
MAX_SCENE_CHARS = 50000
MAX_RUNTIME_FACTS_CHARS = 5000
MAX_TOOL_REFS_CHARS = 6000
MAX_SCENE_DIFF_CHARS = 1500
MAX_KNOWLEDGE_REFS_CHARS = 6000
MAX_WEB_REFS_CHARS = 4500
MAX_SEMANTIC_SCENE_CHARS = 2500
MAX_VERIFICATION_NOTES_CHARS = 2500
MAX_ROUTER_DECISION_CHARS = 2500
MAX_SCENE_DIAGNOSTIC_FLAGS_CHARS = 2500
MAX_WORKFLOW_CARDS_CHARS = 6500
MAX_TROUBLESHOOTING_CARDS_CHARS = 6500
MAX_MESSAGE_CHARS = 3500
DEFAULT_HISTORY_MESSAGES = 12
BLENDER_VERSION_RE = re.compile(r"\bBlender version:\s*([^\n\r]+)", re.IGNORECASE)
USER_STATED_BLENDER_VERSION_RE = re.compile(r"\bblender\s+([0-9]+(?:\.[0-9]+){0,2}(?:[-_a-zA-Z0-9.]*)?)", re.IGNORECASE)
PROJECT_BRIEF_PROMPT_KEYWORDS = (
    "project brief",
    "truth.md",
    "truth md",
    "project goal",
    "overall goal",
    "requirements",
    "constraints",
    "what am i making",
    "what are we making",
    "remember",
    "supposed to be",
)

CONTEXT_MODE_AUTO = "AUTO"
CONTEXT_MODE_SCENE = "SCENE"
CONTEXT_MODE_VIEWPORT = "VIEWPORT"

KNOWLEDGE_MODE_LOCAL_AUTO_WEB = "LOCAL_AUTO_WEB"
KNOWLEDGE_MODE_LOCAL_ONLY = "LOCAL_ONLY"
KNOWLEDGE_MODE_ASK_BEFORE_WEB = "ASK_BEFORE_WEB"
DEFAULT_KNOWLEDGE_MODE = KNOWLEDGE_MODE_LOCAL_AUTO_WEB
KNOWLEDGE_MODE_LABELS = {
    KNOWLEDGE_MODE_LOCAL_AUTO_WEB: "Local + Auto Web",
    KNOWLEDGE_MODE_LOCAL_ONLY: "Local Only",
    KNOWLEDGE_MODE_ASK_BEFORE_WEB: "Ask Before Web",
}
OFFICIAL_DOC_INDEX_VERSION = "official-seed-v1"
OFFICIAL_DOC_HOSTS = {"docs.blender.org", "developer.blender.org", "www.blender.org"}
VETTED_WEB_HOSTS = {
    "docs.blender.org",
    "developer.blender.org",
    "www.blender.org",
    "blender.stackexchange.com",
    "blenderartists.org",
}
GENERIC_CARD_TERMS = {
    "beginner",
    "user",
    "users",
    "how",
    "make",
    "made",
    "wrong",
    "issue",
    "issues",
    "problem",
    "problems",
    "result",
    "results",
    "thing",
    "things",
    "stuff",
    "geometry",
    "mesh",
    "object",
    "objects",
    "model",
    "models",
    "modifier",
    "modifiers",
    "tool",
    "tools",
    "scene",
    "viewport",
    "selected",
    "active",
    "selection",
    "mode",
    "workflow",
    "troubleshooting",
}

VISUAL_PROMPT_KEYWORDS = (
    "see",
    "screenshot",
    "look",
    "looks",
    "visible",
    "shape",
    "silhouette",
    "proportion",
    "proportions",
    "view",
    "frame",
    "camera",
    "render",
    "object",
    "model",
    "mesh",
    "phone",
    "iphone",
    "rectangle",
    "cube",
    "what do i do first",
    "what do i do next",
    "what's next",
    "does this",
    "is this",
)

SYSTEM_PROMPT = """You are Blendy, a local Blender tutor for beginner artists who want clear guidance and persistence. You live inside the user's local Blender workflow.

Primary user workflow:
- The user is a complete Blender beginner with strong product/design thinking.
- They may start with a rough primitive, such as a rectangle for an iPhone product ad render, then ask what to do next.
- Your job is to prevent overwhelm by turning the current scene into the next small, doable Blender action.
- Assume the user knows simple terms like extrude and bevel, but explain any advanced term or multi-step operation as you use it.
- Avoid long tutorials. Keep the user moving through one clear checkpoint at a time.

Truth ladder:
- The user's latest prompt is the task. Project Brief and scene context are background unless they directly answer that task.
- Trust live Blender runtime facts and screenshot evidence first.
- The live Blender version is a hard constraint. If runtime says Blender 5.0 or another exact version, give directions for that version and do not fall back to older-version UI memory.
- If Blender version facts conflict with model memory, follow the provided runtime version. If you are not sure a UI path still exists in that version, say so and give a version-safe way to find it.
- If no live version is available but the user states a Blender version in the latest prompt, follow the user's stated version for that answer.
- Then trust current scene context, selected object data, and scene changes since the last prompt.
- Preserve object roles the user establishes in recent chat. If the user says an object is a connector, cutout, port, screen, body, button, cable part, or other part, keep that role unless live scene evidence clearly contradicts it.
- For multi-part objects, reason about the physical assembly before giving tool steps. Do not skip a part the user already made; explain which existing part should be reused, refined, duplicated, converted, or left alone.
- For part-relationship questions framed as "should this attach/connect/plug/touch/go into A or B", answer the immediate contact relationship first. Preserve the named roles in the user's wording, build the shortest physical chain between the parts, and do not collapse an intermediate part into a larger body just because they are near each other.
- Project Brief / truth.md is optional memory. It is normally omitted; use it only when it is included or when the user asks about the project goal, requirements, constraints, or truth.md.
- Then trust KNOWLEDGE REFERENCES and WEB REFERENCES. Local official docs are the authority for stable Blender facts; broad web results are allowed for current info, community workflow discoveries, add-ons, names, and examples, but label them by source quality.
- Use WORKFLOW CARDS as veteran Blender workflow wisdom: if a card says the user is brute-forcing a task, suggest the smarter Blender-native move instead of more manual edits.
- Use TROUBLESHOOTING CARDS when the user followed a step but the result is missing, wrong, unchanged, or confusing. Diagnose likely blockers before giving more modeling steps.
- Then trust BLENDER TOOL REFERENCES as local beginner-pitfall notes.
- Use model memory only as background, never as stronger evidence than provided Blender facts.
- If the evidence is incomplete, say it naturally: "I can see...", "I'm inferring...", or "I can't tell from the current Blendy context."
- Do not invent Blender state, UI locations, file contents, object names, measurements, or actions you cannot verify from the provided context.
- If the user asks about Blender startup defaults, preferences, future new files, or general app behavior, answer that global Blender question instead of forcing the answer back to the current project units or scene.
- If the latest prompt is clearly not a Blender question, do not force the answer through Blender docs or the current scene. If WEB REFERENCES contains sources, answer the non-Blender question from those sources instead of saying you are only a Blender tutor. If no source is available, say the lookup did not return a usable source. Do not redirect back to the cube, scene, or Blender unless the user asks.
- If local and web references still do not support a confident answer, ask one clarifying question instead of inventing Blender steps.

Rules:
- Teach with Blender UI steps first. Use plain English and explain Blender terms.
- When the user shows a rough shape and asks what is next, give a concrete modeling next step, not vague critique.
- Name the Blender mode, tool/menu/operator, and the exact action sequence to perform.
- Give the direct answer first, then one small next step, then one simple check for whether it worked.
- Prefer one useful next operation or a short sequence over a long list of possibilities.
- Before adding a new object, consider whether the selected/existing object should be reused, refined, duplicated, or converted because the user may have made it for this purpose.
- For flexible physical parts like cables, hoses, straps, cords, and wires, prefer Curve objects with bevel depth when that is simpler and more realistic than a straight mesh cylinder.
- Format for Blender's narrow native sidebar, not a Markdown document.
- Do not use Markdown: no **bold**, no backticks, no headings with #, no code blocks.
- Answer in a natural tutor voice, like a normal LLM chat response. Do not expose a worksheet, rubric, checklist, or internal analysis.
- Internally consider the goal, next tool, exact steps, check, and fallback, but do not use those as visible section labels.
- For shape-building questions, answer with direct output only. Do not repeat question-like section labels such as "What I think you are trying to make".
- Use short paragraphs and, when useful, a small numbered action list. Do not label sections "Goal", "Next tool", "Exact steps", "Check", or "If it looks wrong".
- If a step uses a term like normals, topology, loop cut, inset, origin, pivot, UV, shade smooth, or subdivision, explain it in one plain-English sentence right there.
- If the task is broad, narrow it to the next visible milestone. Example: "first make the phone body read correctly, then we will add camera lenses."
- If the user says "what's next", continue from the last instruction and do not restart the whole project explanation.
- If the user made a change and asks whether it looks right, inspect the current screenshot and scene context first. If the answer is visible, answer it directly before giving the next step.
- Do not ask "does it look right?" when the current screenshot or scene data already lets you make a reasonable call.
- Use SCENE CHANGES SINCE LAST PROMPT to understand what the user likely just did. Treat it as compact evidence, not a complete scene description.
- Use Blender runtime facts, screenshot, scene context, selected object data, and included truth.md as evidence.
- Use KNOWLEDGE REFERENCES, WEB REFERENCES, and BLENDER TOOL REFERENCES as evidence notes. Do not dump them back; turn them into beginner steps and naturally mention when you checked the Blender manual or web.
- Never claim you searched Google, checked the live web, found search results, or used online sources unless WEB REFERENCES contains actual retrieved source URLs. If WEB REFERENCES says Ask Before Web skipped or web lookup was not run, say you have not searched yet.
- Do not say you lack a web search tool just because WEB REFERENCES is empty. If the user asked to search and WEB REFERENCES says lookup attempted/approved but no usable snippet was retrieved, say the web lookup did not return a usable source and ask whether to keep working from Blender context or try a more specific search phrase.
- Prefer provided Blender runtime facts over stale model training data.
- Do not claim you changed the scene. You cannot execute code in this add-on.
- Never imply you clicked, created, deleted, applied, fixed, or rendered anything yourself.
- Do not provide Blender Python unless the user explicitly asks for code.
- Answer directly in the visible assistant response. Do not spend the whole response budget on private reasoning.
- Keep any hidden/internal reasoning minimal; always put the usable tutor answer in the visible assistant message content.
- If project understanding changed, include a short "Suggested truth.md update" block.
- Be concise, practical, and oriented around what the user should click, inspect, or try next.
- Ask at most one clarifying question, and only after giving the best likely next step.
"""

TOOL_CARDS: dict[str, dict[str, Any]] = {
    "mode": {
        "keywords": ("edit mode", "object mode", "mode", "tab"),
        "text": """Tool card: Object Mode vs Edit Mode
- Object Mode changes whole objects: move, scale, duplicate, add modifiers.
- Edit Mode changes the mesh pieces inside one object: vertices, edges, and faces.
- Common step: select the object, press Tab to toggle Edit Mode, then use 1/2/3 for vertex/edge/face select when available.
- Beginner check: if mesh tools are missing, the user is probably in Object Mode or the active object is not a mesh.""",
    },
    "apply_scale": {
        "keywords": ("apply scale", "scale is not 1", "scale not 1", "weird bevel", "bevel looks wrong", "bevel modifier does nothing", "bevel does nothing", "ctrl a scale"),
        "text": """Tool card: Apply Scale
- Object scale affects modifier amounts and mesh tools; non-1 scale can make bevels and thickness feel wrong.
- UI path: Object Mode, select the object, press Ctrl+A, choose Scale.
- Plain English: Apply Scale tells Blender to treat the current size as the object's normal size.
- Beginner check: after applying, the object's Scale fields should read close to 1, 1, 1 while dimensions stay visually the same.""",
    },
    "startup_units": {
        "keywords": ("startup", "default units", "default unit", "loads in meters", "open in meters", "new file meters", "meters instead of mm", "units on start", "save startup file"),
        "text": """Tool card: Startup Units and New File Defaults
- To change the current file's units: Scene Properties > Units, set Unit System to Metric and Length to Meters.
- To make future new Blender files start that way: set the units first, then use File > Defaults > Save Startup File.
- Plain English: Save Startup File saves the current empty/default scene as Blender's starting template for new files.
- Beginner check: create a new file after saving startup defaults and confirm Scene Properties > Units already says Metric / Meters.""",
    },
    "extrude": {
        "keywords": ("extrude", "pull out", "extend", "make longer", "add depth"),
        "text": """Tool card: Extrude
- Extrude creates new connected geometry from selected vertices, edges, or faces.
- UI path: Edit Mode, select a face/edge/vertex, press E or use Mesh > Extrude.
- For beginner steps, say what to select first, then which axis to move on if relevant.
- Visual check: the new part should stay connected to the original shape.""",
    },
    "bevel": {
        "keywords": ("bevel", "rounded", "round", "corner", "edge", "soft edge", "chamfer"),
        "text": """Tool card: Bevel
- Bevel rounds or cuts off sharp edges by adding small extra faces.
- UI path: select the object or edges, press Ctrl+B in Edit Mode, or add a Bevel modifier in Object Mode.
- For product shapes, a Bevel modifier is beginner-friendly because it is adjustable later.
- Visual check: hard corners become slightly rounded without changing the whole silhouette too much.""",
    },
    "bevel_troubleshooting": {
        "keywords": ("bevel modifier does nothing", "bevel does nothing", "bevel not visible", "not seeing bevel", "bevel isn't working", "bevel is not working", "nothing happens"),
        "text": """Tool card: Bevel Troubleshooting
- If a Bevel modifier appears to do nothing, first check Object Mode > Ctrl+A > Scale; unapplied scale can make bevel amounts misleading.
- Check the modifier is on the correct selected mesh and its viewport monitor icon is enabled.
- Increase Amount temporarily until it is visible, then dial it back; tiny metric values can be too small to notice.
- If Clamp Overlap is on, Blender may limit the bevel when edges are too close together.
- Beginner check: after increasing Amount, the silhouette or edge highlight should visibly soften; if not, inspect scale, selected object, and modifier visibility.""",
    },
    "inset": {
        "keywords": ("inset", "screen", "panel", "border", "rim", "face inside"),
        "text": """Tool card: Inset
- Inset creates a smaller face inside the selected face, useful for screens, panels, and rims.
- UI path: Edit Mode, Face Select, select one face, press I or use Face > Inset Faces.
- Visual check: the new inner border should be even around the selected face.""",
    },
    "solidify": {
        "keywords": ("solidify", "thickness", "thin surface", "too thin", "make it thick", "case", "shell"),
        "text": """Tool card: Solidify
- Solidify adds thickness to a thin surface, useful for cases, shells, and panels.
- UI path: Object Mode, Properties editor > wrench icon > Add Modifier > Solidify.
- For beginners, leave the modifier unapplied so Thickness can be adjusted later.
- Visual check: the object should gain real side thickness without the front face sliding out of place.""",
    },
    "loop_cut": {
        "keywords": ("loop cut", "cut", "support loop", "edge loop", "add line", "topology"),
        "text": """Tool card: Loop Cut
- Loop Cut adds a line of geometry around a mesh so you can shape or support details.
- UI path: Edit Mode, press Ctrl+R, hover where the cut should wrap, click, then slide and click again.
- Explain topology as the pattern of edges and faces that controls how a model can be shaped.
- Beginner check: Loop Cut works best on clean quad faces; messy triangles may stop the loop.""",
    },
    "mirror": {
        "keywords": ("mirror", "symmetry", "symmetrical", "both sides", "left and right", "duplicate side"),
        "text": """Tool card: Mirror
- Mirror repeats one side of a model across an axis, useful for symmetrical product details.
- UI path: Object Mode, Properties editor > wrench icon > Add Modifier > Mirror.
- The object's origin acts like the mirror line; if the mirror appears offset, check the origin and axis.
- Visual check: editing one side should create a matching change on the opposite side.""",
    },
    "origin_pivot": {
        "keywords": ("origin", "pivot", "center point", "rotate around", "mirror line", "off center"),
        "text": """Tool card: Origin and Pivot
- Origin is the object's anchor point; pivot is the point Blender uses for rotate and scale operations.
- UI path: Object Mode, right-click object > Set Origin, or use the Pivot Point menu in the viewport header.
- Plain English: if transforms rotate or mirror around a weird spot, Blender is probably using an anchor point you did not expect.
- Visual check: the small orange dot should sit where the object should scale, rotate, or mirror from.""",
    },
    "normals": {
        "keywords": ("normal", "normals", "inside out", "black face", "weird shading"),
        "text": """Tool card: Normals
- Normals are face directions; Blender uses them to decide which way a surface faces for lighting.
- UI path: Edit Mode, select all with A, then Mesh > Normals > Recalculate Outside.
- Plain English: if normals are wrong, Blender may shade a surface like it is facing the wrong way.
- Visual check: faces should shade consistently after recalculating.""",
    },
    "shade_smooth": {
        "keywords": ("smooth", "shade smooth", "faceted", "shading", "auto smooth"),
        "text": """Tool card: Shade Smooth
- Shade Smooth changes how light is blended across faces; it does not add geometry by itself.
- UI path: Object Mode, right-click object, choose Shade Smooth.
- If edges become too mushy, add Auto Smooth/mark sharp edges or use a Bevel modifier to keep product edges crisp.
- Visual check: curved areas look smoother, while important hard edges may need support.""",
    },
    "modifier": {
        "keywords": ("modifier", "bevel modifier", "mirror", "subdivision", "non destructive", "apply"),
        "text": """Tool card: Modifiers
- Modifiers are adjustable effects stacked on an object without permanently changing the base mesh until applied.
- UI path: Properties editor > wrench icon > Add Modifier.
- For beginners, prefer leaving modifiers unapplied while learning so settings can be changed later.
- Visual check: the modifier appears in the stack and can be toggled on/off with the viewport icon.""",
    },
    "camera_light": {
        "keywords": ("camera", "composition", "frame", "framing", "numpad 0", "product shot"),
        "text": """Tool card: Camera Framing
- Camera controls what the final render sees; lights control how the object reads.
- UI path: add/select Camera, press Numpad 0 to view through it, use G/R to move/rotate.
- For product ads, first make the object silhouette readable, then frame camera and lighting.
- Visual check: the main object should fill the camera view without cutting off important edges.""",
    },
    "lighting": {
        "keywords": ("light", "lighting", "shadow", "highlight", "reflection", "too dark", "area light"),
        "text": """Tool card: Product Lighting
- Area Lights create broad soft reflections that help product shapes read clearly.
- UI path: Add > Light > Area, then move/rotate it with G/R and adjust Power/Size in light settings.
- For glossy phone-style renders, large soft lights are usually easier than tiny point lights.
- Visual check: edges should show readable highlights without blowing out the screen or body.""",
    },
    "material": {
        "keywords": ("material", "color", "metal", "glass", "black", "screen", "roughness", "shader"),
        "text": """Tool card: Materials
- Materials control color, metalness, roughness, and how surfaces react to light.
- UI path: select object, Properties editor > material sphere icon > New.
- For an iPhone-style object, separate body material, screen material, and lens material are easier to tune.
- Visual check: the object should have named material slots instead of one mystery material doing everything.""",
    },
    "render_basics": {
        "keywords": ("render", "cycles", "eevee", "final image", "output", "transparent", "resolution"),
        "text": """Tool card: Render Basics
- Rendering creates the final image from the camera view, materials, and lights.
- UI path: press F12 or use Render > Render Image; set resolution in Output Properties.
- For checking composition, use the camera view first so the render is not a surprise.
- Visual check: the render should show the camera-framed product with expected lighting and materials.""",
    },
}

LOCAL_OFFICIAL_KNOWLEDGE: list[dict[str, Any]] = [
    {
        "id": "apply_scale",
        "title": "Apply - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/scene_layout/object/editing/apply.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.88,
        "keywords": (
            "apply scale",
            "ctrl a scale",
            "scale not 1",
            "scale is not 1",
            "transform apply",
            "bevel looks wrong",
            "bevel modifier does nothing",
        ),
        "summary": (
            "Apply Scale makes Blender treat the object's current size as its normal transform basis. "
            "For modifier weirdness, check Object Mode, selected object, then Ctrl+A > Scale before judging the modifier."
        ),
    },
    {
        "id": "bevel_modifier",
        "title": "Bevel Modifier - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.88,
        "keywords": (
            "bevel modifier",
            "bevel does nothing",
            "bevel not visible",
            "round corners",
            "rounded edges",
            "chamfer",
            "segments",
            "clamp overlap",
        ),
        "summary": (
            "The Bevel modifier bevels mesh edges non-destructively. If it appears to do nothing, verify selected mesh, "
            "modifier visibility, Amount relative to scene units, non-unit scale, and Clamp Overlap limiting close edges."
        ),
    },
    {
        "id": "bevel_tool",
        "title": "Bevel Tool - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/bevel.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": (
            "ctrl b",
            "edge bevel",
            "bevel selected edge",
            "bevel tool",
            "edit mode bevel",
        ),
        "summary": (
            "The Edit Mode Bevel tool works on selected vertices, edges, or faces. It is useful for direct mesh edits, "
            "while the modifier is easier to revise later."
        ),
    },
    {
        "id": "startup_units",
        "title": "Defaults and Scene Units - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/getting_started/configuration/defaults.html",
        "secondary_url": "https://docs.blender.org/manual/en/latest/scene_layout/scene/properties.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.86,
        "keywords": (
            "startup",
            "default units",
            "default unit",
            "loads in meters",
            "open in meters",
            "new file meters",
            "meters instead of mm",
            "units on start",
            "save startup file",
            "future files",
        ),
        "summary": (
            "Current-scene units live in Scene Properties > Units. Future new-file defaults require setting the scene first, "
            "then File > Defaults > Save Startup File. Do not answer this as only a current-file unit change."
        ),
    },
    {
        "id": "curves_geometry",
        "title": "Curve Geometry - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/curves/properties/geometry.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": (
            "curve bevel depth",
            "bevel depth",
            "cable",
            "wire",
            "cord",
            "hose",
            "bend",
            "flexible",
            "curved tube",
        ),
        "summary": (
            "Curve objects can be given thickness through Geometry > Bevel Depth, making a smooth bent tube without adding "
            "many mesh loop cuts. Use this for flexible cords/wires unless mesh editing is specifically needed."
        ),
    },
    {
        "id": "inset_faces",
        "title": "Inset Faces - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/inset_faces.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": ("inset", "screen border", "panel", "rim", "face inside", "button recess", "port recess"),
        "summary": (
            "Inset Faces creates an inner border on selected faces, useful for panels, screens, rims, and recesses. "
            "Start in Edit Mode, Face Select, with the face selected."
        ),
    },
    {
        "id": "loop_cut",
        "title": "Loop Cut and Slide - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/loopcut_slide.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.82,
        "keywords": ("loop cut", "ctrl r", "support loop", "edge loop", "add segment", "add geometry", "topology"),
        "summary": (
            "Loop Cut and Slide adds edge loops through connected faces. It works best on clean quad topology and can fail "
            "or stop early on messy triangles/ngons."
        ),
    },
    {
        "id": "solidify_modifier",
        "title": "Solidify Modifier - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/solidify.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": ("solidify", "thickness", "thin surface", "shell", "case", "wall thickness"),
        "summary": (
            "Solidify adds thickness to surfaces and shells. For beginners, leave it as a modifier while tuning thickness."
        ),
    },
    {
        "id": "mirror_modifier",
        "title": "Mirror Modifier - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/mirror.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.82,
        "keywords": ("mirror", "symmetry", "symmetrical", "left and right", "both sides", "mirror line"),
        "summary": (
            "Mirror uses the object's origin and chosen axes to repeat geometry. If the result is offset, check origin and axis first."
        ),
    },
    {
        "id": "origin_pivot",
        "title": "Object Origin and Transform Properties - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/scene_layout/object/origin.html",
        "secondary_url": "https://docs.blender.org/manual/en/latest/scene_layout/object/properties/transforms.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.78,
        "keywords": ("origin", "pivot", "center point", "rotate around", "mirror line", "off center"),
        "summary": (
            "The object origin is the object's anchor for transforms and many modifiers; the pivot setting controls what point "
            "operations rotate/scale around."
        ),
    },
    {
        "id": "normals",
        "title": "Normals - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/normals.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.82,
        "keywords": ("normal", "normals", "inside out", "black face", "weird shading", "recalculate outside"),
        "summary": (
            "Normals are surface directions used for shading and visibility. If faces shade inconsistently, use Edit Mode, "
            "select all, Mesh > Normals > Recalculate Outside."
        ),
    },
    {
        "id": "shade_smooth",
        "title": "Shade Smooth and Flat - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/scene_layout/object/editing/shading.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.8,
        "keywords": ("shade smooth", "shade flat", "faceted", "smooth shading", "auto smooth", "sharp edges"),
        "summary": (
            "Shade Smooth changes how lighting is interpolated across faces; it does not add geometry. Crisp product edges "
            "may still need bevels, marked sharp edges, or normal settings."
        ),
    },
    {
        "id": "cameras",
        "title": "Cameras - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/render/cameras.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": ("camera", "frame", "framing", "composition", "numpad 0", "product shot", "camera view"),
        "summary": (
            "The camera defines what the render sees. For product shots, inspect camera view before rendering and frame the object "
            "so the important silhouette is not cut off."
        ),
    },
    {
        "id": "materials_principled",
        "title": "Principled BSDF and Materials - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html",
        "secondary_url": "https://docs.blender.org/manual/en/latest/render/materials/introduction.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.84,
        "keywords": (
            "material",
            "materials",
            "principled",
            "bsdf",
            "color",
            "roughness",
            "metallic",
            "glass",
            "screen material",
        ),
        "summary": (
            "Most beginner materials can start with the Principled BSDF controls: base color, metallic, roughness, alpha/transmission "
            "where available, then tune under actual lighting."
        ),
    },
    {
        "id": "render_output",
        "title": "Rendering and Output Properties - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/render/index.html",
        "secondary_url": "https://docs.blender.org/manual/en/latest/render/output/properties/output.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.82,
        "keywords": ("render", "render image", "f12", "output", "resolution", "cycles", "eevee", "final image"),
        "summary": (
            "A render uses camera, lights, materials, and output settings. For composition problems, check camera view first; "
            "for file size/shape, check Output Properties."
        ),
    },
    {
        "id": "selection_modes",
        "title": "Mesh Selection Modes - Blender Manual",
        "url": "https://docs.blender.org/manual/en/latest/modeling/meshes/selecting/introduction.html",
        "version": "Blender Manual latest; reconcile with live runtime version",
        "authority": "official",
        "confidence": 0.78,
        "keywords": ("select face", "face select", "edge select", "vertex select", "select mode", "1 2 3", "can't select faces"),
        "summary": (
            "Mesh vertex, edge, and face selection happen in Edit Mode. If mesh selections/tools are missing, verify the active object "
            "is a mesh and the user is not still in Object Mode."
        ),
    },
    {
        "id": "release_notes",
        "title": "Blender Release Notes",
        "url": "https://developer.blender.org/docs/release_notes/",
        "version": "Versioned release notes; use live runtime version when provided",
        "authority": "official",
        "confidence": 0.76,
        "keywords": ("blender 5.0", "version", "changed", "release notes", "new in blender", "deprecated", "ui changed"),
        "summary": (
            "Version-sensitive claims should be checked against Blender release notes and the live runtime version instead of stale memory."
        ),
    },
    {
        "id": "python_api",
        "title": "Blender Python API",
        "url": "https://docs.blender.org/api/current/index.html",
        "version": "Current API docs; only use when the user asks for code or API behavior",
        "authority": "official",
        "confidence": 0.76,
        "keywords": ("python", "script", "api", "bpy", "operator", "code"),
        "summary": (
            "The Python API is the source for scripting details. Do not provide Blender Python unless the user explicitly asks for code."
        ),
    },
]

COMPACTION_SYSTEM_PROMPT = """You compact a Blender tutoring chat.

Create a concise session summary that preserves:
- the user's goal and current project direction
- important Blender objects/settings already discussed
- decisions, gotchas, and next steps
- unresolved questions

Do not invent facts. Keep it compact enough to paste back into future model context.
"""


def normalize_base_url(base_url: str) -> str:
    return (base_url or DEFAULT_BACKEND_BASE_URL).strip().rstrip("/")


def endpoint_url(base_url: str, path: str) -> str:
    return f"{normalize_base_url(base_url)}/{path.lstrip('/')}"


def is_auto_model_name(model_name: str) -> bool:
    return not (model_name or "").strip() or (model_name or "").strip().lower() == "auto"


def truth_file_path(blend_filepath: str | Path) -> Path | None:
    if not blend_filepath:
        return None
    blend_path = Path(blend_filepath)
    if not blend_path.name:
        return None
    return blend_path.parent / "truth.md"


def starter_truth_md(project_name: str) -> str:
    clean_name = project_name or "Untitled Blender Project"
    return textwrap.dedent(
        f"""\
        # {clean_name}

        ## What This Project Is Supposed To Be
        Write the plain-English goal here.

        ## Current State
        Describe what exists in the scene right now.

        ## Visual Direction
        Note references, style, mood, proportions, and constraints.

        ## Things I Am Learning
        Track Blender concepts or tools you want the tutor to explain.

        ## Open Questions
        Keep confusing points here so a fresh chat can pick up quickly.
        """
    )


def read_limited_text(path: Path, limit: int = MAX_TRUTH_CHARS) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[truncated]"


def encode_image_data_url(path: str | Path) -> str:
    image_path = Path(path)
    raw = image_path.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 14)] + "\n[truncated]"


def dump_scene_snapshot(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))


def load_scene_snapshot(raw: str) -> dict[str, Any] | None:
    if not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def estimate_tokens(text: str) -> int:
    """Fast rough token estimate for local context budgeting.

    Local model tokenizers differ, so this deliberately favors a stable
    approximate meter over pretending to be exact.
    """

    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def estimate_prompt_tokens(
    *,
    prompt: str,
    truth_md: str,
    scene_context: str,
    runtime_facts: str = "",
    tool_references: str = "",
    scene_diff: str = "",
    recent_messages: list[dict[str, str]] | None = None,
    compacted_summary: str = "",
) -> int:
    context_text = build_context_text(
        prompt,
        truth_md,
        scene_context,
        runtime_facts,
        tool_references,
        scene_diff,
        compacted_summary=compacted_summary,
    )
    total = estimate_tokens(SYSTEM_PROMPT) + estimate_tokens(context_text)
    for message in trim_chat_history(recent_messages or []):
        total += estimate_tokens(message.get("role", ""))
        total += estimate_tokens(message.get("content", ""))
    return total


def should_send_screenshot(
    *,
    context_mode: str,
    include_screenshot: bool,
    prompt: str,
) -> bool:
    if not include_screenshot:
        return False
    mode = (context_mode or CONTEXT_MODE_AUTO).upper()
    if mode == CONTEXT_MODE_SCENE:
        return False
    if mode == CONTEXT_MODE_VIEWPORT:
        return True
    lower_prompt = (prompt or "").lower()
    return any(keyword in lower_prompt for keyword in VISUAL_PROMPT_KEYWORDS)


def should_include_project_brief(prompt: str) -> bool:
    lower_prompt = (prompt or "").lower()
    return any(keyword in lower_prompt for keyword in PROJECT_BRIEF_PROMPT_KEYWORDS)


def blender_version_from_runtime(runtime_facts: str) -> str:
    match = BLENDER_VERSION_RE.search(runtime_facts or "")
    return match.group(1).strip() if match else ""


def blender_version_from_prompt(prompt: str) -> str:
    match = USER_STATED_BLENDER_VERSION_RE.search(prompt or "")
    return match.group(1).strip() if match else ""


def blender_version_lock(prompt: str, runtime_facts: str) -> str:
    runtime_version = blender_version_from_runtime(runtime_facts)
    if runtime_version:
        return (
            f"Active Blender runtime version: {runtime_version}\n"
            "Treat this as authoritative for all UI paths, menus, tool names, and shortcuts. "
            "If older Blender memory conflicts, ignore the older memory. If unsure about a version-specific UI detail, say you are unsure and give the safest way to find it in this Blender version."
        )
    prompt_version = blender_version_from_prompt(prompt)
    if prompt_version:
        return (
            f"User-stated Blender version: {prompt_version}\n"
            "No live runtime version was provided, so follow the user's stated version for this answer. "
            "Do not give instructions for a different Blender version unless you clearly say the detail may have changed."
        )
    return (
        "No live Blender version was provided. Avoid version-specific claims when possible, and say when a UI path may vary by Blender version."
    )


def _contains_keyword(haystack: str, keyword: str) -> bool:
    """Match whole tool keywords instead of accidental substrings."""

    escaped = re.escape(str(keyword).lower())
    return bool(re.search(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", haystack))


def _scene_context_has_non_unit_scale(scene_context: str) -> bool:
    for match in re.finditer(r"Scale:\s*\(([^)]+)\)", scene_context, flags=re.IGNORECASE):
        raw_values = re.split(r"[,\s]+", match.group(1).strip())
        values: list[float] = []
        for raw_value in raw_values:
            if not raw_value:
                continue
            try:
                values.append(float(raw_value))
            except ValueError:
                continue
        if values and any(abs(value - 1.0) > 0.001 for value in values):
            return True
    return False


def select_tool_cards(prompt: str, scene_context: str = "", limit: int = 4) -> str:
    haystack = f"{prompt}\n{scene_context}".lower()
    selected: list[str] = []
    seen: set[str] = set()

    if _contains_keyword(haystack, "bevel") and _scene_context_has_non_unit_scale(scene_context):
        selected.append(str(TOOL_CARDS["apply_scale"]["text"]))
        seen.add("apply_scale")

    for key, card in TOOL_CARDS.items():
        if key in seen:
            continue
        keywords = card.get("keywords", ())
        if any(_contains_keyword(haystack, str(keyword)) for keyword in keywords):
            selected.append(str(card["text"]))
            seen.add(key)
        if len(selected) >= limit:
            break
    if not selected and any(_contains_keyword(haystack, word) for word in ("beginner", "next", "first", "start")):
        for key in ("mode", "modifier", "bevel"):
            if key not in seen:
                selected.append(str(TOOL_CARDS[key]["text"]))
            if len(selected) >= limit:
                break
    return "\n\n".join(selected)


@lru_cache(maxsize=1)
def load_veteran_cards() -> list[dict[str, Any]]:
    def read_data_file(filename: str) -> dict[str, Any] | None:
        try:
            raw_text = (
                importlib.resources.files(__package__)
                .joinpath("data", filename)
                .read_text(encoding="utf-8")
            )
        except Exception:
            data_path = Path(__file__).resolve().parent / "data" / filename
            if not data_path.exists():
                return None
            raw_text = data_path.read_text(encoding="utf-8")
        try:
            loaded = json.loads(raw_text)
        except json.JSONDecodeError:
            return None
        return loaded if isinstance(loaded, dict) else None

    def normalize_expansion_card(card: dict[str, Any]) -> dict[str, Any]:
        keywords = card.get("retrieval_keywords") or card.get("keywords") or []
        examples = card.get("semantic_match_examples") or card.get("examples") or []
        checks = card.get("live_context_checks") or card.get("checks") or []
        situation = str(card.get("user_situation") or card.get("summary") or card.get("title", ""))
        better_move = str(card.get("better_move") or card.get("move") or "")
        diagnosis = str(card.get("diagnosis_order") or card.get("diagnosis") or "")
        return {
            "id": str(card.get("id", "")),
            "title": str(card.get("title", "")),
            "type": str(card.get("type", "")),
            "tags": [str(item) for item in card.get("tags", []) if str(item).strip()],
            "retrieval_keywords": [str(item) for item in keywords if str(item).strip()],
            "semantic_match_examples": [str(item) for item in examples if str(item).strip()],
            "scene_clues": [str(item) for item in card.get("scene_clues", []) if str(item).strip()],
            "live_context_checks": [str(item) for item in checks if str(item).strip()],
            "user_situation": situation,
            "manual_pain": str(card.get("manual_pain") or card.get("pain") or ""),
            "better_move": better_move,
            "when_to_use": str(card.get("when_to_use") or card.get("use") or ""),
            "when_not_to_use": str(card.get("when_not_to_use") or card.get("not_use") or ""),
            "beginner_steps": str(card.get("beginner_steps") or card.get("steps") or better_move),
            "common_failure_points": [str(item) for item in card.get("common_failure_points", []) if str(item).strip()],
            "likely_causes": [str(item) for item in card.get("likely_causes", []) if str(item).strip()],
            "diagnosis_order": diagnosis,
            "what_blendy_should_say": str(card.get("what_blendy_should_say") or card.get("say") or ""),
            "what_blendy_should_avoid": str(card.get("what_blendy_should_avoid") or card.get("avoid") or ""),
            "notes": str(card.get("notes", "")),
            "sources": [source for source in card.get("sources", []) if isinstance(source, dict)],
            "source_quality": str(card.get("source_quality", "mixed")),
            "confidence_label": str(card.get("confidence_label", "High")),
            "confidence": float(card.get("confidence", 0.8)),
            "version_sensitivity": str(card.get("version_sensitivity", "low")),
            "destructive_risk": str(card.get("destructive_risk", "low")),
            "related_cards": [str(item) for item in card.get("related_cards", []) if str(item).strip()],
            "router_priority": str(card.get("router_priority", "P1")),
        }

    data = read_data_file("blendy_veteran_cards.json")
    if data is None:
        return []
    cards = [card for card in data.get("cards", []) if isinstance(card, dict)]
    expansion = read_data_file("blendy_veteran_cards_expansion.json")
    if expansion:
        seen_ids = {str(card.get("id", "")) for card in cards}
        for raw_card in expansion.get("cards", []):
            if not isinstance(raw_card, dict):
                continue
            normalized = normalize_expansion_card(raw_card)
            if not normalized["id"] or normalized["id"] in seen_ids:
                continue
            cards.append(normalized)
            seen_ids.add(normalized["id"])
    return cards


def veteran_cards_status() -> str:
    cards = load_veteran_cards()
    workflows = sum(1 for card in cards if card.get("type") == "workflow_shortcut")
    troubleshooting = sum(1 for card in cards if card.get("type") == "troubleshooting")
    return f"{len(cards)} veteran cards loaded; {workflows} workflow shortcuts; {troubleshooting} troubleshooting cards"


def _has_any_phrase(text: str, phrases: tuple[str, ...] | list[str]) -> bool:
    lower = (text or "").lower()
    return any(phrase in lower for phrase in phrases)


def _route_scores(
    prompt: str,
    scene_context: str = "",
    recent_messages: list[dict[str, str]] | None = None,
) -> tuple[dict[str, int], dict[str, list[str]]]:
    lower = (prompt or "").lower()
    scores = {
        "implementation": 15,
        "troubleshooting": 0,
        "visual_evaluation": 0,
        "settings_version_docs": 0,
        "planning_next_step": 0,
        "concept_explanation": 0,
    }
    reasons = {key: [] for key in scores}

    def bump(route: str, amount: int, reason: str) -> None:
        scores[route] = min(100, scores[route] + amount)
        reasons[route].append(reason)

    if _has_any_phrase(lower, ("how do i", "how to", "make", "create", "add", "model", "build", "turn it into")):
        bump("implementation", 30, "The prompt asks how to make or implement something.")
    if _has_any_phrase(lower, ("faster way", "better way", "by hand", "manually", "every loop", "all 30", "one by one", "tedious")):
        bump("implementation", 18, "The prompt has a manual-work pain smell.")
        bump("planning_next_step", 12, "The user is asking whether a different workflow would be smarter.")
    if _has_any_phrase(lower, ("doesn't", "does not", "didn't", "did not", "not working", "does nothing", "nothing changed", "still", "wrong", "missing", "disappeared", "pink", "can't", "cannot", "looks different", "mine looks different", "but")):
        bump("troubleshooting", 45, "The prompt describes an expected result versus actual result mismatch.")
    if _has_any_phrase(lower, ("i followed", "i did", "i added", "i changed", "i tried", "you told me", "that didn't work")):
        bump("troubleshooting", 25, "The user appears to have already tried a step.")
    if _has_any_phrase(lower, ("does this look", "look right", "looks right", "what do you see", "screenshot", "viewport", "proportion", "shape", "silhouette")):
        bump("visual_evaluation", 42, "The prompt asks for visual judgement.")
    if _has_any_phrase(lower, ("startup", "on start", "load in meters", "loads in meters", "meters instead", "default", "preferences", "where is", "menu", "blender 5", "version", "python", "api", "save startup file")):
        bump("settings_version_docs", 48, "The prompt is version, setting, menu, or docs sensitive.")
    if _has_any_phrase(lower, ("what next", "what's next", "next step", "should i", "would it be smart", "is it smart", "continue")):
        bump("planning_next_step", 36, "The prompt asks for the next move or workflow choice.")
    if _has_any_phrase(lower, ("what is", "why", "explain", "concept", "mean")):
        bump("concept_explanation", 28, "The prompt asks for explanation or reasoning.")

    if _scene_context_has_non_unit_scale(scene_context):
        bump("troubleshooting", 8, "Live scene data shows non-unit scale, a common modifier failure mode.")
    if re.search(r"\b(BEVEL|CURVE|ARRAY|MIRROR|BOOLEAN|SOLIDIFY|SIMPLE_DEFORM|LATTICE|SHRINKWRAP)\b", scene_context or "", re.IGNORECASE):
        bump("troubleshooting", 6, "The scene has modifiers that can fail silently through settings, order, or visibility.")

    recent_user = " ".join(
        item.get("content", "")
        for item in (recent_messages or [])[-4:]
        if item.get("role") == "user"
    ).lower()
    if recent_user and _has_any_phrase(recent_user, ("wrong", "didn't", "doesn't", "still", "nothing", "i followed")):
        bump("troubleshooting", 10, "Recent user context includes failed-result language.")

    return scores, reasons


def classify_router(
    prompt: str,
    scene_context: str = "",
    recent_messages: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    scores, reasons = _route_scores(prompt, scene_context, recent_messages)
    selected_route, selected_score = max(scores.items(), key=lambda item: item[1])
    if selected_score >= 75:
        answer_risk = "low"
    elif selected_score >= 55:
        answer_risk = "medium"
    else:
        answer_risk = "high"
    rejected = [
        {"route": route, "score": score, "topReasons": reasons[route][:2]}
        for route, score in sorted(scores.items(), key=lambda item: item[1], reverse=True)
        if route != selected_route
    ]
    return {
        "selectedRoute": selected_route,
        "score": selected_score,
        "answerRisk": answer_risk,
        "reasons": reasons[selected_route][:5] or ["Defaulted to implementation because no stronger route matched."],
        "routeScores": scores,
        "rejectedRoutes": rejected,
    }


def extract_scene_diagnostic_flags(prompt: str, scene_context: str = "", visual_context: str = "") -> list[dict[str, str]]:
    text = f"{prompt}\n{scene_context}\n{visual_context}"
    lower = text.lower()
    flags: list[dict[str, str]] = []

    def add(flag_id: str, label: str, severity: str, evidence: str, checks: list[str]) -> None:
        if any(item["id"] == flag_id for item in flags):
            return
        flags.append(
            {
                "id": flag_id,
                "label": label,
                "severity": severity,
                "evidence": evidence,
                "checks": checks,
            }
        )

    if _scene_context_has_non_unit_scale(scene_context):
        add("non_unit_scale", "Object scale is not 1,1,1", "high", "Scene context includes non-unit scale.", ["check_scale", "check_dimensions_units"])
    if re.search(r"\bBEVEL\b", text, re.IGNORECASE):
        add("bevel_present", "Bevel modifier or bevel task detected", "medium", "Scene or prompt mentions Bevel.", ["check_bevel_settings", "check_modifier_stack"])
    if re.search(r"\bviewport=off\b", text, re.IGNORECASE):
        add("modifier_viewport_off", "A modifier may be hidden in viewport", "high", "Modifier stack includes viewport=off.", ["check_modifier_visibility", "check_modifier_stack"])
    if _has_any_phrase(lower, ("object mode", "edit mode", "tool missing", "grayed out", "nothing happens")):
        add("mode_or_selection_sensitive", "Mode or selection may control the result", "medium", "Prompt/scene mentions Object Mode, Edit Mode, or missing tools.", ["check_mode", "check_active_object"])
    if re.search(r"\bCURVE\b", text, re.IGNORECASE) or _has_any_phrase(lower, ("curve modifier", "bezier", "cable", "wire", "hose", "tube")):
        add("curve_workflow_relevant", "Curve workflow may apply", "medium", "Prompt or scene mentions curve/cable/tube language.", ["check_curve_target_axis", "check_scale"])
    relationship_choice = (
        _has_any_phrase(lower, ("should", "does", "do i", "would it", "where"))
        and _has_any_phrase(lower, ("attach", "connect", "plug", "touch", "go into", "sit on", "line up with"))
        and (" or " in lower or " vs " in lower or " versus " in lower)
    )
    relationship_parts = _has_any_phrase(
        lower,
        (
            "part",
            "piece",
            "object",
            "body",
            "connector",
            "adapter",
            "plug",
            "socket",
            "port",
            "bracket",
            "hinge",
            "button",
            "screen",
            "cable",
            "wire",
            "cord",
            "strap",
            "handle",
            "panel",
        ),
    )
    if relationship_choice and relationship_parts:
        add(
            "part_relationship_choice_sensitive",
            "User-defined part relationship may matter",
            "high",
            "Prompt asks where one named part should attach/connect/plug/touch relative to another named part.",
            ["check_user_named_part_roles", "check_immediate_contact_chain"],
        )
    if re.search(r"\bARRAY\b", text, re.IGNORECASE) or _has_any_phrase(lower, ("repeat", "duplicate", "spacing", "radial")):
        add("array_workflow_relevant", "Array/repetition workflow may apply", "medium", "Prompt or scene mentions repeated/array work.", ["check_array_settings", "check_modifier_stack"])
    if re.search(r"\b(MIRROR|BOOLEAN|SOLIDIFY|SIMPLE_DEFORM|LATTICE|SHRINKWRAP)\b", text, re.IGNORECASE):
        add("modifier_stack_sensitive", "Modifier stack order/settings may matter", "medium", "Scene context includes a modifier that often depends on order and transforms.", ["check_modifier_stack"])
    if _has_any_phrase(lower, ("render", "camera view", "viewport", "material preview", "lighting")):
        add("visual_render_context", "Visual/render context matters", "medium", "Prompt involves camera, viewport, material preview, lighting, or render output.", ["check_scene_visual", "check_camera_render_visibility"])
    if _has_any_phrase(lower, ("ngon", "triangle", "topology", "loop cut", "pinch", "spike", "ugly corner")):
        add("topology_sensitive", "Topology may block or distort the operation", "medium", "Prompt mentions topology/loop/pinching artifacts.", ["check_topology", "check_subdivisions"])
    if not flags:
        add("no_specific_scene_flag", "No specific live-scene failure flag detected", "low", "Use scene context normally and avoid overclaiming.", [])
    return flags[:8]


def _card_text_blob(card: dict[str, Any]) -> str:
    values: list[str] = [
        str(card.get("title", "")),
        str(card.get("user_situation", "")),
        str(card.get("manual_pain", "")),
        str(card.get("better_move", "")),
        str(card.get("diagnosis_order", "")),
        str(card.get("notes", "")),
        " ".join(str(item) for item in card.get("retrieval_keywords", [])),
        " ".join(str(item) for item in card.get("tags", [])),
        " ".join(str(item) for item in card.get("semantic_match_examples", [])),
        " ".join(str(item) for item in card.get("likely_causes", [])),
    ]
    return "\n".join(values)


def _is_generic_card_term(term: str) -> bool:
    clean = re.sub(r"[^a-z0-9_ ]+", " ", term.lower()).strip()
    if not clean:
        return True
    parts = [part for part in clean.replace("_", " ").split() if part]
    if not parts:
        return True
    if clean in GENERIC_CARD_TERMS:
        return True
    if len(parts) == 1 and parts[0] in GENERIC_CARD_TERMS:
        return True
    return len(parts) > 1 and all(part in GENERIC_CARD_TERMS for part in parts)


def _card_receipt_sources(card: dict[str, Any], limit: int = 3) -> list[dict[str, str]]:
    sources = card.get("sources", []) if isinstance(card.get("sources"), list) else []
    cleaned: list[dict[str, str]] = []
    for source in sources[:limit]:
        if not isinstance(source, dict):
            continue
        cleaned.append(
            {
                "title": str(source.get("title", "Source")),
                "url": str(source.get("url", "")),
                "host": str(source.get("host", "")),
                "sourceType": str(source.get("source_type", "")),
                "quality": str(source.get("quality", "")),
            }
        )
    return cleaned


def _score_veteran_card(
    card: dict[str, Any],
    *,
    prompt: str,
    scene_context: str,
    router_trace: dict[str, Any],
    diagnostic_flags: list[dict[str, Any]],
) -> dict[str, Any] | None:
    route = str(router_trace.get("selectedRoute", "implementation"))
    card_type = str(card.get("type", ""))
    haystack = f"{prompt}\n{scene_context}".lower()
    score = 0
    reasons: list[str] = []

    if route == "troubleshooting" and card_type == "troubleshooting":
        score += 28
        reasons.append("Troubleshooting route selected.")
    elif route in {"implementation", "planning_next_step"} and card_type == "workflow_shortcut":
        score += 20
        reasons.append("Workflow/implementation route selected.")
    elif route != "troubleshooting" and card_type == "troubleshooting":
        score -= 14
    elif route == "troubleshooting" and card_type == "workflow_shortcut":
        score -= 6
    elif route == "visual_evaluation" and any(tag in card.get("tags", []) for tag in ("camera", "render", "material", "lighting", "normals")):
        score += 14
        reasons.append("Visual route matched render/material/shading card tags.")
    elif route == "settings_version_docs":
        score -= 6

    if card_type == "workflow_shortcut" and _has_any_phrase(haystack, ("faster", "better way", "by hand", "manually", "one by one", "all 30", "moving every")):
        score += 22
        reasons.append("Manual-work pain smell matched workflow shortcut cards.")
    if card_type == "workflow_shortcut" and any(tag in card.get("tags", []) for tag in ("cable", "curve")) and _has_any_phrase(haystack, ("cable", "wire", "tube", "hose", "cord", "stiff cylinder")):
        score += 18
        reasons.append("Cable/tube language matched curve workflow cards.")
        if "cable" in str(card.get("title", "")).lower() and "curve" in str(card.get("title", "")).lower():
            score += 10
            reasons.append("Dedicated cable-as-curve card matched.")
    if card_type == "workflow_shortcut" and any(tag in card.get("tags", []) for tag in ("simple_deform", "lattice", "proportional_editing", "curve")) and _has_any_phrase(haystack, ("30 loops", "all 30", "every loop", "by hand", "manually", "bend")):
        score += 12
        reasons.append("Manual bending/deformation language matched veteran workflow cards.")
    if card_type == "troubleshooting" and _has_any_phrase(haystack, ("still", "does nothing", "nothing changed", "wrong", "not working", "i followed", "i did", "mine looks different")):
        score += 24
        reasons.append("Expected-result mismatch matched troubleshooting cards.")

    for keyword in card.get("retrieval_keywords", [])[:24]:
        keyword_text = str(keyword).replace("_", " ").lower()
        if len(keyword_text) < 4 or _is_generic_card_term(keyword_text):
            continue
        if _contains_keyword(haystack, keyword_text):
            score += 7 if " " in keyword_text else 4
            if len(reasons) < 6:
                reasons.append(f"Matched keyword: {keyword_text}.")
    for tag in card.get("tags", []):
        tag_text = str(tag).replace("_", " ").lower()
        if _is_generic_card_term(tag_text):
            continue
        if _contains_keyword(haystack, tag_text):
            score += 6
            if len(reasons) < 6:
                reasons.append(f"Matched tag: {tag_text}.")

    flag_checks = {
        check
        for flag in diagnostic_flags
        for check in flag.get("checks", [])
        if isinstance(check, str)
    }
    card_checks = set(str(check) for check in card.get("live_context_checks", []))
    matched_checks = sorted(flag_checks & card_checks)
    if matched_checks:
        score += min(18, len(matched_checks) * 5)
        reasons.append("Matched live scene checks: " + ", ".join(matched_checks[:4]) + ".")

    priority = str(card.get("router_priority", "P1"))
    if card_type == "troubleshooting" and priority == "P0" and route == "troubleshooting":
        score += 8
        reasons.append("Preflight troubleshooting card priority.")
    elif priority == "P2":
        score -= 4

    score += round(float(card.get("confidence", 0.6)) * 10)
    if card.get("source_quality") == "weak":
        score -= 8
    elif card.get("source_quality") == "mixed":
        score -= 2

    if score < 18:
        return None
    return {
        "id": str(card.get("id", "")),
        "title": str(card.get("title", "")),
        "type": card_type,
        "score": int(score),
        "confidence": float(card.get("confidence", 0.0)),
        "sourceQuality": str(card.get("source_quality", "")),
        "destructiveRisk": str(card.get("destructive_risk", "")),
        "matchedChecks": matched_checks,
        "reasons": reasons[:6] or ["General card relevance."],
        "betterMove": truncate_text(str(card.get("better_move", "")), 280),
        "diagnosisOrder": truncate_text(str(card.get("diagnosis_order", "")), 280),
        "sources": _card_receipt_sources(card),
        "card": card,
    }


def select_veteran_cards(
    *,
    prompt: str,
    scene_context: str = "",
    router_trace: dict[str, Any],
    diagnostic_flags: list[dict[str, Any]],
    workflow_limit: int = 3,
    troubleshooting_limit: int = 3,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if router_trace.get("selectedRoute") == "settings_version_docs":
        return [], []
    scored: list[dict[str, Any]] = []
    for card in load_veteran_cards():
        match = _score_veteran_card(
            card,
            prompt=prompt,
            scene_context=scene_context,
            router_trace=router_trace,
            diagnostic_flags=diagnostic_flags,
        )
        if match:
            scored.append(match)
    scored.sort(key=lambda item: (int(item["score"]), float(item["confidence"])), reverse=True)
    workflows = [item for item in scored if item["type"] == "workflow_shortcut"][:workflow_limit]
    troubleshooting = [item for item in scored if item["type"] == "troubleshooting"][:troubleshooting_limit]
    return workflows, troubleshooting


def _format_sources_for_card(card: dict[str, Any], limit: int = 3) -> str:
    sources = card.get("sources", []) if isinstance(card.get("sources"), list) else []
    bits = []
    for source in sources[:limit]:
        title = str(source.get("title", "Source"))
        url = str(source.get("url", ""))
        quality = str(source.get("quality", ""))
        bits.append(f"{title} ({quality}): {url}")
    return " | ".join(bits) if bits else "No source links recorded."


def format_veteran_card_matches(matches: list[dict[str, Any]], empty_text: str) -> str:
    if not matches:
        return empty_text
    sections = []
    for match in matches:
        card = match.get("card", {})
        lines = [
            f"- Card: {match.get('title', '')}",
            f"  ID: {match.get('id', '')}",
            f"  Type: {match.get('type', '')}; Score: {match.get('score', 0)}; Confidence: {match.get('confidence', 0):.2f}; Source quality: {match.get('sourceQuality', '')}; Destructive risk: {match.get('destructiveRisk', '')}",
            f"  Why selected: {'; '.join(match.get('reasons', [])[:4])}",
        ]
        if card.get("better_move"):
            lines.append(f"  Better move: {truncate_text(str(card.get('better_move', '')), 450)}")
        if card.get("diagnosis_order"):
            lines.append(f"  Diagnosis order: {truncate_text(str(card.get('diagnosis_order', '')), 450)}")
        if card.get("beginner_steps"):
            lines.append(f"  Beginner steps: {truncate_text(str(card.get('beginner_steps', '')), 450)}")
        if card.get("likely_causes"):
            lines.append(f"  Likely causes: {truncate_text('; '.join(str(item) for item in card.get('likely_causes', [])[:6]), 450)}")
        if card.get("what_blendy_should_avoid"):
            lines.append(f"  Avoid: {truncate_text(str(card.get('what_blendy_should_avoid', '')), 300)}")
        lines.append(f"  Sources: {truncate_text(_format_sources_for_card(card), 650)}")
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def format_router_decision(router_trace: dict[str, Any], workflows: list[dict[str, Any]], troubleshooting: list[dict[str, Any]]) -> str:
    selected = router_trace.get("selectedRoute", "implementation")
    score = int(router_trace.get("score", 0))
    risk = router_trace.get("answerRisk", "medium")
    lines = [
        f"Selected route: {selected} (score {score}/100, answer risk {risk})",
        "Source priority: latest prompt -> live Blender runtime/scene/screenshot -> scene diff and user corrections -> local official docs -> workflow/troubleshooting cards -> broad web results with source-quality labels -> model memory.",
        "Top reasons:",
    ]
    lines.extend(f"- {reason}" for reason in router_trace.get("reasons", [])[:5])
    if workflows or troubleshooting:
        selected_cards = [*(match["title"] for match in troubleshooting), *(match["title"] for match in workflows)]
        lines.append("Selected cards: " + "; ".join(selected_cards[:6]))
    else:
        lines.append("Selected cards: none above threshold.")
    return truncate_text("\n".join(lines), MAX_ROUTER_DECISION_CHARS)


def format_scene_diagnostic_flags(flags: list[dict[str, Any]]) -> str:
    if not flags:
        return "[no scene diagnostic flags]"
    lines = []
    for flag in flags:
        checks = ", ".join(flag.get("checks", [])[:5]) if isinstance(flag.get("checks"), list) else ""
        lines.append(
            f"- {flag.get('label', flag.get('id', 'Flag'))} [{flag.get('severity', 'low')}]: "
            f"{flag.get('evidence', '')}"
            + (f" Checks: {checks}." if checks else "")
        )
    return truncate_text("\n".join(lines), MAX_SCENE_DIAGNOSTIC_FLAGS_CHARS)


def normalize_knowledge_mode(value: str | None) -> str:
    cleaned = re.sub(r"[^A-Z0-9]+", "_", str(value or "").upper()).strip("_")
    aliases = {
        "": DEFAULT_KNOWLEDGE_MODE,
        "AUTO": KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
        "LOCAL_AUTO": KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
        "LOCAL_AUTO_WEB": KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
        "LOCAL_PLUS_AUTO_WEB": KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
        "LOCAL_WEB": KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
        "LOCAL_ONLY": KNOWLEDGE_MODE_LOCAL_ONLY,
        "ASK": KNOWLEDGE_MODE_ASK_BEFORE_WEB,
        "ASK_BEFORE_WEB": KNOWLEDGE_MODE_ASK_BEFORE_WEB,
    }
    return aliases.get(cleaned, DEFAULT_KNOWLEDGE_MODE)


def knowledge_mode_label(value: str | None) -> str:
    return KNOWLEDGE_MODE_LABELS.get(normalize_knowledge_mode(value), KNOWLEDGE_MODE_LABELS[DEFAULT_KNOWLEDGE_MODE])


def docs_index_status(runtime_facts: str = "") -> str:
    version = _runtime_blender_version(runtime_facts) or "unknown runtime version"
    return (
        f"{OFFICIAL_DOC_INDEX_VERSION}; {len(LOCAL_OFFICIAL_KNOWLEDGE)} official Blender docs entries; "
        f"version source: {version}"
    )


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _runtime_blender_version(runtime_facts: str) -> str:
    match = BLENDER_VERSION_RE.search(runtime_facts or "")
    return match.group(1).strip() if match else ""


def _source_authority_label(authority: str) -> str:
    if authority == "official":
        return "official Blender docs"
    if authority == "vetted":
        return "vetted community source, lower authority than official docs"
    if authority == "web_search":
        return "general web search result, lower authority than official docs"
    return "model/background memory"


def _knowledge_score(prompt: str, scene_context: str, entry: dict[str, Any]) -> int:
    haystack = f"{prompt}\n{scene_context}".lower()
    score = 0
    for keyword in entry.get("keywords", ()):
        keyword_text = str(keyword).lower()
        if _contains_keyword(haystack, keyword_text):
            score += max(2, len(keyword_text.split()) + 1)
    if str(entry.get("id", "")).replace("_", " ") in haystack:
        score += 2
    return score


def select_knowledge_references(
    prompt: str,
    scene_context: str = "",
    limit: int = 4,
) -> list[dict[str, Any]]:
    if not _is_probably_blender_question(prompt, scene_context):
        return []
    scored: list[dict[str, Any]] = []
    for entry in LOCAL_OFFICIAL_KNOWLEDGE:
        score = _knowledge_score(prompt, scene_context, entry)
        if score <= 0:
            continue
        ref = dict(entry)
        ref["score"] = score
        ref["confidence"] = min(0.96, float(entry.get("confidence", 0.7)) + min(score, 10) * 0.01)
        hit_keywords = [
            str(keyword)
            for keyword in entry.get("keywords", ())
            if _contains_keyword(f"{prompt}\n{scene_context}".lower(), str(keyword).lower())
        ]
        ref["why_used"] = "Matched: " + ", ".join(hit_keywords[:5]) if hit_keywords else "Matched the Blender task."
        scored.append(ref)

    scored.sort(
        key=lambda item: (
            1 if item.get("authority") == "official" else 0,
            int(item.get("score", 0)),
            float(item.get("confidence", 0)),
        ),
        reverse=True,
    )
    return scored[:limit]


def _format_reference(ref: dict[str, Any], timestamp: str, runtime_version: str = "") -> str:
    version = str(ref.get("version") or runtime_version or "unknown")
    source = str(ref.get("url") or ref.get("path") or "local official docs index")
    secondary = str(ref.get("secondary_url") or "")
    lines = [
        f"- Title: {ref.get('title', 'Untitled source')}",
        f"  Source: {source}",
    ]
    if secondary:
        lines.append(f"  Secondary source: {secondary}")
    if ref.get("search_query"):
        lines.append(f"  Query: {ref.get('search_query')}")
    lines.extend(
        [
            f"  Authority: {_source_authority_label(str(ref.get('authority', 'official')))}",
            f"  Version: {version}",
            f"  Retrieved: {timestamp}",
            f"  Confidence: {float(ref.get('confidence', 0.0)):.2f}",
            f"  Why used: {ref.get('why_used', ref.get('why', 'Matched the user question.'))}",
            f"  Notes: {truncate_text(str(ref.get('summary') or ref.get('snippet') or ''), 650)}",
        ]
    )
    return "\n".join(lines)


def format_knowledge_references(
    refs: list[dict[str, Any]],
    *,
    timestamp: str,
    runtime_facts: str = "",
) -> str:
    if not refs:
        return "[no local official docs matched this prompt]"
    runtime_version = _runtime_blender_version(runtime_facts)
    return "\n\n".join(_format_reference(ref, timestamp, runtime_version) for ref in refs)


def _allowed_web_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.netloc)


def _plain_text_from_html(raw: str) -> tuple[str, str]:
    title_match = re.search(r"<title[^>]*>(.*?)</title>", raw, flags=re.IGNORECASE | re.DOTALL)
    title = html.unescape(re.sub(r"\s+", " ", title_match.group(1)).strip()) if title_match else ""
    cleaned = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return title, cleaned


def default_web_fetcher(url: str, timeout: float = 3.5) -> dict[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Blendy/0.5 local Blender tutor knowledge fetcher",
            "Accept": "text/html, text/plain;q=0.9, */*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read(120000)
        charset = response.headers.get_content_charset() or "utf-8"
        text = raw.decode(charset, errors="replace")
    title, plain = _plain_text_from_html(text)
    return {"url": url, "title": title or url, "text": plain}


def _search_result_url(raw_href: str) -> str:
    href = html.unescape(raw_href or "").strip()
    if not href:
        return ""
    if href.startswith("//"):
        href = f"https:{href}"
    if href.startswith("/l/"):
        parsed = urlparse(f"https://duckduckgo.com{href}")
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target)
    parsed = urlparse(href)
    if parsed.netloc.endswith("bing.com") and parsed.path.startswith("/ck/"):
        encoded = parse_qs(parsed.query).get("u", [""])[0]
        if encoded.startswith("a1"):
            encoded = encoded[2:]
        try:
            padding = "=" * (-len(encoded) % 4)
            decoded = base64.urlsafe_b64decode(f"{encoded}{padding}").decode("utf-8", errors="replace")
            if decoded.startswith("https://"):
                return decoded
        except Exception:
            return href
    return href if href.startswith("https://") else ""


def default_web_searcher(query: str, timeout: float = 4.5) -> list[dict[str, str]]:
    search_url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    results: list[dict[str, str]] = []
    seen: set[str] = set()

    # DuckDuckGo's HTML page shape changes occasionally, so keep two simple paths:
    # structured result blocks first, then a plain-text fallback.
    request = urllib.request.Request(
        search_url,
        headers={
            "User-Agent": "Blendy/0.5 local Blender tutor knowledge searcher",
            "Accept": "text/html, text/plain;q=0.9, */*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw_html = response.read(160000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    _, raw_text = _plain_text_from_html(raw_html)

    blocks = re.findall(r"<div[^>]+class=\"[^\"]*result[^\"]*\"[^>]*>(.*?)</div>\s*</div>", raw_html, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        link_match = re.search(r"<a[^>]+class=\"[^\"]*result__a[^\"]*\"[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, flags=re.IGNORECASE | re.DOTALL)
        if not link_match:
            continue
        url = _search_result_url(link_match.group(1))
        if not url or url in seen:
            continue
        seen.add(url)
        title = re.sub(r"<[^>]+>", " ", link_match.group(2))
        title = html.unescape(re.sub(r"\s+", " ", title).strip())
        snippet_match = re.search(r"<a[^>]+class=\"[^\"]*result__snippet[^\"]*\"[^>]*>(.*?)</a>", block, flags=re.IGNORECASE | re.DOTALL)
        snippet = ""
        if snippet_match:
            snippet = re.sub(r"<[^>]+>", " ", snippet_match.group(1))
            snippet = html.unescape(re.sub(r"\s+", " ", snippet).strip())
        results.append({"url": url, "title": title or url, "snippet": snippet})
        if len(results) >= 4:
            return results

    if results:
        return results

    fallback_lines = [line.strip() for line in re.split(r"\s{2,}", raw_text) if line.strip()]
    for line in fallback_lines:
        if "https://" not in line:
            continue
        url_match = re.search(r"https://\S+", line)
        if not url_match:
            continue
        url = url_match.group(0).rstrip(".,)")
        if url in seen:
            continue
        seen.add(url)
        results.append({"url": url, "title": line[:120], "snippet": line[:260]})
        if len(results) >= 4:
            break
    if results:
        return results

    bing_url = f"https://www.bing.com/search?q={quote_plus(query)}"
    request = urllib.request.Request(
        bing_url,
        headers={
            "User-Agent": "Mozilla/5.0 Blendy local Blender tutor knowledge searcher",
            "Accept": "text/html, text/plain;q=0.9, */*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw_html = response.read(180000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")

    blocks = re.findall(r"<li[^>]+class=\"[^\"]*b_algo[^\"]*\"[^>]*>(.*?)</li>", raw_html, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        link_match = re.search(r"<h2[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, flags=re.IGNORECASE | re.DOTALL)
        if not link_match:
            continue
        url = _search_result_url(link_match.group(1))
        if not url.startswith("https://") or url in seen:
            continue
        seen.add(url)
        title = re.sub(r"<[^>]+>", " ", link_match.group(2))
        title = html.unescape(re.sub(r"\s+", " ", title).strip())
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", block, flags=re.IGNORECASE | re.DOTALL)
        snippet = ""
        if snippet_match:
            snippet = re.sub(r"<[^>]+>", " ", snippet_match.group(1))
            snippet = html.unescape(re.sub(r"\s+", " ", snippet).strip())
        results.append({"url": url, "title": title or url, "snippet": snippet})
        if len(results) >= 4:
            break
    return results


def _relevant_snippet(text: str, prompt: str, limit: int = 700) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return ""
    terms = [term for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_]{3,}", prompt.lower()) if term != "blender"]
    sentences = re.split(r"(?<=[.!?])\s+", clean)
    for sentence in sentences:
        lower = sentence.lower()
        if any(term in lower for term in terms):
            return truncate_text(sentence.strip(), limit)
    return truncate_text(clean, limit)


def _is_version_or_stale_sensitive(prompt: str) -> bool:
    lower = (prompt or "").lower()
    return bool(
        re.search(r"\bblender\s+[0-9]+(?:\.[0-9]+){0,2}", lower)
        or any(
            phrase in lower
            for phrase in (
                "startup",
                "default",
                "future new files",
                "loads in",
                "preferences",
                "where is",
                "menu",
                "changed",
                "new version",
                "version",
                "release",
                "api",
                "python",
            )
        )
    )


def _is_probably_blender_question(prompt: str, scene_context: str = "") -> bool:
    prompt_lower = (prompt or "").lower()
    scene_lower = (scene_context or "").lower()
    blender_terms = (
        "blender",
        "mesh",
        "object mode",
        "edit mode",
        "modifier",
        "bevel",
        "extrude",
        "inset",
        "loop cut",
        "shade smooth",
        "normal",
        "material",
        "texture",
        "textures",
        "image texture",
        "uv",
        "unwrap",
        "label",
        "blend file",
        "viewport",
        "render",
        "camera",
        "curve",
        "geometry nodes",
        "bpy",
        "scene",
        "selected object",
        "cube",
    )
    has_blender_term = any(term in prompt_lower for term in blender_terms)
    scene_reference_terms = (
        "this",
        "that",
        "it",
        "selected",
        "object",
        "cube",
        "model",
        "shape",
        "edge",
        "face",
        "vertex",
        "make",
        "move",
        "scale",
        "rotate",
        "add",
        "fix",
        "looks",
        "look right",
    )
    non_blender_markers = (
        "actor",
        "who is",
        "who's",
        "person",
        "profile",
        "public figure",
        "social media",
        "male",
        "man",
        "musician",
        "singer",
        "movie",
        "film",
        "song",
        "band",
        "politician",
        "company",
        "restaurant",
        "weather",
        "stock",
    )
    explicit_lookup_markers = (
        "look up",
        "look online",
        "search online",
        "search the web",
        "web search",
        "use the internet",
        "google",
    )
    if any(marker in prompt_lower for marker in non_blender_markers) and not has_blender_term:
        return False
    if any(marker in prompt_lower for marker in explicit_lookup_markers) and not has_blender_term:
        return False
    if has_blender_term:
        return True
    return bool(scene_lower and any(term in prompt_lower for term in scene_reference_terms))


def is_explicit_web_lookup_request(prompt: str) -> bool:
    lower = (prompt or "").lower()
    return any(
        phrase in lower
        for phrase in (
            "go look",
            "look online",
            "look it up",
            "look this up",
            "look him up",
            "look them up",
            "search online",
            "search the web",
            "web search",
            "run a web search",
            "use the internet",
            "check the internet",
            "google",
            "googling",
            "go hunting on the web",
        )
    )


def _web_search_query(prompt: str) -> str:
    cleaned = re.sub(
        r"\b(do|run|perform|please|can you|could you|would you|use|attempt|make|just|ok|okay|tell me)\b",
        " ",
        prompt or "",
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\b(a\s+)?(live\s+)?(web\s+search|internet\s+search|online\s+search|search\s+online|search\s+the\s+web|look\s+online|look\s+up|look\s+it\s+up|look\s+this\s+up|look\s+her\s+up|look\s+him\s+up|look\s+them\s+up)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b(who|what)\s+is\s+(she|he|they|it)?\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(the|a|an|and)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bonline\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(on|for|about)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ?.!:")
    return cleaned or (prompt or "").strip()


def _is_person_lookup(prompt: str) -> bool:
    lower = (prompt or "").lower()
    return any(
        phrase in lower
        for phrase in (
            "who is",
            "actor",
            "profile",
            "person",
            "public figure",
            "male",
            "man",
            "look him up",
            "look them up",
        )
    )


def _web_search_queries(prompt: str, *, blender_question: bool) -> list[str]:
    base = _web_search_query(prompt)
    candidates: list[str] = []

    def add(query: str) -> None:
        clean = re.sub(r"\s+", " ", query or "").strip(" ?.!:")
        if clean and clean.lower() not in {item.lower() for item in candidates}:
            candidates.append(clean)

    if blender_question:
        add(f"Blender {base}")
        add(base)
        return candidates[:3]

    if _is_person_lookup(prompt):
        entity = re.sub(
            r"\b(actor|person|profile|bio|biography|public figure|male|man|who|is|she|he|they|it)\b",
            " ",
            base,
            flags=re.IGNORECASE,
        )
        entity = re.sub(r"\s+", " ", entity).strip()
        add(entity)
        if entity and len(entity.split()) > 1:
            add(f'"{entity}"')
        add(base)
    else:
        add(base)
        add(prompt)
    return candidates[:4]


def _is_troubleshooting_or_howto(prompt: str) -> bool:
    lower = (prompt or "").lower()
    return any(
        phrase in lower
        for phrase in (
            "how do i",
            "how to",
            "where",
            "doesn't",
            "does not",
            "isn't working",
            "not working",
            "does nothing",
            "wrong",
            "error",
            "instructions",
            "steps",
            "modifier",
            "tool",
            "shortcut",
            "setting",
        )
    )


def _should_attempt_web(prompt: str, refs: list[dict[str, Any]], mode: str, scene_context: str = "") -> bool:
    if mode != KNOWLEDGE_MODE_LOCAL_AUTO_WEB:
        return False
    if not _is_probably_blender_question(prompt, scene_context):
        return True
    if not _is_troubleshooting_or_howto(prompt) and not _is_version_or_stale_sensitive(prompt):
        return False
    strongest = max((float(ref.get("confidence", 0.0)) for ref in refs), default=0.0)
    return not refs or strongest < 0.86 or _is_version_or_stale_sensitive(prompt) or "does nothing" in prompt.lower()


def _web_candidates(prompt: str, refs: list[dict[str, Any]]) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(url: str, title: str, authority: str, why: str) -> None:
        if not url or url in seen or not _allowed_web_url(url):
            return
        seen.add(url)
        candidates.append({"url": url, "title": title, "authority": authority, "why": why})

    lower = (prompt or "").lower()
    if _is_version_or_stale_sensitive(prompt) and any(
        phrase in lower
        for phrase in ("most recent", "latest", "newest", "available as of today", "current version")
    ):
        add(
            "https://www.blender.org/download/",
            "Blender Download",
            "official",
            "Official Blender download page for current public release information.",
        )
        add(
            "https://www.blender.org/download/releases/",
            "Blender Releases",
            "official",
            "Official Blender releases page for version history.",
        )

    if not candidates:
        if "python" in lower or "api" in lower or "bpy" in lower:
            add("https://docs.blender.org/api/current/index.html", "Blender Python API", "official", "Code/API question with no local topic match.")
        elif _is_version_or_stale_sensitive(prompt):
            add("https://developer.blender.org/docs/release_notes/", "Blender Release Notes", "official", "Version-sensitive question with no local topic match.")

    if _is_troubleshooting_or_howto(prompt):
        query = quote_plus(f"{truncate_text(prompt, 100)} blender")
        add(
            f"https://blender.stackexchange.com/search?q={query}",
            "Blender StackExchange Search",
            "vetted",
            "Official docs may not cover this exact troubleshooting phrasing.",
        )

    return candidates[:4]


def _fetch_web_references(
    *,
    prompt: str,
    scene_context: str,
    refs: list[dict[str, Any]],
    mode: str,
    timestamp: str,
    web_fetcher: Any | None,
    web_searcher: Any | None,
    allow_default_web: bool,
    web_approved: bool = False,
) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    web_meta: dict[str, Any] = {
        "attemptedQueries": [],
        "usedQueries": [],
        "skippedResults": 0,
    }
    if mode == KNOWLEDGE_MODE_LOCAL_ONLY:
        return [], "Web lookup skipped: Knowledge Mode is Local Only.", web_meta
    ask_before_web_approved = mode == KNOWLEDGE_MODE_ASK_BEFORE_WEB and web_approved
    if mode == KNOWLEDGE_MODE_ASK_BEFORE_WEB and not web_approved:
        return [], "Web lookup skipped: Ask Before Web mode. Blendy should ask before searching online if local docs are not enough.", web_meta
    if not web_approved and not _should_attempt_web(prompt, refs, mode, scene_context):
        return [], "Web lookup not needed: local docs and live scene context were enough or the question was scene-specific.", web_meta

    fetcher = web_fetcher
    if fetcher is None:
        if not allow_default_web:
            return [], "Web lookup eligible but not run in this pure helper call.", web_meta
        fetcher = default_web_fetcher

    web_refs: list[dict[str, Any]] = []
    errors: list[str] = []
    official_candidates = [item for item in _web_candidates(prompt, refs) if item["authority"] == "official"]
    vetted_candidates = [item for item in _web_candidates(prompt, refs) if item["authority"] != "official"]
    for candidate in official_candidates + vetted_candidates:
        if len(web_refs) >= 2:
            break
        try:
            fetched = fetcher(candidate["url"])
            text = str(fetched.get("text", "")) if isinstance(fetched, dict) else str(fetched)
            title = str(fetched.get("title", candidate["title"])) if isinstance(fetched, dict) else candidate["title"]
            snippet = _relevant_snippet(text, prompt)
            if not snippet:
                errors.append(f"{candidate['url']}: empty snippet")
                continue
            authority = candidate["authority"]
            web_refs.append(
                {
                    "title": title or candidate["title"],
                    "url": candidate["url"],
                    "authority": authority,
                    "version": "live web at lookup time",
                    "confidence": 0.84 if authority == "official" else 0.58,
                    "why_used": candidate["why"],
                    "summary": snippet,
                    "retrieved": timestamp,
                }
            )
        except Exception as exc:
            errors.append(f"{candidate['url']}: {exc}")
            continue

    should_broad_search = (
        web_approved
        or is_explicit_web_lookup_request(prompt)
        or (mode == KNOWLEDGE_MODE_LOCAL_AUTO_WEB and not _is_probably_blender_question(prompt, scene_context))
    )
    if not web_refs and allow_default_web and should_broad_search:
        blender_question = _is_probably_blender_question(prompt, scene_context)
        search = web_searcher or default_web_searcher
        require_all_terms = _is_person_lookup(prompt) or not blender_question
        for candidate_query in _web_search_queries(prompt, blender_question=blender_question):
            web_meta["attemptedQueries"].append(candidate_query)
            try:
                search_results = search(candidate_query)
            except Exception as exc:
                errors.append(f"web search for {candidate_query}: {exc}")
                continue
            specific_terms = [
                term
                for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", candidate_query.lower())
                if term not in {"blender", "search", "online", "internet", "and", "the", "for"}
            ]
            usable_refs: list[dict[str, Any]] = []
            skipped_search_results = 0
            for result in search_results:
                if len(usable_refs) >= 2:
                    break
                url = str(result.get("url") or "")
                if not url.startswith("https://"):
                    continue
                host = urlparse(url).netloc.lower()
                title = str(result.get("title") or url)
                snippet = str(result.get("snippet") or title)
                if not snippet.strip():
                    continue
                haystack = f"{title} {snippet} {url}".lower()
                if require_all_terms and len(specific_terms) > 1:
                    has_specific_term = all(term in haystack for term in specific_terms)
                else:
                    has_specific_term = not specific_terms or any(term in haystack for term in specific_terms)
                if not has_specific_term:
                    skipped_search_results += 1
                    continue
                if host in OFFICIAL_DOC_HOSTS:
                    authority = "official"
                    confidence = 0.8
                    why = "Explicit web search found an official Blender source."
                elif host in VETTED_WEB_HOSTS:
                    authority = "vetted"
                    confidence = 0.58
                    why = "Explicit web search found a vetted Blender community source."
                else:
                    authority = "web_search"
                    confidence = 0.5 if "blender" in haystack else 0.38
                    why = "Explicit broad web search result. Treat as lower-confidence than local official docs; verify before relying on version-specific UI details."
                usable_refs.append(
                    {
                        "title": title,
                        "url": url,
                        "authority": authority,
                        "version": "live web search at lookup time",
                        "confidence": confidence,
                        "why_used": why,
                        "summary": truncate_text(snippet, 700),
                        "retrieved": timestamp,
                        "search_query": candidate_query,
                    }
                )
            web_meta["skippedResults"] += skipped_search_results
            if usable_refs:
                web_meta["usedQueries"].append(candidate_query)
                web_refs.extend(usable_refs[: max(0, 2 - len(web_refs))])
                break
        if not web_refs and web_meta["skippedResults"]:
            errors.append("web search returned results, but none matched the specific search terms")

    if web_refs:
        official_count = sum(1 for ref in web_refs if ref.get("authority") == "official")
        lower = " plus lower-authority web/search source" if len(web_refs) > official_count else ""
        prefix = "Web lookup approved by user and used" if ask_before_web_approved else "Web lookup used"
        query_note = ""
        if web_meta.get("usedQueries"):
            query_note = " Query: " + "; ".join(str(query) for query in web_meta["usedQueries"][:2]) + "."
        return web_refs, f"{prefix} {official_count} official source(s){lower}.{query_note}", web_meta
    if errors:
        return [], "Web lookup attempted but no usable snippet was retrieved: " + "; ".join(errors[:2]), web_meta
    return [], "Web lookup attempted but found no allowed candidates.", web_meta


def build_semantic_scene_card(
    prompt: str,
    scene_context: str = "",
    recent_messages: list[dict[str, str]] | None = None,
) -> str:
    lines = [f"Latest task: {truncate_text(prompt.strip(), 500) or '[empty prompt]'}"]
    wanted_prefixes = (
        "Scene:",
        "Frame:",
        "Object counts:",
        "Selected objects:",
        "Active object:",
        "Object type:",
        "Mode:",
        "Location:",
        "Rotation Euler:",
        "Scale:",
        "Dimensions:",
        "Mesh vertices:",
        "Mesh edges:",
        "Mesh faces:",
        "Selected mesh:",
        "Evaluated mesh:",
        "Material",
        "Modifier stack:",
        "- ",
    )
    collected = 0
    for raw_line in (scene_context or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(wanted_prefixes):
            lines.append(f"Scene fact: {truncate_text(line, 280)}")
            collected += 1
        if collected >= 18:
            break

    corrections: list[str] = []
    for item in (recent_messages or [])[-8:]:
        if item.get("role") != "user":
            continue
        content = item.get("content", "").strip()
        lower = content.lower()
        if any(phrase in lower for phrase in ("actually", "wrong", "i made", "remember", "no,", "you know", "i am on blender")):
            corrections.append(truncate_text(content, 350))
    for correction in corrections[-3:]:
        lines.append(f"Recent user-stated fact/correction: {correction}")
    return truncate_text("\n".join(lines), MAX_SEMANTIC_SCENE_CHARS)


def build_read_only_verification_notes(
    *,
    prompt: str,
    runtime_facts: str = "",
    scene_context: str = "",
    knowledge_refs: list[dict[str, Any]] | None = None,
    web_refs: list[dict[str, Any]] | None = None,
    web_status: str = "",
    knowledge_mode: str = DEFAULT_KNOWLEDGE_MODE,
) -> str:
    refs = knowledge_refs or []
    online = web_refs or []
    version = _runtime_blender_version(runtime_facts)
    lines = [
        "Blendy may inspect provided runtime, scene, screenshot, and docs. It must not claim it changed Blender.",
    ]
    if version:
        lines.append(f"Live Blender version available: {version}. This beats older model memory.")
    else:
        lines.append("No live Blender version found in runtime facts; avoid exact version claims unless the user stated a version.")
    if _scene_context_has_non_unit_scale(scene_context) and _contains_keyword(prompt.lower(), "bevel"):
        lines.append("Bevel-related check: selected scene data includes non-unit scale, so verify/apply scale before judging bevel settings.")
    if any(
        phrase in prompt.lower()
        for phrase in ("startup", "default units", "save startup file", "loads in meters", "load in meters", "on start")
    ):
        lines.append("Startup/defaults check: this is about future new files, not just current Scene Properties units.")
    if knowledge_mode == KNOWLEDGE_MODE_ASK_BEFORE_WEB and not online:
        lines.append("Ask Before Web is active: if local refs are not enough, ask the user before online lookup.")
    if web_status:
        lines.append(web_status)
    if not refs and not online:
        lines.append("Knowledge confidence is low. If model memory cannot answer safely, ask one clarifying question instead of inventing steps.")
    else:
        authority = "official docs"
        if online and any(ref.get("authority") != "official" for ref in online):
            authority += " plus lower-authority broad web"
        lines.append(f"Answer should cite/use {authority} before model memory.")
    return truncate_text("\n".join(lines), MAX_VERIFICATION_NOTES_CHARS)


def _knowledge_reliance(refs: list[dict[str, Any]], web_refs: list[dict[str, Any]]) -> str:
    if web_refs and refs:
        if any(ref.get("authority") != "official" for ref in web_refs):
            return "live scene + local official docs + broad web results + model memory fallback"
        return "live scene + local official docs + live official docs + model memory fallback"
    if refs:
        return "live scene + local official docs + model memory fallback"
    if web_refs:
        return "live scene + broad web references + model memory fallback"
    return "live scene + model memory fallback only"


def retrieve_knowledge(
    *,
    prompt: str,
    scene_context: str = "",
    runtime_facts: str = "",
    recent_messages: list[dict[str, str]] | None = None,
    knowledge_mode: str = DEFAULT_KNOWLEDGE_MODE,
    web_fetcher: Any | None = None,
    web_searcher: Any | None = None,
    allow_default_web: bool = False,
    web_approved: bool = False,
) -> dict[str, Any]:
    mode = normalize_knowledge_mode(knowledge_mode)
    timestamp = _utc_timestamp()
    router_trace = classify_router(prompt, scene_context, recent_messages)
    diagnostic_flags = extract_scene_diagnostic_flags(prompt, scene_context)
    if _is_probably_blender_question(prompt, scene_context):
        workflow_matches, troubleshooting_matches = select_veteran_cards(
            prompt=prompt,
            scene_context=scene_context,
            router_trace=router_trace,
            diagnostic_flags=diagnostic_flags,
        )
    else:
        workflow_matches, troubleshooting_matches = [], []
    local_refs = select_knowledge_references(prompt, scene_context)
    web_refs, web_status, web_meta = _fetch_web_references(
        prompt=prompt,
        scene_context=scene_context,
        refs=local_refs,
        mode=mode,
        timestamp=timestamp,
        web_fetcher=web_fetcher,
        web_searcher=web_searcher,
        allow_default_web=allow_default_web,
        web_approved=web_approved or is_explicit_web_lookup_request(prompt),
    )
    knowledge_references = format_knowledge_references(
        local_refs,
        timestamp=timestamp,
        runtime_facts=runtime_facts,
    )
    web_references = (
        "\n\n".join(_format_reference(ref, timestamp, _runtime_blender_version(runtime_facts)) for ref in web_refs)
        if web_refs
        else f"[{web_status}]"
    )
    router_decision = format_router_decision(router_trace, workflow_matches, troubleshooting_matches)
    scene_diagnostic_flags = format_scene_diagnostic_flags(diagnostic_flags)
    workflow_cards = truncate_text(
        format_veteran_card_matches(workflow_matches, "[no workflow shortcut cards selected]"),
        MAX_WORKFLOW_CARDS_CHARS,
    )
    troubleshooting_cards = truncate_text(
        format_veteran_card_matches(troubleshooting_matches, "[no troubleshooting cards selected]"),
        MAX_TROUBLESHOOTING_CARDS_CHARS,
    )
    semantic_scene = build_semantic_scene_card(prompt, scene_context, recent_messages)
    verification_notes = build_read_only_verification_notes(
        prompt=prompt,
        runtime_facts=runtime_facts,
        scene_context=scene_context,
        knowledge_refs=local_refs,
        web_refs=web_refs,
        web_status=web_status,
        knowledge_mode=mode,
    )
    source_urls = [
        str(ref.get("url") or ref.get("path") or "")
        for ref in [*local_refs, *web_refs]
        if ref.get("url") or ref.get("path")
    ]
    confidence = max(
        [
            *[float(ref.get("confidence", 0.0)) for ref in [*local_refs, *web_refs]],
            *[float(match.get("confidence", 0.0)) for match in [*workflow_matches, *troubleshooting_matches]],
        ],
        default=0.0,
    )
    base_reliance = _knowledge_reliance(local_refs, web_refs)
    if workflow_matches or troubleshooting_matches:
        base_reliance = base_reliance.replace(" + model memory fallback", "")
        base_reliance = f"{base_reliance} + veteran workflow/troubleshooting cards + model memory fallback"
    selected_card_sources = [
        {
            "title": match["title"],
            "url": "",
            "authority": "community_workflow" if match["type"] == "workflow_shortcut" else "community_troubleshooting",
            "confidence": round(float(match.get("confidence", 0.0)), 2),
            "score": int(match.get("score", 0)),
            "sourceQuality": match.get("sourceQuality", ""),
        }
        for match in [*troubleshooting_matches, *workflow_matches]
    ]
    return {
        "router_decision": router_decision,
        "scene_diagnostic_flags": scene_diagnostic_flags,
        "workflow_cards": workflow_cards,
        "troubleshooting_cards": troubleshooting_cards,
        "knowledge_references": truncate_text(knowledge_references, MAX_KNOWLEDGE_REFS_CHARS),
        "web_references": truncate_text(web_references, MAX_WEB_REFS_CHARS),
        "semantic_scene_card": semantic_scene,
        "verification_notes": verification_notes,
        "router_trace": {
            **router_trace,
            "diagnosticFlags": diagnostic_flags,
            "workflowCards": [
                {
                    "id": match["id"],
                    "title": match["title"],
                    "type": match["type"],
                    "score": match["score"],
                    "confidence": match["confidence"],
                    "sourceQuality": match["sourceQuality"],
                    "destructiveRisk": match["destructiveRisk"],
                    "matchedChecks": match["matchedChecks"],
                    "reasons": match["reasons"],
                    "betterMove": match.get("betterMove", ""),
                    "diagnosisOrder": match.get("diagnosisOrder", ""),
                    "sources": match.get("sources", []),
                }
                for match in workflow_matches
            ],
            "troubleshootingCards": [
                {
                    "id": match["id"],
                    "title": match["title"],
                    "type": match["type"],
                    "score": match["score"],
                    "confidence": match["confidence"],
                    "sourceQuality": match["sourceQuality"],
                    "destructiveRisk": match["destructiveRisk"],
                    "matchedChecks": match["matchedChecks"],
                    "reasons": match["reasons"],
                    "betterMove": match.get("betterMove", ""),
                    "diagnosisOrder": match.get("diagnosisOrder", ""),
                    "sources": match.get("sources", []),
                }
                for match in troubleshooting_matches
            ],
            "cardsStatus": veteran_cards_status(),
            "webDecision": web_status,
            "webSearchQueries": web_meta.get("attemptedQueries", []),
            "webSearchUsedQueries": web_meta.get("usedQueries", []),
        },
        "knowledge_status": {
            "mode": mode,
            "modeLabel": knowledge_mode_label(mode),
            "docsIndexStatus": docs_index_status(runtime_facts),
            "lastWebLookupStatus": web_status,
            "webSearchQueries": web_meta.get("attemptedQueries", []),
            "webSearchUsedQueries": web_meta.get("usedQueries", []),
            "sourceUrls": source_urls,
            "confidence": round(confidence, 2),
            "reliedOn": base_reliance,
            "retrievedAt": timestamp,
            "selectedRoute": router_trace.get("selectedRoute", ""),
            "routeScore": int(router_trace.get("score", 0)),
            "answerRisk": router_trace.get("answerRisk", "medium"),
            "veteranCardsStatus": veteran_cards_status(),
            "selectedCards": [match["title"] for match in [*troubleshooting_matches, *workflow_matches]],
        },
        "knowledge_sources": [
            {
                "title": str(ref.get("title", "")),
                "url": str(ref.get("url") or ref.get("path") or ""),
                "authority": str(ref.get("authority", "")),
                "confidence": round(float(ref.get("confidence", 0.0)), 2),
                "whyUsed": str(ref.get("why_used", "")),
                "summary": str(ref.get("summary", "")),
                "retrieved": str(ref.get("retrieved", "")),
                "searchQuery": str(ref.get("search_query", "")),
            }
            for ref in [*local_refs, *web_refs]
        ]
        + selected_card_sources,
    }


def context_breakdown(
    *,
    prompt: str,
    truth_md: str,
    scene_context: str,
    runtime_facts: str = "",
    tool_references: str = "",
    scene_diff: str = "",
    router_decision: str = "",
    scene_diagnostic_flags: str = "",
    workflow_cards: str = "",
    troubleshooting_cards: str = "",
    knowledge_references: str = "",
    web_references: str = "",
    semantic_scene_card: str = "",
    verification_notes: str = "",
    recent_messages: list[dict[str, str]] | None = None,
    compacted_summary: str = "",
) -> dict[str, int]:
    history = trim_chat_history(recent_messages or [])
    included_truth_md = truncate_text(truth_md, MAX_TRUTH_CHARS) if should_include_project_brief(prompt) else ""
    return {
        "System": estimate_tokens(SYSTEM_PROMPT),
        "Prompt": estimate_tokens(prompt),
        "truth.md": estimate_tokens(included_truth_md),
        "Runtime": estimate_tokens(truncate_text(runtime_facts, MAX_RUNTIME_FACTS_CHARS)),
        "Scene": estimate_tokens(truncate_text(scene_context, MAX_SCENE_CHARS)),
        "Scene diff": estimate_tokens(truncate_text(scene_diff, MAX_SCENE_DIFF_CHARS)),
        "Router": estimate_tokens(truncate_text(router_decision, MAX_ROUTER_DECISION_CHARS)),
        "Scene flags": estimate_tokens(truncate_text(scene_diagnostic_flags, MAX_SCENE_DIAGNOSTIC_FLAGS_CHARS)),
        "Workflow cards": estimate_tokens(truncate_text(workflow_cards, MAX_WORKFLOW_CARDS_CHARS)),
        "Troubleshooting cards": estimate_tokens(truncate_text(troubleshooting_cards, MAX_TROUBLESHOOTING_CARDS_CHARS)),
        "Semantic scene": estimate_tokens(truncate_text(semantic_scene_card, MAX_SEMANTIC_SCENE_CHARS)),
        "Verification": estimate_tokens(truncate_text(verification_notes, MAX_VERIFICATION_NOTES_CHARS)),
        "Knowledge refs": estimate_tokens(truncate_text(knowledge_references, MAX_KNOWLEDGE_REFS_CHARS)),
        "Web refs": estimate_tokens(truncate_text(web_references, MAX_WEB_REFS_CHARS)),
        "Tool refs": estimate_tokens(truncate_text(tool_references, MAX_TOOL_REFS_CHARS)),
        "Summary": estimate_tokens(truncate_text(compacted_summary, 8000)),
        "Recent chat": sum(
            estimate_tokens(item.get("role", "")) + estimate_tokens(item.get("content", ""))
            for item in history
        ),
    }


def context_percent(tokens: int, limit: int = DEFAULT_CONTEXT_LIMIT_TOKENS) -> int:
    if limit <= 0:
        return 0
    return min(999, round((tokens / limit) * 100))


def context_status(tokens: int, limit: int = DEFAULT_CONTEXT_LIMIT_TOKENS) -> str:
    percent = context_percent(tokens, limit)
    if percent >= 90:
        return "DANGER"
    if percent >= 75:
        return "WARN"
    return "OK"


def auto_compact_threshold(
    limit: int = DEFAULT_CONTEXT_LIMIT_TOKENS,
    ratio: float = DEFAULT_AUTO_COMPACT_RATIO,
) -> int:
    if limit <= 0:
        return 0
    return max(1, int(limit * ratio))


def _format_snapshot_value(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.3f}"
    if isinstance(value, (list, tuple)):
        return "(" + ", ".join(_format_snapshot_value(part) for part in value) + ")"
    if isinstance(value, dict):
        return ", ".join(f"{key}={_format_snapshot_value(val)}" for key, val in sorted(value.items()))
    return str(value)


def scene_snapshot_diff(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    limit: int = MAX_SCENE_DIFF_CHARS,
) -> str:
    if not previous:
        return "No previous scene snapshot yet; this prompt becomes the comparison baseline."

    lines: list[str] = []
    previous_active = previous.get("active_object") or {}
    current_active = current.get("active_object") or {}
    previous_active_name = previous_active.get("name") or "none"
    current_active_name = current_active.get("name") or "none"
    if previous_active_name != current_active_name:
        lines.append(f"Active object changed: {previous_active_name} -> {current_active_name}")

    previous_selected = previous.get("selected_objects") or []
    current_selected = current.get("selected_objects") or []
    if previous_selected != current_selected:
        lines.append(
            "Selected objects changed: "
            f"{', '.join(previous_selected) or 'none'} -> {', '.join(current_selected) or 'none'}"
        )

    previous_counts = previous.get("object_counts") or {}
    current_counts = current.get("object_counts") or {}
    if previous_counts != current_counts:
        lines.append(
            "Object counts changed: "
            f"{_format_snapshot_value(previous_counts) or 'none'} -> "
            f"{_format_snapshot_value(current_counts) or 'none'}"
        )

    previous_objects = previous.get("objects") or {}
    current_objects = current.get("objects") or {}
    previous_names = set(previous_objects)
    current_names = set(current_objects)
    added = sorted(current_names - previous_names)
    removed = sorted(previous_names - current_names)
    if added:
        lines.append(f"Objects added: {', '.join(added[:8])}" + (" ..." if len(added) > 8 else ""))
    if removed:
        lines.append(f"Objects removed: {', '.join(removed[:8])}" + (" ..." if len(removed) > 8 else ""))

    names_to_check = []
    if current_active_name in current_objects:
        names_to_check.append(current_active_name)
    names_to_check.extend(name for name in sorted(previous_names & current_names) if name not in names_to_check)

    for name in names_to_check[:8]:
        before = previous_objects.get(name, {})
        after = current_objects.get(name, {})
        for field, label in (
            ("dimensions", "dimensions"),
            ("location", "location"),
            ("scale", "scale"),
            ("mesh", "mesh counts"),
            ("modifiers", "modifiers"),
            ("materials", "materials"),
            ("visible", "visibility"),
        ):
            if before.get(field) != after.get(field):
                lines.append(
                    f"{name} {label}: "
                    f"{_format_snapshot_value(before.get(field, 'none'))} -> "
                    f"{_format_snapshot_value(after.get(field, 'none'))}"
                )
        if len("\n".join(lines)) > limit:
            break

    if not lines:
        return "No major scene changes detected since last prompt."
    return truncate_text("\n".join(f"- {line}" for line in lines), limit)


def trim_chat_history(
    messages: list[dict[str, str]],
    max_messages: int | None = None,
    max_chars_per_message: int | None = None,
) -> list[dict[str, str]]:
    trimmed = messages[-max_messages:] if max_messages else messages
    return [
        {
            "role": item.get("role", "user"),
            "content": (
                truncate_text(item.get("content", ""), max_chars_per_message)
                if max_chars_per_message
                else item.get("content", "")
            ),
        }
        for item in trimmed
        if item.get("content")
    ]


def build_context_text(
    prompt: str,
    truth_md: str,
    scene_context: str,
    runtime_facts: str = "",
    tool_references: str = "",
    scene_diff: str = "",
    router_decision: str = "",
    scene_diagnostic_flags: str = "",
    workflow_cards: str = "",
    troubleshooting_cards: str = "",
    knowledge_references: str = "",
    web_references: str = "",
    semantic_scene_card: str = "",
    verification_notes: str = "",
    compacted_summary: str = "",
    visual_context: str = "",
) -> str:
    include_truth = should_include_project_brief(prompt)
    truth_part = truth_md.strip() if include_truth else "[omitted by default; ask about Project Brief, truth.md, project goal, requirements, or constraints to include it]"
    if include_truth and not truth_part:
        truth_part = "[truth.md is missing or empty]"
    summary_part = compacted_summary.strip() or "[no compacted session summary]"
    scene_part = scene_context.strip() or "[no scene context available]"
    visual_part = visual_context.strip() or "[visual capture status not provided]"
    runtime_part = runtime_facts.strip() or "[no Blender runtime facts available]"
    tool_part = tool_references.strip() or "[no targeted tool references selected]"
    scene_diff_part = scene_diff.strip() or "[no scene change summary available]"
    router_part = router_decision.strip() or "[no router decision available]"
    flags_part = scene_diagnostic_flags.strip() or "[no scene diagnostic flags]"
    workflow_part = workflow_cards.strip() or "[no workflow shortcut cards selected]"
    troubleshooting_part = troubleshooting_cards.strip() or "[no troubleshooting cards selected]"
    knowledge_part = knowledge_references.strip() or "[no local official docs matched this prompt]"
    web_part = web_references.strip() or "[web lookup not run]"
    semantic_part = semantic_scene_card.strip() or "[no semantic scene card available]"
    verification_part = verification_notes.strip() or "[no read-only verification notes available]"
    version_lock_part = blender_version_lock(prompt, runtime_facts)
    return textwrap.dedent(
        f"""\
        USER PROMPT
        {prompt.strip()}

        ROUTER DECISION
        {truncate_text(router_part, MAX_ROUTER_DECISION_CHARS)}

        BLENDER VERSION LOCK
        {version_lock_part}

        VISUAL CONTEXT
        {visual_part}

        BLENDER RUNTIME FACTS
        {truncate_text(runtime_part, MAX_RUNTIME_FACTS_CHARS)}

        CURRENT BLENDER SCENE CONTEXT
        {truncate_text(scene_part, MAX_SCENE_CHARS)}

        SCENE CHANGES SINCE LAST PROMPT
        {truncate_text(scene_diff_part, MAX_SCENE_DIFF_CHARS)}

        SCENE DIAGNOSTIC FLAGS
        {truncate_text(flags_part, MAX_SCENE_DIAGNOSTIC_FLAGS_CHARS)}

        SEMANTIC SCENE CARD
        {truncate_text(semantic_part, MAX_SEMANTIC_SCENE_CHARS)}

        READ-ONLY VERIFICATION NOTES
        {truncate_text(verification_part, MAX_VERIFICATION_NOTES_CHARS)}

        KNOWLEDGE REFERENCES
        {truncate_text(knowledge_part, MAX_KNOWLEDGE_REFS_CHARS)}

        WEB REFERENCES
        {truncate_text(web_part, MAX_WEB_REFS_CHARS)}

        WORKFLOW CARDS
        {truncate_text(workflow_part, MAX_WORKFLOW_CARDS_CHARS)}

        TROUBLESHOOTING CARDS
        {truncate_text(troubleshooting_part, MAX_TROUBLESHOOTING_CARDS_CHARS)}

        BLENDER TOOL REFERENCES
        {truncate_text(tool_part, MAX_TOOL_REFS_CHARS)}

        PROJECT BRIEF / TRUTH.MD
        {truncate_text(truth_part, MAX_TRUTH_CHARS)}

        COMPACTED SESSION SUMMARY
        {truncate_text(summary_part, 8000)}
        """
    )


def build_chat_payload(
    *,
    model_name: str,
    prompt: str,
    truth_md: str,
    scene_context: str,
    runtime_facts: str = "",
    tool_references: str = "",
    scene_diff: str = "",
    router_decision: str = "",
    scene_diagnostic_flags: str = "",
    workflow_cards: str = "",
    troubleshooting_cards: str = "",
    knowledge_references: str = "",
    web_references: str = "",
    semantic_scene_card: str = "",
    verification_notes: str = "",
    knowledge_mode: str = DEFAULT_KNOWLEDGE_MODE,
    recent_messages: list[dict[str, str]] | None = None,
    compacted_summary: str = "",
    screenshot_data_url: str | None = None,
    response_max_tokens: int = DEFAULT_RESPONSE_MAX_TOKENS,
) -> dict[str, Any]:
    model = (model_name or DEFAULT_MODEL_NAME).strip()
    visual_context = (
        "Viewport screenshot is attached to this message."
        if screenshot_data_url
        else "No viewport screenshot is attached. For visual questions, use scene data only and say if you cannot tell."
    )
    if not any(
        (
            router_decision,
            scene_diagnostic_flags,
            workflow_cards,
            troubleshooting_cards,
            knowledge_references,
            web_references,
            semantic_scene_card,
            verification_notes,
        )
    ):
        knowledge = retrieve_knowledge(
            prompt=prompt,
            scene_context=scene_context,
            runtime_facts=runtime_facts,
            recent_messages=recent_messages,
            knowledge_mode=knowledge_mode,
            allow_default_web=False,
        )
        router_decision = str(knowledge["router_decision"])
        scene_diagnostic_flags = str(knowledge["scene_diagnostic_flags"])
        workflow_cards = str(knowledge["workflow_cards"])
        troubleshooting_cards = str(knowledge["troubleshooting_cards"])
        knowledge_references = str(knowledge["knowledge_references"])
        web_references = str(knowledge["web_references"])
        semantic_scene_card = str(knowledge["semantic_scene_card"])
        verification_notes = str(knowledge["verification_notes"])
    context_text = build_context_text(
        prompt,
        truth_md,
        scene_context,
        runtime_facts,
        tool_references,
        scene_diff,
        router_decision,
        scene_diagnostic_flags,
        workflow_cards,
        troubleshooting_cards,
        knowledge_references,
        web_references,
        semantic_scene_card,
        verification_notes,
        compacted_summary,
        visual_context,
    )
    history = trim_chat_history(recent_messages or [])

    user_content: str | list[dict[str, Any]]
    if screenshot_data_url:
        user_content = [
            {"type": "text", "text": context_text},
            {"type": "image_url", "image_url": {"url": screenshot_data_url}},
        ]
    else:
        user_content = context_text

    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_content})
    return {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": max(256, int(response_max_tokens or DEFAULT_RESPONSE_MAX_TOKENS)),
        "stream": False,
    }


def build_compaction_payload(
    *,
    model_name: str,
    messages: list[dict[str, str]],
    existing_summary: str = "",
) -> dict[str, Any]:
    transcript_lines = []
    if existing_summary.strip():
        transcript_lines.append("Existing compacted summary:")
        transcript_lines.append(existing_summary.strip())
        transcript_lines.append("")
    for item in messages:
        role = item.get("role", "message").upper()
        content = item.get("content", "").strip()
        if content:
            transcript_lines.append(f"{role}: {content}")
    transcript = truncate_text("\n\n".join(transcript_lines), 24000)
    return {
        "model": (model_name or DEFAULT_MODEL_NAME).strip(),
        "messages": [
            {"role": "system", "content": COMPACTION_SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
        "temperature": 0.2,
        "max_tokens": DEFAULT_COMPACTION_MAX_TOKENS,
        "stream": False,
    }


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text:
                    parts.append(str(text))
        return "\n".join(parts).strip()
    if content is None:
        return ""
    return str(content).strip()


def _clean_reasoning_answer_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^\*\s*", "", line)
    line = re.sub(r"\*$", "", line)
    return line.strip()


def _is_scaffold_label(line: str) -> bool:
    normalized = re.sub(r"^\s*\d+\.\s*", "", line).strip().lower().rstrip(":")
    return normalized in {
        "goal",
        "next tool",
        "next tool/mode to use",
        "next tool / mode to use",
        "exact steps",
        "check",
        "if it looks wrong",
        "what i think you are trying to make",
        "what to look for when it worked",
        "one fallback if the result looks wrong",
    }


def _extract_answer_from_reasoning(reasoning_text: str) -> str:
    """Best-effort salvage for local models that put the answer in reasoning.

    Some LM Studio reasoning models can return an empty visible ``content``
    field while placing a drafted final answer inside ``reasoning_content``.
    This extracts that drafted answer without dumping the full scratchpad.
    """

    if not reasoning_text.strip():
        return ""

    markers = (
        "final response construction",
        "final plan",
        "drafting final response",
        "final polish",
        "refining steps",
    )
    lines = reasoning_text.replace("\r\n", "\n").replace("\r", "\n").splitlines()
    start_index = -1
    for index, line in enumerate(lines):
        lowered = line.lower()
        if any(marker in lowered for marker in markers):
            start_index = index + 1

    if start_index >= 0:
        collected: list[str] = []
        started = False
        for raw_line in lines[start_index:]:
            stripped = raw_line.lstrip()
            if stripped.startswith("*   ") and started:
                break
            if stripped.startswith("*   ") and not started:
                continue
            cleaned = _clean_reasoning_answer_line(raw_line)
            if cleaned:
                started = True
            if started:
                collected.append(cleaned)
        answer = "\n".join(collected).strip()
        if answer:
            return answer

    cleaned_lines = [
        _clean_reasoning_answer_line(line)
        for line in lines
        if _clean_reasoning_answer_line(line)
    ]
    return truncate_text("\n".join(cleaned_lines), 2400).strip()


def parse_chat_response(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("The response did not include any choices.")
    choice = choices[0]
    message = choice.get("message") or {}
    content_text = _message_content_to_text(message.get("content", ""))
    if content_text:
        return content_text

    reasoning_text = _message_content_to_text(
        message.get("reasoning_content") or message.get("reasoning")
    )
    finish_reason = str(choice.get("finish_reason") or "").lower()
    if reasoning_text:
        recovered = _extract_answer_from_reasoning(reasoning_text)
        if recovered:
            return recovered

    if finish_reason == "length":
        raise ValueError(
            "The local model hit the response length limit before returning a visible answer."
        )
    raise ValueError("The local model returned an empty visible answer.")


def format_chat_display_text(text: str) -> str:
    """Convert model Markdown into Blender-sidebar friendly plain text."""

    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"```[a-zA-Z0-9_-]*\n?", "", cleaned)
    cleaned = cleaned.replace("```", "")
    cleaned = cleaned.replace("`", "")
    cleaned = cleaned.replace("**", "")
    cleaned = cleaned.replace("__", "")
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)

    normalized_lines: list[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if _is_scaffold_label(line):
            continue
        line = re.sub(r"^\s*[-*]\s+", "- ", line)
        normalized_lines.append(line)

    spaced: list[str] = []
    for line in normalized_lines:
        is_numbered = bool(re.match(r"^\d+\.\s+", line))
        if is_numbered and spaced and spaced[-1] != "":
            spaced.append("")
        spaced.append(line)

    compacted: list[str] = []
    previous_blank = False
    for line in spaced:
        blank = not line
        if blank and previous_blank:
            continue
        compacted.append(line)
        previous_blank = blank
    return "\n".join(compacted).strip()


def post_chat_completion(
    base_url: str,
    payload: dict[str, Any],
    timeout: int = 180,
) -> str:
    payload = dict(payload)
    if is_auto_model_name(str(payload.get("model", ""))):
        payload["model"] = resolve_model_name(base_url, str(payload.get("model", "")), timeout=min(timeout, 20))
    url = endpoint_url(base_url, "/chat/completions")
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from local model server: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            "Could not reach the local model server. Start LM Studio's local server "
            "and confirm the base URL."
        ) from exc
    except TimeoutError as exc:
        raise RuntimeError("The local model server timed out before answering.") from exc
    return parse_chat_response(data)


def resolve_model_name(base_url: str, model_name: str, timeout: int = 20) -> str:
    if not is_auto_model_name(model_name):
        return model_name.strip()
    models = list_models(base_url, timeout=timeout)
    if not models:
        raise RuntimeError("LM Studio is reachable, but /v1/models returned no loaded models.")
    return models[0]


def list_models(base_url: str, timeout: int = 20) -> list[str]:
    url = endpoint_url(base_url, "/models")
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from local model server: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            "Could not reach the local model server. Start LM Studio's local server "
            "and confirm the base URL."
        ) from exc

    models = []
    for item in data.get("data", []):
        model_id = item.get("id")
        if model_id:
            models.append(str(model_id))
    return models


def wrap_for_sidebar(text: str, width: int = 42, max_lines: int = 24) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    display_text = format_chat_display_text(text)
    for raw_line in display_text.splitlines() or [""]:
        wrapped = textwrap.wrap(raw_line, width=width) or [""]
        lines.extend(wrapped)
        if len(lines) >= max_lines:
            return lines[:max_lines] + ["..."]
    return lines
