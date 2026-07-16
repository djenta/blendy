"""Blendy Blender add-on: secure read-only scene evidence bridge.

Legacy in-Blender chat code is retained only for migration-readable source history.
It is not registered; the Electron companion is the single prompt/model runtime.
"""

from __future__ import annotations

import os
import queue
import json
import hashlib
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import core

bl_info = {
    "name": "Local AI Chat",
    "author": "Blendy contributors",
    "version": (2, 1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Local AI",
    "description": "Secure live-scene bridge for the Blendy desktop tutor.",
    "category": "3D View",
}

try:
    import bpy
    from mathutils import Vector
    from bpy.props import BoolProperty, CollectionProperty, EnumProperty, IntProperty, StringProperty
    from bpy.types import Operator, Panel, PropertyGroup, UIList
except ModuleNotFoundError:  # Allows importing helper modules during normal Python tests.
    bpy = None  # type: ignore[assignment]
    Vector = None  # type: ignore[assignment]


_RESULT_QUEUE: "queue.Queue[dict[str, Any]]" = queue.Queue()
_BRIDGE_JOB_QUEUE: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=2)
_TIMER_ACTIVE = False
_BRIDGE_SERVER: ThreadingHTTPServer | None = None
_BRIDGE_THREAD: threading.Thread | None = None
_BLENDY_PROCESS: subprocess.Popen[Any] | None = None
BLENDY_BRIDGE_HOST = "127.0.0.1"
BLENDY_BRIDGE_DEFAULT_PORT = 8765
BLENDY_BRIDGE_PORT_SCAN_COUNT = 25
_BRIDGE_PORT: int | None = None
_BRIDGE_TOKEN = ""
BLENDY_BRIDGE_PROTOCOL_VERSION = 2
BLENDY_BRIDGE_TOKEN_HEADER = "X-Blendy-Token"
BLENDY_BRIDGE_MAX_REQUEST_BYTES = 64 * 1024
BLENDY_BRIDGE_MAX_PROMPT_CHARS = 8_000
BLENDY_BRIDGE_MAX_IMAGE_BYTES = 10 * 1024 * 1024
BLENDY_BRIDGE_MAX_JOBS_PER_TICK = 1
BLENDY_DESKTOP_OVERVIEW_MAX_PX = 1440
BLENDY_DESKTOP_FOCUSED_MAX_PX = 1200
BLENDY_CAPTURE_TEMP_MAX_AGE_SECONDS = 24 * 60 * 60
BLENDY_BRIDGE_ALLOWED_ORIGINS: frozenset[str] = frozenset()
BLENDY_CONTEXT_TIERS = frozenset({"compact", "focused", "expanded"})
BLENDY_CONTEXT_CHAR_CAPS = {
    "compact": 12_000,
    "focused": 30_000,
    "expanded": 60_000,
}
CHAT_TEXT_NAME = "Blender Tutor Chat"
CHAT_VIEWPORT_MIN_ROWS = 4
CHAT_VIEWPORT_MAX_ROWS = 10
CHAT_ROW_PIXEL_ESTIMATE = 24
CHAT_RESERVED_PIXEL_ESTIMATE = 285
CHAT_PAGE_STEP = 7


class _BridgeBusyError(RuntimeError):
    """Raised when Blender already has the maximum safe context work queued."""


def _header_value(headers: Any, name: str) -> str:
    """Read a request header from email.message or a plain test mapping."""

    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(name)
        if value is not None:
            return str(value).strip()
    try:
        for key, value in headers.items():
            if str(key).lower() == name.lower():
                return str(value).strip()
    except Exception:
        pass
    return ""


def _bridge_request_token(headers: Any) -> str:
    token = _header_value(headers, BLENDY_BRIDGE_TOKEN_HEADER)
    if token:
        return token
    authorization = _header_value(headers, "Authorization")
    scheme, separator, value = authorization.partition(" ")
    if separator and scheme.lower() == "bearer":
        return value.strip()
    return ""


def _bridge_token_matches(headers: Any, expected_token: str | None = None) -> bool:
    expected = expected_token if expected_token is not None else _BRIDGE_TOKEN
    supplied = _bridge_request_token(headers)
    if not expected or not supplied:
        return False
    return secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def _bridge_origin_allowed(headers: Any) -> bool:
    """Only native main-process requests, which have no browser Origin, are valid."""

    return not _header_value(headers, "Origin")


def _bounded_visual_evidence(
    evidence: list[dict[str, str]],
    max_bytes: int = BLENDY_BRIDGE_MAX_IMAGE_BYTES,
) -> tuple[list[dict[str, str]], int]:
    """Always preserve the full Blender-window overview before optional crops."""

    priorities = {"overview": 0, "active_editor": 1, "active-editor": 1}
    kept = [
        item
        for _index, item in sorted(
            enumerate(evidence),
            key=lambda pair: (priorities.get(str(pair[1].get("kind", "")), 2), pair[0]),
        )
    ]
    omitted = 0
    while kept and sum(len(str(item.get("dataUrl", "")).encode("utf-8")) for item in kept) > max_bytes:
        kept.pop()
        omitted += 1
    return kept, omitted


def _cleanup_stale_capture_files(
    temp_dir: Path | None = None,
    now: float | None = None,
) -> int:
    """Remove capture files left behind only by a crash or forced termination."""

    root = temp_dir or Path(tempfile.gettempdir())
    cutoff = (time.time() if now is None else now) - BLENDY_CAPTURE_TEMP_MAX_AGE_SECONDS
    removed = 0
    for pattern in ("local_ai_chat_*.png", "local_ai_chat_area_*.png"):
        for candidate in root.glob(pattern):
            try:
                if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                    candidate.unlink()
                    removed += 1
            except OSError:
                continue
    return removed


def _validated_bridge_content_length(raw_length: str) -> int:
    try:
        length = int(raw_length or "0")
    except (TypeError, ValueError) as exc:
        raise ValueError("Content-Length is invalid.") from exc
    if length < 0:
        raise ValueError("Content-Length is invalid.")
    if length > BLENDY_BRIDGE_MAX_REQUEST_BYTES:
        raise OverflowError("Request body is too large.")
    return length


def _bridge_context_selection(prompt: str, requested_tier: str = "") -> dict[str, Any]:
    """Choose deterministic Blender evidence without sending the whole scene every turn."""

    lower = (prompt or "").lower()
    requested = (requested_tier or "").strip().lower()
    requested = {
        "minimal": "compact",
        "standard": "focused",
        "full": "expanded",
        "auto": "",
    }.get(requested, requested)

    node_terms = (
        "node", "shader", "compositor", "geometry nodes", "socket", "principled",
        "material graph", "node tree", "link",
    )
    material_terms = (
        "material", "texture", "roughness", "metallic", "alpha", "normal map",
        "image texture", "uv",
    )
    keymap_terms = (
        "shortcut", "hotkey", "keymap", "keyboard", "press ", "key binding",
    )
    scene_terms = (
        "outliner", "all objects", "whole scene", "entire scene", "object list",
        "collection", "what objects",
    )
    expanded_terms = (
        "full context", "expanded context", "everything in the scene", "exact node links",
        "debug the whole", "inspect everything",
    )

    sections = {
        "nodes": any(term in lower for term in node_terms),
        "materials": any(term in lower for term in material_terms),
        "keymap": any(term in lower for term in keymap_terms),
        "sceneObjects": any(term in lower for term in scene_terms),
    }
    if requested in BLENDY_CONTEXT_TIERS:
        tier = requested
        reason = "requested"
    elif any(term in lower for term in expanded_terms):
        tier = "expanded"
        reason = "prompt requested broad inspection"
    elif any(sections.values()):
        tier = "focused"
        reason = "prompt requested specific Blender evidence"
    else:
        tier = "focused"
        reason = "default tutor context includes nearby scene relationships"

    if tier == "expanded":
        sections = {key: True for key in sections}
    return {
        "tier": tier,
        "reason": reason,
        "sections": sections,
    }


def _sanitize_bridge_request_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Request JSON must be an object.")
    prompt = payload.get("prompt", "")
    if not isinstance(prompt, str):
        raise ValueError("prompt must be text.")
    if len(prompt) > BLENDY_BRIDGE_MAX_PROMPT_CHARS:
        raise ValueError(f"prompt exceeds {BLENDY_BRIDGE_MAX_PROMPT_CHARS} characters.")
    screenshot = str(payload.get("screenshot", "never")).strip().lower()
    if screenshot not in {"never", "auto", "always"}:
        raise ValueError("screenshot must be never, auto, or always.")
    requested_tier = payload.get("contextTier", payload.get("contextLevel", ""))
    if requested_tier is not None and not isinstance(requested_tier, str):
        raise ValueError("contextTier must be text.")
    requested_tier_text = str(requested_tier or "").strip().lower()
    if requested_tier_text not in {
        "",
        "auto",
        "compact",
        "focused",
        "expanded",
        "minimal",
        "standard",
        "full",
    }:
        raise ValueError("contextTier must be compact, focused, expanded, or auto.")
    selection = _bridge_context_selection(prompt, requested_tier_text)
    return {
        "prompt": prompt,
        "screenshot": screenshot,
        "contextTier": selection["tier"],
        "contextSelection": selection,
    }


def _process_bridge_jobs() -> None:
    return None


def _blendy_appdata_dir() -> Path:
    root = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if root:
        return Path(root) / "Blendy"
    return Path.home() / ".blendy"


def _bridge_discovery_path() -> Path:
    return _blendy_appdata_dir() / "bridge.json"


def _active_bridge_port() -> int:
    return _BRIDGE_PORT or BLENDY_BRIDGE_DEFAULT_PORT


def _threaded_call(kind: str, scene_name: str, base_url: str, payload: dict[str, Any]) -> None:
    try:
        text = core.post_chat_completion(base_url, payload)
        _RESULT_QUEUE.put({"kind": kind, "scene": scene_name, "ok": True, "text": text})
    except Exception as exc:  # Blender UI should receive readable local-server failures.
        _RESULT_QUEUE.put({"kind": kind, "scene": scene_name, "ok": False, "text": str(exc)})


def _threaded_model_list(scene_name: str, base_url: str, current_model: str) -> None:
    try:
        models = core.list_models(base_url)
        if not models:
            text = "Connected, but /v1/models returned no loaded models."
            status = "WARN"
        elif core.is_auto_model_name(current_model):
            text = f"Connected. Auto will use the first loaded LM Studio model: {models[0]}."
            status = "OK"
        elif current_model and current_model in models:
            text = f"Connected. Model is available: {current_model}. First answer may be slow while it wakes up."
            status = "OK"
        else:
            joined = ", ".join(models[:4])
            extra = "" if len(models) <= 4 else f" (+{len(models) - 4} more)"
            text = f"Connected. Loaded model IDs: {joined}{extra}. Use auto or paste one of these IDs."
            status = "WARN"
        _RESULT_QUEUE.put(
            {
                "kind": "test",
                "scene": scene_name,
                "ok": True,
                "text": text,
                "status": status,
            }
        )
    except Exception as exc:
        _RESULT_QUEUE.put({"kind": "test", "scene": scene_name, "ok": False, "text": str(exc)})


def _redraw_view3d() -> None:
    if bpy is None:
        return
    wm = bpy.context.window_manager
    for window in wm.windows:
        screen = window.screen
        for area in screen.areas:
            if area.type in {"VIEW_3D", "TEXT_EDITOR"}:
                area.tag_redraw()


def _add_message(props: Any, role: str, text: str) -> None:
    message = props.messages.add()
    message.role = role
    if role == "assistant" and not (text or "").strip():
        message.content = (
            "The local model returned an empty visible answer. "
            "Send again, or raise Response Max in settings."
        )
    else:
        message.content = text or ""
    _scroll_chat_to_latest(props)
    _sync_chat_text(props)


def _messages_as_dicts(props: Any) -> list[dict[str, str]]:
    return [{"role": item.role, "content": item.content} for item in props.messages]


def _chat_role_label(role: str) -> str:
    return {
        "user": "You",
        "assistant": "Tutor",
        "system": "System",
    }.get(role, role.title())


def _chat_role_icon(role: str) -> str:
    return {
        "user": "USER",
        "assistant": "LIGHT",
        "system": "INFO",
    }.get(role, "TEXT")


def _rebuild_chat_lines(props: Any) -> None:
    if not hasattr(props, "chat_lines"):
        return
    while len(props.chat_lines):
        props.chat_lines.remove(0)
    for index, message in enumerate(props.messages):
        if index:
            blank = props.chat_lines.add()
            blank.name = " "
            blank.kind = "BLANK"
            blank.role = ""
            blank.text = ""
        header = props.chat_lines.add()
        header.kind = "HEADER"
        header.role = message.role
        header.text = _chat_role_label(message.role)
        header.name = f"{header.text}:"
        for line in core.wrap_for_sidebar(message.content, width=39, max_lines=1000):
            item = props.chat_lines.add()
            item.kind = "TEXT"
            item.role = message.role
            item.text = line
            item.name = f"  {line}" if line else " "
    if hasattr(props, "chat_line_index"):
        props.chat_line_index = max(0, len(props.chat_lines) - 1)
    if hasattr(props, "chat_scroll_offset"):
        props.chat_scroll_offset = len(props.chat_lines)


def _chat_display_lines(props: Any) -> list[tuple[str, str, str]]:
    lines: list[tuple[str, str, str]] = []
    for index, message in enumerate(props.messages):
        if index:
            lines.append(("BLANK", "", " "))
        label = _chat_role_label(message.role)
        lines.append(("HEADER", message.role, f"{label}:"))
        for line in core.wrap_for_sidebar(message.content, width=39, max_lines=1000):
            lines.append(("TEXT", message.role, f"  {line}" if line else " "))
    return lines


def _scroll_chat_to_latest(props: Any) -> None:
    if hasattr(props, "chat_scroll_offset"):
        props.chat_scroll_offset = len(_chat_display_lines(props))


def _chat_transcript(props: Any) -> str:
    if not props.messages:
        return "Blender Tutor Chat\n\nAsk a question in the Local AI panel to start."
    lines = ["Blender Tutor Chat", ""]
    for message in props.messages:
        label = _chat_role_label(message.role)
        content = core.format_chat_display_text(message.content)
        lines.append(f"{label}:")
        lines.append(content.strip() or "[empty]")
        lines.append("")
    if props.compacted_summary.strip():
        lines.append("Compacted Session Summary:")
        lines.append(core.format_chat_display_text(props.compacted_summary).strip())
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _sync_chat_text(props: Any) -> Any | None:
    if bpy is None:
        return None
    text = bpy.data.texts.get(CHAT_TEXT_NAME)
    if text is None:
        text = bpy.data.texts.new(CHAT_TEXT_NAME)
    text.clear()
    text.write(_chat_transcript(props))
    try:
        text.current_line_index = max(0, len(text.lines) - 1)
    except Exception:
        pass
    return text


def _assign_chat_text_to_area(area: Any, text: Any) -> None:
    area.type = "TEXT_EDITOR"
    for space in area.spaces:
        if space.type == "TEXT_EDITOR":
            space.text = text
            if hasattr(space, "show_word_wrap"):
                space.show_word_wrap = True
            if hasattr(space, "show_line_numbers"):
                space.show_line_numbers = False
            break


def _trim_messages_to_tail(props: Any, keep: int = 4) -> None:
    while len(props.messages) > keep:
        props.messages.remove(0)
    _scroll_chat_to_latest(props)
    _sync_chat_text(props)


def _poll_worker_queue() -> float | None:
    if bpy is None:
        return None
    if not _TIMER_ACTIVE:
        return None
    _process_bridge_jobs()
    while True:
        try:
            result = _RESULT_QUEUE.get_nowait()
        except queue.Empty:
            break

        scene = bpy.data.scenes.get(result.get("scene", ""))
        if not scene or not hasattr(scene, "local_ai_chat"):
            continue
        props = scene.local_ai_chat
        props.is_busy = False
        props.active_task = "NONE"

        if result["kind"] == "chat":
            if result["ok"]:
                _add_message(props, "assistant", result["text"])
                props.status_kind = "OK"
                props.status_text = "Answer received."
            else:
                _add_message(props, "system", f"Error: {result['text']}")
                props.status_kind = "ERROR"
                props.status_text = result["text"]
        elif result["kind"] == "compact":
            if result["ok"]:
                props.compacted_summary = result["text"]
                _trim_messages_to_tail(props, keep=4)
                props.status_kind = "OK"
                props.status_text = "Chat compacted into session summary."
            else:
                props.status_kind = "ERROR"
                props.status_text = f"Compaction failed: {result['text']}"
        elif result["kind"] == "test":
            props.status_kind = result.get("status", "OK") if result["ok"] else "ERROR"
            props.status_text = result["text"]

    _redraw_view3d()
    return 0.25


if bpy is not None:

    class LOCALAI_Message(PropertyGroup):
        role: StringProperty(name="Role", default="user")
        content: StringProperty(name="Content", default="", maxlen=12000)


    class LOCALAI_ChatLine(PropertyGroup):
        name: StringProperty(name="Line", default="", maxlen=1000)
        text: StringProperty(name="Text", default="", maxlen=1000)
        role: StringProperty(name="Role", default="", maxlen=32)
        kind: StringProperty(name="Kind", default="TEXT", maxlen=16)


    class LOCALAI_UL_ChatLines(UIList):
        bl_idname = "LOCALAI_UL_chat_lines"

        def draw_item(
            self,
            context: Any,
            layout: Any,
            data: Any,
            item: Any,
            icon: int,
            active_data: Any,
            active_propname: str,
            index: int = 0,
            flt_flag: int = 0,
        ) -> None:
            if item.kind == "BLANK":
                layout.label(text="")
            elif item.kind == "HEADER":
                layout.label(text=item.text, icon=_chat_role_icon(item.role))
            else:
                layout.label(text=item.text)


    class LOCALAI_Properties(PropertyGroup):
        backend_base_url: StringProperty(
            name="Base URL",
            default=core.DEFAULT_BACKEND_BASE_URL,
            description="LM Studio local server endpoint",
        )
        model_name: StringProperty(
            name="Model",
            default=core.DEFAULT_MODEL_NAME,
            description="Use auto for the first loaded LM Studio model, or paste a loaded model ID",
        )
        prompt: StringProperty(
            name="Prompt",
            default="",
            maxlen=8000,
            description="Ask the local Blender tutor what to explain next",
        )
        include_screenshot: BoolProperty(
            name="Visual",
            default=True,
            description="Allow Blender screen screenshots to be sent with prompts",
        )
        context_mode: EnumProperty(
            name="Context Mode",
            default=core.CONTEXT_MODE_AUTO,
            description="Choose when the tutor should receive a Blender screen image",
            items=[
                (core.CONTEXT_MODE_AUTO, "Auto", "Use scene data and add a Blender screen image with every prompt"),
                (core.CONTEXT_MODE_SCENE, "Scene Data Only", "Never attach a screenshot"),
                (core.CONTEXT_MODE_VIEWPORT, "Blender Screen", "Attach a Blender screen screenshot whenever Visual is enabled"),
            ],
        )
        include_runtime_facts: BoolProperty(
            name="Runtime facts",
            default=True,
            description="Attach compact Blender version/tool/keymap facts to reduce stale model advice",
        )
        include_tool_refs: BoolProperty(
            name="Tool refs",
            default=True,
            description="Attach small targeted Blender tool reference cards",
        )
        knowledge_mode: EnumProperty(
            name="Knowledge Mode",
            default=core.DEFAULT_KNOWLEDGE_MODE,
            description="Choose how Blendy grounds Blender knowledge beyond the live scene",
            items=[
                (
                    core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
                    "Local + Auto Web",
                    "Use local official docs first, then short vetted web lookups when useful",
                ),
                (
                    core.KNOWLEDGE_MODE_LOCAL_ONLY,
                    "Local Only",
                    "Use local official docs and do not search online",
                ),
                (
                    core.KNOWLEDGE_MODE_ASK_BEFORE_WEB,
                    "Ask Before Web",
                    "Use local docs, then ask before any online lookup",
                ),
            ],
        )
        screenshot_max_px: IntProperty(
            name="Image Max",
            default=BLENDY_DESKTOP_OVERVIEW_MAX_PX,
            min=256,
            soft_min=512,
            soft_max=2048,
            description="Maximum screenshot width or height before it is sent to the local model",
        )
        context_limit_tokens: IntProperty(
            name="Context Limit",
            default=core.DEFAULT_CONTEXT_LIMIT_TOKENS,
            min=1000,
            soft_min=8000,
            soft_max=200000,
            description="Approximate text context budget for the loaded local model",
        )
        response_max_tokens: IntProperty(
            name="Response Max",
            default=core.DEFAULT_RESPONSE_MAX_TOKENS,
            min=256,
            soft_min=1200,
            soft_max=16000,
            description="Maximum generated tokens for one tutor answer",
        )
        messages: CollectionProperty(type=LOCALAI_Message)
        chat_lines: CollectionProperty(type=LOCALAI_ChatLine)
        chat_line_index: IntProperty(name="Chat Line", default=0, min=0)
        chat_scroll_offset: IntProperty(name="Chat Offset", default=0, min=0)
        compacted_summary: StringProperty(name="Compacted Summary", default="", maxlen=20000)
        last_scene_snapshot: StringProperty(name="Last Scene Snapshot", default="", maxlen=100000)
        status_text: StringProperty(name="Status", default="Ready.")
        status_kind: EnumProperty(
            name="Status Kind",
            default="IDLE",
            items=[
                ("IDLE", "Idle", ""),
                ("BUSY", "Busy", ""),
                ("OK", "OK", ""),
                ("WARN", "Warning", ""),
                ("ERROR", "Error", ""),
            ],
        )
        is_busy: BoolProperty(name="Busy", default=False)
        active_task: EnumProperty(
            name="Active Task",
            default="NONE",
            items=[
                ("NONE", "None", ""),
                ("CHAT", "Chat", ""),
                ("COMPACT", "Compact", ""),
                ("TEST", "Test", ""),
            ],
        )


    def _truth_path_for_current_file() -> Path | None:
        return core.truth_file_path(bpy.data.filepath)


    def _status_icon(kind: str) -> str:
        return {
            "IDLE": "INFO",
            "BUSY": "TIME",
            "OK": "CHECKMARK",
            "WARN": "ERROR",
            "ERROR": "CANCEL",
        }.get(kind, "INFO")


    def _safe_float_tuple(value: Any, digits: int = 3) -> tuple[float, ...]:
        return tuple(round(float(part), digits) for part in value)


    def _world_bounding_box(obj: Any) -> list[tuple[float, ...]]:
        return [_safe_float_tuple(obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]


    def _selected_mesh_counts(obj: Any) -> str:
        if obj.type != "MESH" or not obj.data:
            return "Selected mesh components: unavailable"
        try:
            if obj.mode == "EDIT":
                obj.update_from_editmode()
        except Exception:
            pass
        mesh = obj.data
        selected_vertices = sum(1 for vertex in mesh.vertices if vertex.select)
        selected_edges = sum(1 for edge in mesh.edges if edge.select)
        selected_faces = sum(1 for face in mesh.polygons if face.select)
        return (
            "Selected mesh components: "
            f"vertices={selected_vertices}, edges={selected_edges}, faces={selected_faces}"
        )


    def _evaluated_mesh_counts(obj: Any, context: Any) -> str:
        if obj.type != "MESH":
            return "Evaluated mesh: unavailable"
        try:
            depsgraph = context.evaluated_depsgraph_get()
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                return (
                    "Evaluated mesh after visible modifiers: "
                    f"vertices={len(mesh.vertices)}, edges={len(mesh.edges)}, faces={len(mesh.polygons)}"
                )
            finally:
                evaluated.to_mesh_clear()
        except Exception as exc:
            return f"Evaluated mesh: unavailable ({exc})"


    def _material_summary(obj: Any) -> list[str]:
        if not obj.material_slots:
            return ["Material slots: none"]
        lines = ["Material slots:"]
        for index, slot in enumerate(obj.material_slots):
            material = slot.material
            if not material:
                lines.append(f"- {index}: empty")
                continue
            lines.append(f"- {index}: {material.name}")
        return lines


    def _modifier_summary(modifier: Any) -> str:
        fields = []
        for name in (
            "operation",
            "levels",
            "render_levels",
            "width",
            "thickness",
            "strength",
            "factor",
            "offset",
            "count",
            "segments",
            "fit_type",
            "deform_axis",
            "wrap_method",
            "use_axis_x",
            "use_axis_y",
            "use_axis_z",
        ):
            if hasattr(modifier, name):
                value = getattr(modifier, name)
                if isinstance(value, (int, float, bool, str)):
                    fields.append(f"{name}={value}")
        for name in (
            "object",
            "mirror_object",
            "offset_object",
            "curve",
            "target",
            "origin",
            "start_cap",
            "end_cap",
            "auxiliary_target",
            "texture_coords_object",
        ):
            target = getattr(modifier, name, None)
            target_name = getattr(target, "name", "") if target is not None else ""
            if target_name:
                fields.append(f"{name}={target_name}")
        field_text = ", ".join(fields)
        suffix = f" ({field_text})" if field_text else ""
        visible = "on" if modifier.show_viewport else "off"
        return f"- {modifier.name}: {modifier.type}, viewport={visible}{suffix}"


    def _format_node_value(value: Any, digits: int = 3) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, int):
            return str(value)
        if isinstance(value, float):
            return f"{value:.{digits}g}"
        if isinstance(value, str):
            return value
        try:
            if hasattr(value, "__len__") and not isinstance(value, (bytes, bytearray)):
                parts = list(value)
                if 0 < len(parts) <= 4 and all(isinstance(part, (int, float, bool)) for part in parts):
                    return "(" + ", ".join(_format_node_value(part, digits) for part in parts) + ")"
        except Exception:
            return ""
        return ""


    def _node_socket_name(socket: Any) -> str:
        return getattr(socket, "name", "") or getattr(socket, "identifier", "") or "socket"


    def _node_input_defaults(node: Any, limit: int = 8) -> list[str]:
        defaults: list[str] = []
        try:
            sockets = list(getattr(node, "inputs", []))
        except Exception:
            return defaults
        for socket in sockets[:limit]:
            if getattr(socket, "is_linked", False):
                continue
            if not hasattr(socket, "default_value"):
                continue
            try:
                formatted = _format_node_value(socket.default_value)
            except Exception:
                formatted = ""
            if formatted:
                defaults.append(f"{_node_socket_name(socket)}={formatted}")
        return defaults


    def _node_property_values(node: Any, limit: int = 12) -> list[str]:
        skip = {
            "rna_type",
            "type",
            "name",
            "label",
            "location",
            "width",
            "height",
            "dimensions",
            "inputs",
            "outputs",
            "internal_links",
            "parent",
            "select",
            "show_options",
            "show_preview",
            "show_texture",
            "use_custom_color",
            "color",
        }
        values: list[str] = []
        try:
            properties = node.bl_rna.properties
        except Exception:
            return values
        for prop in properties:
            identifier = getattr(prop, "identifier", "")
            if not identifier or identifier in skip or identifier.startswith("bl_"):
                continue
            prop_type = getattr(prop, "type", "")
            is_array = bool(getattr(prop, "is_array", False))
            if prop_type not in {"BOOLEAN", "INT", "FLOAT", "ENUM", "STRING"} and not is_array:
                continue
            try:
                formatted = _format_node_value(getattr(node, identifier))
            except Exception:
                continue
            if not formatted:
                continue
            values.append(f"{identifier}={formatted}")
            if len(values) >= limit:
                break
        return values


    def _node_summary_line(node: Any) -> str:
        title = getattr(node, "name", "") or "Node"
        label = getattr(node, "label", "") or ""
        bl_label = getattr(node, "bl_label", "") or ""
        bl_idname = getattr(node, "bl_idname", "") or getattr(node, "type", "")
        pieces = [f"- {title}"]
        if label and label != title:
            pieces.append(f"label={label}")
        if bl_label or bl_idname:
            type_text = bl_label if bl_label else bl_idname
            if bl_idname and bl_idname != type_text:
                type_text = f"{type_text} ({bl_idname})"
            pieces.append(f"type={type_text}")
        if getattr(node, "mute", False):
            pieces.append("muted=true")
        prop_values = _node_property_values(node)
        if prop_values:
            pieces.append("settings: " + ", ".join(prop_values))
        input_defaults = _node_input_defaults(node)
        if input_defaults:
            pieces.append("unlinked inputs: " + ", ".join(input_defaults))
        return "; ".join(pieces)


    def _node_link_summary(node_tree: Any, limit: int = 24) -> list[str]:
        lines: list[str] = []
        try:
            links = list(getattr(node_tree, "links", []))
        except Exception:
            return lines
        for link in links[:limit]:
            if hasattr(link, "is_valid") and not link.is_valid:
                continue
            try:
                from_node = getattr(link.from_node, "name", "node")
                from_socket = _node_socket_name(link.from_socket)
                to_node = getattr(link.to_node, "name", "node")
                to_socket = _node_socket_name(link.to_socket)
            except Exception:
                continue
            lines.append(f"- {from_node}.{from_socket} -> {to_node}.{to_socket}")
        return lines


    def _node_tree_summary(
        title: str,
        node_tree: Any,
        node_limit: int = 24,
        link_limit: int = 24,
    ) -> list[str]:
        if not node_tree:
            return []
        try:
            nodes = list(node_tree.nodes)
        except Exception:
            return []
        lines = [f"{title}: {getattr(node_tree, 'name', 'unnamed node tree')}"]
        active = getattr(getattr(node_tree, "nodes", None), "active", None)
        if active:
            lines.append(f"Active node: {getattr(active, 'name', 'unknown')}")
        if not nodes:
            lines.append("- No nodes in this tree.")
            return lines
        lines.append("Nodes:")
        for node in nodes[:node_limit]:
            lines.append(_node_summary_line(node))
        if len(nodes) > node_limit:
            lines.append(f"... {len(nodes) - node_limit} more nodes not listed")
        links = _node_link_summary(node_tree, limit=link_limit)
        if links:
            lines.append("Links:")
            lines.extend(links)
        return lines


    def _visible_editor_context(context: Any) -> list[str]:
        lines: list[str] = []
        try:
            screen = context.window.screen
        except Exception:
            return lines
        for area in getattr(screen, "areas", []):
            area_type = getattr(area, "type", "UNKNOWN")
            detail = ""
            space = getattr(area, "spaces", None).active if getattr(area, "spaces", None) else None
            if space and area_type == "NODE_EDITOR":
                tree_type = getattr(space, "tree_type", "") or "unknown"
                node_tree = getattr(space, "edit_tree", None) or getattr(space, "node_tree", None)
                tree_name = getattr(node_tree, "name", "") if node_tree else ""
                detail = f" tree_type={tree_type}" + (f", tree={tree_name}" if tree_name else "")
            elif space and area_type == "PROPERTIES":
                detail = f" context={getattr(space, 'context', 'unknown')}"
            elif space and area_type == "VIEW_3D":
                detail = f" shading={getattr(getattr(space, 'shading', None), 'type', 'unknown')}"
            lines.append(f"- {area_type}{detail}")
        return lines


    def _render_settings_context(scene: Any) -> list[str]:
        lines = [
            "Render and display settings:",
            f"- render engine={getattr(scene.render, 'engine', 'unknown')}",
        ]
        try:
            lines.append(f"- compositor use_nodes={bool(scene.use_nodes)}")
        except Exception:
            pass
        view_settings = getattr(scene, "view_settings", None)
        if view_settings:
            bits = []
            for name in ("view_transform", "look", "exposure", "gamma"):
                if hasattr(view_settings, name):
                    bits.append(f"{name}={getattr(view_settings, name)}")
            if bits:
                lines.append("- color management: " + ", ".join(bits))
        return lines


    def _node_context_summary(
        context: Any,
        node_limit: int = 24,
        link_limit: int = 24,
        material_limit: int = 6,
    ) -> list[str]:
        lines = ["Node/editor context:"]
        visible = _visible_editor_context(context)
        if visible:
            lines.append("Visible Blender editors:")
            lines.extend(visible)
        lines.extend(_render_settings_context(context.scene))

        summaries: list[list[str]] = []
        seen: set[int] = set()

        def add_tree(title: str, node_tree: Any) -> None:
            if not node_tree:
                return
            key = id(node_tree)
            if key in seen:
                return
            seen.add(key)
            summary = _node_tree_summary(
                title,
                node_tree,
                node_limit=node_limit,
                link_limit=link_limit,
            )
            if summary:
                summaries.append(summary)

        try:
            screen = context.window.screen
            for area in getattr(screen, "areas", []):
                if getattr(area, "type", "") != "NODE_EDITOR":
                    continue
                space = getattr(area, "spaces", None).active if getattr(area, "spaces", None) else None
                if not space:
                    continue
                add_tree(
                    f"Visible node editor ({getattr(space, 'tree_type', 'unknown')})",
                    getattr(space, "edit_tree", None) or getattr(space, "node_tree", None),
                )
        except Exception:
            pass

        if getattr(context.scene, "use_nodes", False):
            add_tree("Scene compositor node tree", getattr(context.scene, "node_tree", None))

        active = context.active_object
        if active:
            for modifier in getattr(active, "modifiers", []):
                node_group = getattr(modifier, "node_group", None)
                if node_group:
                    add_tree(f"Geometry node tree from modifier {modifier.name}", node_group)
            try:
                material_slots = list(getattr(active, "material_slots", []))
            except Exception:
                material_slots = []
            for slot in material_slots[:material_limit]:
                material = getattr(slot, "material", None)
                if material and getattr(material, "use_nodes", False):
                    add_tree(f"Material node tree {material.name}", getattr(material, "node_tree", None))

        if not summaries:
            lines.append("- No compositor, material, geometry, or visible node editor tree was available in this context.")
            return lines
        for summary in summaries:
            lines.append("")
            lines.extend(summary)
        return lines


    def _material_node_context(
        context: Any,
        node_limit: int = 10,
        link_limit: int = 10,
        material_limit: int = 3,
    ) -> list[str]:
        active = context.active_object
        lines = ["Active material evidence:"]
        if active is None:
            return lines + ["- No active object."]
        slots = list(getattr(active, "material_slots", []))[:material_limit]
        found = False
        for slot in slots:
            material = getattr(slot, "material", None)
            if not material:
                continue
            found = True
            lines.append(f"- Material: {material.name}; use_nodes={bool(getattr(material, 'use_nodes', False))}")
            if getattr(material, "use_nodes", False):
                lines.extend(
                    _node_tree_summary(
                        f"Material node tree {material.name}",
                        getattr(material, "node_tree", None),
                        node_limit=node_limit,
                        link_limit=link_limit,
                    )
                )
        if not found:
            lines.append("- Active object has no assigned material.")
        return lines


    def _object_summary(obj: Any, selected: bool = False) -> str:
        marker = "*" if selected else "-"
        material_names = [slot.material.name for slot in obj.material_slots if slot.material]
        materials = ", ".join(material_names) if material_names else "none"
        return (
            f"{marker} {obj.name}: type={obj.type}, visible={obj.visible_get()}, "
            f"materials={materials}, modifiers={len(obj.modifiers)}"
        )


    def _mesh_count_dict(obj: Any) -> dict[str, int] | None:
        if obj.type != "MESH" or not obj.data:
            return None
        mesh = obj.data
        return {
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "faces": len(mesh.polygons),
        }


    def _snapshot_object(obj: Any) -> dict[str, Any]:
        all_material_names = [slot.material.name for slot in obj.material_slots if slot.material]
        modifiers = list(obj.modifiers)
        data: dict[str, Any] = {
            "type": obj.type,
            "visible": bool(obj.visible_get()),
            "location": list(_safe_float_tuple(obj.location)),
            "rotation": list(_safe_float_tuple(obj.rotation_euler)),
            "scale": list(_safe_float_tuple(obj.scale)),
            "dimensions": list(_safe_float_tuple(obj.dimensions)),
            "materials": all_material_names[:16],
            "modifiers": [
                {
                    "name": modifier.name,
                    "type": modifier.type,
                    "show_viewport": bool(modifier.show_viewport),
                }
                for modifier in modifiers[:24]
            ],
        }
        if len(all_material_names) > 16:
            data["materials_truncated_after"] = 16
        if len(modifiers) > 24:
            data["modifiers_truncated_after"] = 24
        mesh_counts = _mesh_count_dict(obj)
        if mesh_counts:
            data["mesh"] = mesh_counts
        return data


    def _build_scene_snapshot(context: Any, object_limit: int = 160) -> dict[str, Any]:
        scene = context.scene
        objects = list(scene.objects)
        counts: dict[str, int] = {}
        for obj in objects:
            counts[obj.type] = counts.get(obj.type, 0) + 1
        active = context.active_object
        snapshot = {
            "scene": scene.name,
            "frame": scene.frame_current,
            "active_object": {
                "name": active.name if active else "",
                "type": active.type if active else "",
                "mode": active.mode if active else "",
            },
            "selected_objects": [obj.name for obj in context.selected_objects],
            "object_counts": counts,
            "objects": {
                obj.name: _snapshot_object(obj)
                for obj in sorted(objects, key=lambda item: item.name)[:object_limit]
            },
        }
        if len(objects) > object_limit:
            snapshot["objects_truncated_after"] = object_limit
        return snapshot


    def _keymap_item_summary(item: Any) -> str | None:
        if not getattr(item, "active", False):
            return None
        parts = []
        if getattr(item, "ctrl", False):
            parts.append("Ctrl")
        if getattr(item, "shift", False):
            parts.append("Shift")
        if getattr(item, "alt", False):
            parts.append("Alt")
        if getattr(item, "oskey", False):
            parts.append("OS")
        key_type = getattr(item, "type", "")
        if not key_type or key_type in {"NONE", "TIMER"}:
            return None
        parts.append(key_type)
        value = getattr(item, "value", "")
        chord = "+".join(parts)
        if value and value not in {"PRESS", "ANY"}:
            chord = f"{chord} {value}"
        idname = getattr(item, "idname", "")
        name = getattr(item, "name", "")
        if not idname:
            return None
        label = name or idname
        return f"- {chord}: {label} ({idname})"


    def _keymap_names_for_mode(mode: str) -> list[str]:
        names = ["3D View"]
        if mode == "OBJECT":
            names.append("Object Mode")
        elif mode.startswith("EDIT_MESH"):
            names.extend(["Mesh", "Object Mode"])
        elif mode.startswith("SCULPT"):
            names.append("Sculpt")
        elif mode.startswith("PAINT"):
            names.append("Image Paint")
        return names


    def _active_keymap_summary(context: Any, limit: int = 18) -> list[str]:
        wm = context.window_manager
        keyconfig = getattr(wm.keyconfigs, "active", None)
        if not keyconfig:
            return ["Active keymap: unavailable"]
        lines = [f"Active keyconfig: {keyconfig.name}"]
        seen: set[str] = set()
        for keymap_name in _keymap_names_for_mode(context.mode):
            keymap = keyconfig.keymaps.get(keymap_name)
            if not keymap:
                continue
            lines.append(f"Keymap sample: {keymap.name}")
            for item in keymap.keymap_items:
                summary = _keymap_item_summary(item)
                if not summary or summary in seen:
                    continue
                seen.add(summary)
                lines.append(summary)
                if len(seen) >= limit:
                    return lines
        if not seen:
            lines.append("No active shortcut sample found for this mode.")
        return lines


    def _active_tool_summary(context: Any) -> str:
        try:
            tool = context.workspace.tools.from_space_view3d_mode(context.mode, create=False)
        except Exception:
            tool = None
        if not tool:
            return "Active tool: unavailable"
        idname = getattr(tool, "idname", "") or "unknown"
        label = getattr(tool, "label", "") or ""
        return f"Active tool: {idname}" + (f" ({label})" if label else "")


    def _build_runtime_facts(context: Any) -> str:
        active = context.active_object
        lines = [
            "These facts came from the live Blender runtime. Prefer them over model memory.",
            f"Blender version: {bpy.app.version_string}",
            f"Blender Python API version: {'.'.join(str(part) for part in bpy.app.version)}",
            f"Current mode: {context.mode}",
            f"Workspace: {context.workspace.name if context.workspace else 'unknown'}",
            f"Scene: {context.scene.name}",
            _active_tool_summary(context),
            f"Active object type: {active.type if active else 'none'}",
            "Relevant operator namespaces likely available: bpy.ops.wm, screen, view3d, object, transform"
            + (", mesh" if context.mode.startswith("EDIT") or (active and active.type == "MESH") else ""),
        ]
        lines.extend(_active_keymap_summary(context))
        return "\n".join(lines)


    def _active_object_context(obj: Any, context: Any) -> list[str]:
        lines = [
            f"Active object: {obj.name}",
            f"Type: {obj.type}",
            f"Mode: {obj.mode}",
            f"Location: {_safe_float_tuple(obj.location)}",
            f"Rotation Euler: {_safe_float_tuple(obj.rotation_euler)}",
            f"Scale: {_safe_float_tuple(obj.scale)}",
            f"Dimensions: {_safe_float_tuple(obj.dimensions)}",
            f"World bounding box corners: {_world_bounding_box(obj)}",
        ]
        if obj.type == "MESH" and obj.data:
            mesh = obj.data
            lines.extend(
                [
                    f"Mesh vertices: {len(mesh.vertices)}",
                    f"Mesh edges: {len(mesh.edges)}",
                    f"Mesh faces: {len(mesh.polygons)}",
                    _selected_mesh_counts(obj),
                    _evaluated_mesh_counts(obj, context),
                ]
            )
        lines.extend(_material_summary(obj))
        if obj.modifiers:
            lines.append("Modifier stack:")
            lines.extend(_modifier_summary(modifier) for modifier in obj.modifiers)
        else:
            lines.append("Modifier stack: none")
        return lines


    def _build_scene_context(context: Any, object_limit: int = 120) -> str:
        scene = context.scene
        objects = list(scene.objects)
        selected = set(context.selected_objects)
        counts: dict[str, int] = {}
        for obj in objects:
            counts[obj.type] = counts.get(obj.type, 0) + 1
        lines = [
            f"Scene: {scene.name}",
            f"Frame: {scene.frame_current}",
            "Object counts: "
            + (", ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "none"),
            f"Selected objects: {', '.join(obj.name for obj in context.selected_objects) or 'none'}",
        ]
        if context.active_object:
            lines.append("")
            lines.extend(_active_object_context(context.active_object, context))
        lines.append("")
        lines.extend(_node_context_summary(context))
        lines.append("")
        lines.append(f"Scene object list (first {object_limit}):")
        for obj in objects[:object_limit]:
            lines.append(_object_summary(obj, selected=obj in selected))
        if len(objects) > object_limit:
            lines.append(f"... {len(objects) - object_limit} more objects not listed")
        return "\n".join(lines)


    def _bridge_cap_text(text: str, tier: str, section: str) -> str:
        limit = BLENDY_CONTEXT_CHAR_CAPS.get(tier, BLENDY_CONTEXT_CHAR_CAPS["compact"])
        if len(text) <= limit:
            return text
        marker = f"\n... [{section} deterministically capped at {limit:,} characters]"
        return text[: max(0, limit - len(marker))].rstrip() + marker


    def _authoritative_ui_state(context: Any) -> dict[str, Any]:
        tool_settings = context.scene.tool_settings
        mesh_select_flags = tuple(getattr(tool_settings, "mesh_select_mode", (False, False, False)))
        mesh_select_mode = [
            label
            for label, enabled in zip(("VERTEX", "EDGE", "FACE"), mesh_select_flags)
            if enabled
        ]
        snap_elements = sorted(str(item) for item in getattr(tool_settings, "snap_elements", set()))
        orientation = "Unknown"
        try:
            orientation = str(context.scene.transform_orientation_slots[0].type)
        except Exception:
            pass
        viewport_state = {
            "shading": "Unknown",
            "overlays": None,
            "xray": None,
            "localView": None,
        }
        candidates = []
        for window in _ordered_blender_windows(context):
            for area in getattr(window.screen, "areas", []):
                if getattr(area, "type", "") == "VIEW_3D":
                    candidates.append((int(area.width) * int(area.height), area))
        if candidates:
            _size, area = max(candidates, key=lambda item: item[0])
            space = getattr(getattr(area, "spaces", None), "active", None)
            overlay = getattr(space, "overlay", None)
            shading = getattr(space, "shading", None)
            viewport_state = {
                "shading": str(getattr(shading, "type", "Unknown")),
                "overlays": getattr(overlay, "show_overlays", None),
                "xray": getattr(shading, "show_xray", None),
                "localView": bool(getattr(space, "local_view", None)),
            }
        return {
            "mode": context.mode,
            "workspace": context.workspace.name if context.workspace else "Unknown",
            "activeObject": context.active_object.name if context.active_object else "",
            "activeObjectType": context.active_object.type if context.active_object else "",
            "selectedObjects": [obj.name for obj in context.selected_objects][:24],
            "activeTool": _active_tool_summary(context),
            "meshSelectionMode": mesh_select_mode,
            "snapEnabled": bool(getattr(tool_settings, "use_snap", False)),
            "snapElements": snap_elements,
            "proportionalEditing": bool(
                getattr(tool_settings, "use_proportional_edit", False)
                or getattr(tool_settings, "use_proportional_edit_objects", False)
            ),
            "pivotPoint": str(getattr(tool_settings, "transform_pivot_point", "Unknown")),
            "transformOrientation": orientation,
            "viewport": viewport_state,
            "frame": context.scene.frame_current,
            "blenderVersion": bpy.app.version_string,
        }


    def _build_bridge_runtime_facts(context: Any, selection: dict[str, Any]) -> str:
        active = context.active_object
        state = _authoritative_ui_state(context)
        lines = [
            "Authoritative Blender runtime state (read-only; exact state beats screenshot inference):",
            f"Blender version: {bpy.app.version_string}",
            f"Blender Python API version: {'.'.join(str(part) for part in bpy.app.version)}",
            f"Current mode: {state['mode']}",
            f"Workspace: {state['workspace']}",
            f"Scene: {context.scene.name}",
            state["activeTool"],
            f"Active object type: {active.type if active else 'none'}",
            "Mesh selection mode: " + (", ".join(state["meshSelectionMode"]) or "not applicable"),
            f"Snapping: {'on' if state['snapEnabled'] else 'off'}; elements={', '.join(state['snapElements']) or 'none'}",
            f"Proportional editing: {'on' if state['proportionalEditing'] else 'off'}",
            f"Pivot point: {state['pivotPoint']}",
            f"Transform orientation: {state['transformOrientation']}",
            (
                "Largest 3D View: "
                f"shading={state['viewport']['shading']}, "
                f"overlays={state['viewport']['overlays']}, "
                f"xray={state['viewport']['xray']}, "
                f"local_view={state['viewport']['localView']}"
            ),
        ]
        if selection["sections"].get("keymap"):
            keymap_limit = 18 if selection["tier"] == "expanded" else 10
            lines.extend(_active_keymap_summary(context, limit=keymap_limit))
        else:
            lines.append("Keymap detail omitted because this prompt did not ask about shortcuts.")
        return _bridge_cap_text("\n".join(lines), selection["tier"], "runtime facts")


    def _build_bridge_scene_context(context: Any, selection: dict[str, Any]) -> str:
        tier = selection["tier"]
        sections = selection["sections"]
        scene = context.scene
        objects = sorted(list(scene.objects), key=lambda item: item.name.casefold())
        counts: dict[str, int] = {}
        for obj in objects:
            counts[obj.type] = counts.get(obj.type, 0) + 1
        selected_names = sorted(obj.name for obj in context.selected_objects)
        lines = [
            "Compact live scene facts:",
            f"Scene: {scene.name}",
            f"Frame: {scene.frame_current}",
            "Object counts: "
            + (", ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "none"),
            "Selected objects: " + (", ".join(selected_names[:12]) or "none"),
        ]
        if len(selected_names) > 12:
            lines.append(f"... {len(selected_names) - 12} more selected object names omitted")

        active = context.active_object
        if active is None:
            lines.append("Active object: none")
        else:
            lines.extend(
                [
                    "",
                    f"Active object: {active.name}",
                    f"Type: {active.type}",
                    f"Mode: {active.mode}",
                    f"Location: {_safe_float_tuple(active.location)}",
                    f"Rotation Euler: {_safe_float_tuple(active.rotation_euler)}",
                    f"Scale: {_safe_float_tuple(active.scale)}",
                    f"Dimensions: {_safe_float_tuple(active.dimensions)}",
                ]
            )
            if active.parent is not None:
                lines.append(f"Parent: {active.parent.name} ({active.parent.type})")
            constraints = list(getattr(active, "constraints", []))
            if constraints:
                lines.append("Constraints:")
                for constraint in constraints[:10]:
                    target = getattr(constraint, "target", None)
                    target_text = f", target={target.name}" if target is not None else ""
                    lines.append(
                        f"- {constraint.name}: {constraint.type}, influence={getattr(constraint, 'influence', 1.0)}{target_text}"
                    )
            if active.type == "MESH" and active.data:
                mesh = active.data
                lines.extend(
                    [
                        f"Mesh vertices: {len(mesh.vertices)}",
                        f"Mesh edges: {len(mesh.edges)}",
                        f"Mesh faces: {len(mesh.polygons)}",
                        _selected_mesh_counts(active),
                    ]
                )
                if tier in {"focused", "expanded"}:
                    lines.append(_evaluated_mesh_counts(active, context))
            lines.extend(_material_summary(active)[:10])
            modifiers = list(getattr(active, "modifiers", []))
            lines.append("Modifier stack:")
            if modifiers:
                lines.extend(_modifier_summary(modifier) for modifier in modifiers[:12])
                if len(modifiers) > 12:
                    lines.append(f"... {len(modifiers) - 12} more modifiers omitted")
            else:
                lines.append("- none")
            if tier == "expanded":
                lines.append(f"World bounding box corners: {_world_bounding_box(active)}")

        visible_objects = []
        for obj in objects:
            try:
                if obj.visible_get():
                    visible_objects.append(obj)
            except Exception:
                continue
        if active is not None:
            try:
                active_position = active.matrix_world.translation
                nearby = sorted(
                    (obj for obj in visible_objects if obj is not active),
                    key=lambda obj: float((obj.matrix_world.translation - active_position).length),
                )
            except Exception:
                nearby = [obj for obj in visible_objects if obj is not active]
            nearby_limit = 8 if tier == "compact" else 14 if tier == "focused" else 24
            lines.extend(["", f"Nearby visible objects (closest {nearby_limit}):"])
            if nearby:
                for obj in nearby[:nearby_limit]:
                    try:
                        distance = float((obj.matrix_world.translation - active.matrix_world.translation).length)
                        distance_text = f"{distance:.4g}"
                    except Exception:
                        distance_text = "unknown"
                    selected_marker = "selected" if obj in context.selected_objects else "not selected"
                    parent_text = f", parent={obj.parent.name}" if obj.parent is not None else ""
                    lines.append(
                        f"- {obj.name}: type={obj.type}, distance={distance_text}, "
                        f"dimensions={_safe_float_tuple(obj.dimensions)}, {selected_marker}{parent_text}"
                    )
            else:
                lines.append("- none")
        elif visible_objects:
            anchor_limit = 8 if tier == "compact" else 14
            anchors = sorted(
                visible_objects,
                key=lambda obj: float(abs(obj.dimensions.x * obj.dimensions.y * obj.dimensions.z)),
                reverse=True,
            )
            lines.extend(["", f"Visible scene anchors (largest {anchor_limit}):"])
            for obj in anchors[:anchor_limit]:
                lines.append(
                    f"- {obj.name}: type={obj.type}, dimensions={_safe_float_tuple(obj.dimensions)}"
                )

        visible = _visible_editor_context(context)
        if visible:
            lines.extend(["", "Visible Blender editors:", *visible[:16]])

        if sections.get("nodes"):
            node_limit = 24 if tier == "expanded" else 10
            link_limit = 24 if tier == "expanded" else 10
            lines.extend(["", *_node_context_summary(context, node_limit=node_limit, link_limit=link_limit)])
        elif sections.get("materials"):
            node_limit = 16 if tier == "expanded" else 8
            lines.extend(
                [
                    "",
                    *_material_node_context(
                        context,
                        node_limit=node_limit,
                        link_limit=node_limit,
                        material_limit=6 if tier == "expanded" else 3,
                    ),
                ]
            )
        else:
            lines.append("Node/material graph detail omitted because this prompt did not ask for it.")

        if sections.get("sceneObjects"):
            object_limit = 100 if tier == "expanded" else 40
            lines.extend(["", f"Scene object list (first {object_limit}):"])
            selected = set(context.selected_objects)
            lines.extend(_object_summary(obj, selected=obj in selected) for obj in objects[:object_limit])
            if len(objects) > object_limit:
                lines.append(f"... {len(objects) - object_limit} more objects omitted")
        else:
            lines.append("Full object list omitted; compact object counts are above.")
        return _bridge_cap_text("\n".join(lines), tier, "scene facts")


    def _bridge_project_payload(context: Any) -> dict[str, Any]:
        raw_path = str(getattr(bpy.data, "filepath", "") or "")
        if raw_path:
            resolved = str(Path(raw_path).expanduser().resolve(strict=False))
            normalized = os.path.normcase(os.path.normpath(resolved))
            identity = "blend:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]
            return {
                "name": Path(resolved).name,
                "path": resolved,
                "identity": identity,
                "saved": True,
            }
        scene_name = str(getattr(context.scene, "name", "Scene") or "Scene")
        return {
            "name": "Unsaved Blender Project",
            "path": "",
            "identity": f"unsaved:{os.getpid()}:{scene_name}",
            "saved": False,
        }


    def _build_bridge_context_text(
        runtime_facts: str,
        scene_context: str,
        scene_diff: str,
        visual_context: str,
        tier: str,
    ) -> str:
        text = "\n\n".join(
            [
                "[LIVE BLENDER RUNTIME]\n" + runtime_facts,
                "[LIVE BLENDER SCENE]\n" + scene_context,
                "[CHANGES SINCE PREVIOUS CAPTURE]\n" + scene_diff,
                "[VISUAL EVIDENCE]\n" + visual_context,
            ]
        )
        return _bridge_cap_text(text, tier, "combined context")


    def _context_parts_for_prompt(
        context: Any,
        props: Any,
        truth_path: Path | None,
        prompt: str,
        knowledge_mode: str | None = None,
        web_approved: bool = False,
        web_prompt: str = "",
    ) -> dict[str, Any]:
        truth_md = core.read_limited_text(truth_path) if truth_path else ""
        scene_context = _build_scene_context(context)
        current_snapshot = _build_scene_snapshot(context)
        previous_snapshot = core.load_scene_snapshot(props.last_scene_snapshot)
        scene_diff = core.scene_snapshot_diff(previous_snapshot, current_snapshot)
        runtime_facts = (
            _build_runtime_facts(context)
            if props.include_runtime_facts
            else f"Blender version: {bpy.app.version_string}"
        )
        tool_references = (
            core.select_tool_cards(prompt, scene_context) if props.include_tool_refs else ""
        )
        recent_messages = _messages_as_dicts(props)
        effective_knowledge_mode = core.normalize_knowledge_mode(
            knowledge_mode or getattr(props, "knowledge_mode", core.DEFAULT_KNOWLEDGE_MODE)
        )
        knowledge_prompt = web_prompt.strip() if web_approved and web_prompt.strip() else prompt
        if effective_knowledge_mode == core.KNOWLEDGE_MODE_TOOL_USE:
            knowledge = {
                "router_decision": "",
                "scene_diagnostic_flags": "",
                "workflow_cards": "",
                "troubleshooting_cards": "",
                "knowledge_references": "",
                "web_references": "",
                "semantic_scene_card": "",
                "verification_notes": "",
                "router_trace": {
                    "selectedRoute": "",
                    "score": 0,
                    "answerRisk": "unknown",
                    "workflowCards": [],
                    "troubleshootingCards": [],
                    "cardsStatus": core.veteran_cards_status(),
                    "webDecision": "Tool Use mode: retrieval waits for model-requested tools.",
                    "webSearchQueries": [],
                    "webSearchUsedQueries": [],
                },
                "knowledge_status": {
                    "mode": core.KNOWLEDGE_MODE_TOOL_USE,
                    "modeLabel": core.knowledge_mode_label(core.KNOWLEDGE_MODE_TOOL_USE),
                    "docsIndexStatus": core.docs_index_status(runtime_facts),
                    "lastWebLookupStatus": "Tool Use mode: no web lookup before the model requests one.",
                    "sourceUrls": [],
                    "confidence": 0,
                    "reliedOn": "live scene + screenshot + model-requested tools",
                    "selectedRoute": "",
                    "routeScore": 0,
                    "answerRisk": "unknown",
                    "veteranCardsStatus": core.veteran_cards_status(),
                    "selectedCards": [],
                },
                "knowledge_sources": [],
            }
        else:
            knowledge = core.retrieve_knowledge(
                prompt=knowledge_prompt,
                scene_context=scene_context,
                runtime_facts=runtime_facts,
                recent_messages=recent_messages,
                knowledge_mode=effective_knowledge_mode,
                allow_default_web=True,
                web_approved=web_approved or core.is_explicit_web_lookup_request(prompt),
            )
        return {
            "prompt": prompt,
            "knowledge_prompt": knowledge_prompt,
            "web_approved": web_approved,
            "truth_md": truth_md,
            "scene_context": scene_context,
            "scene_diff": scene_diff,
            "scene_snapshot": current_snapshot,
            "runtime_facts": runtime_facts,
            "tool_references": tool_references,
            "router_decision": knowledge["router_decision"],
            "scene_diagnostic_flags": knowledge["scene_diagnostic_flags"],
            "workflow_cards": knowledge["workflow_cards"],
            "troubleshooting_cards": knowledge["troubleshooting_cards"],
            "router_trace": knowledge["router_trace"],
            "knowledge_references": knowledge["knowledge_references"],
            "web_references": knowledge["web_references"],
            "semantic_scene_card": knowledge["semantic_scene_card"],
            "verification_notes": knowledge["verification_notes"],
            "knowledge_status": knowledge["knowledge_status"],
            "knowledge_sources": knowledge["knowledge_sources"],
            "recent_messages": recent_messages,
            "compacted_summary": props.compacted_summary,
        }


    def _current_context_parts(context: Any, props: Any, truth_path: Path | None) -> dict[str, Any]:
        return _context_parts_for_prompt(context, props, truth_path, props.prompt)


    def _core_context_parts(parts: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in parts.items()
            if key
            in {
                "prompt",
                "truth_md",
                "scene_context",
                "scene_diff",
                "runtime_facts",
                "tool_references",
                "router_decision",
                "scene_diagnostic_flags",
                "workflow_cards",
                "troubleshooting_cards",
                "knowledge_references",
                "web_references",
                "semantic_scene_card",
                "verification_notes",
                "recent_messages",
                "compacted_summary",
            }
        }


    def _estimate_current_context_tokens(context: Any, props: Any, truth_path: Path | None) -> int:
        parts = _current_context_parts(context, props, truth_path)
        breakdown = core.context_breakdown(**_core_context_parts(parts))
        return sum(breakdown.values())


    def _current_context_breakdown(context: Any, props: Any, truth_path: Path | None) -> dict[str, int]:
        parts = _current_context_parts(context, props, truth_path)
        return core.context_breakdown(**_core_context_parts(parts))


    def _scale_png_in_place(path: str, max_px: int) -> None:
        if max_px <= 0:
            return
        image = None
        try:
            image = bpy.data.images.load(path, check_existing=False)
            width, height = image.size
            largest = max(width, height)
            if largest <= max_px:
                return
            scale = max_px / largest
            new_width = max(1, round(width * scale))
            new_height = max(1, round(height * scale))
            image.scale(new_width, new_height)
            image.filepath_raw = path
            image.file_format = "PNG"
            image.save()
        finally:
            if image is not None:
                bpy.data.images.remove(image)


    def _ordered_blender_windows(context: Any | None = None) -> list[Any]:
        windows = list(bpy.context.window_manager.windows)
        preferred = getattr(context or bpy.context, "window", None)
        if preferred in windows:
            windows.remove(preferred)
            windows.insert(0, preferred)
        return windows


    def _capture_screenshot_data_url(
        max_px: int = BLENDY_DESKTOP_OVERVIEW_MAX_PX,
        with_kind: bool = False,
        context: Any | None = None,
    ) -> Any:
        handle, path = tempfile.mkstemp(prefix="local_ai_chat_", suffix=".png")
        os.close(handle)
        try:
            captured = False
            capture_kind = "overview"
            for window in _ordered_blender_windows(context):
                screen = window.screen
                try:
                    with bpy.context.temp_override(window=window, screen=screen):
                        try:
                            bpy.ops.screen.screenshot(filepath=path, hide_props_region=False)
                        except TypeError:
                            bpy.ops.screen.screenshot(filepath=path)
                    captured = True
                    break
                except Exception:
                    continue
            if not captured:
                for window in _ordered_blender_windows(context):
                    screen = window.screen
                    for area in screen.areas:
                        if area.type != "VIEW_3D":
                            continue
                        try:
                            with bpy.context.temp_override(window=window, screen=screen, area=area):
                                bpy.ops.screen.screenshot_area(filepath=path)
                            captured = True
                            capture_kind = "active_editor"
                            break
                        except Exception:
                            continue
                    if captured:
                        break
            if not captured:
                try:
                    bpy.ops.screen.screenshot(filepath=path, hide_props_region=False)
                except TypeError:
                    bpy.ops.screen.screenshot(filepath=path)
            _scale_png_in_place(path, max_px)
            data_url = core.encode_image_data_url(path)
            return (data_url, capture_kind) if with_kind else data_url
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


    def _capture_active_area_data_url(
        max_px: int,
        selection: dict[str, Any],
    ) -> tuple[str, str]:
        """Capture a useful editor crop when Blender exposes one; never pretend on failure."""

        if selection["sections"].get("nodes"):
            preferred = ["NODE_EDITOR", "VIEW_3D", "PROPERTIES"]
        elif selection["sections"].get("materials"):
            preferred = ["NODE_EDITOR", "PROPERTIES", "VIEW_3D", "IMAGE_EDITOR"]
        else:
            preferred = ["VIEW_3D", "NODE_EDITOR", "PROPERTIES"]
        candidates: list[tuple[int, int, Any, Any, Any]] = []
        for window in bpy.context.window_manager.windows:
            screen = window.screen
            for area in getattr(screen, "areas", []):
                area_type = getattr(area, "type", "")
                if area_type not in preferred:
                    continue
                region = next(
                    (region for region in getattr(area, "regions", []) if getattr(region, "type", "") == "WINDOW"),
                    None,
                )
                if region is None:
                    continue
                rank = preferred.index(area_type)
                size = int(getattr(area, "width", 0) or 0) * int(getattr(area, "height", 0) or 0)
                candidates.append((rank, -size, window, area, region))
        if not candidates:
            raise RuntimeError("No visible 3D View or Node Editor area is available for a focused capture.")

        _rank, _size, window, area, region = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
        handle, path = tempfile.mkstemp(prefix="local_ai_chat_area_", suffix=".png")
        os.close(handle)
        try:
            with bpy.context.temp_override(
                window=window,
                screen=window.screen,
                area=area,
                region=region,
            ):
                bpy.ops.screen.screenshot_area(filepath=path)
            if not os.path.exists(path) or os.path.getsize(path) <= 0:
                raise RuntimeError("Blender returned an empty focused screenshot.")
            _scale_png_in_place(path, max_px)
            return core.encode_image_data_url(path), str(getattr(area, "type", "UNKNOWN"))
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


    def _scene_unit_label(scene: Any) -> str:
        unit_settings = scene.unit_settings
        system = getattr(unit_settings, "system", "NONE") or "NONE"
        if system == "NONE":
            return "None"
        length_unit = getattr(unit_settings, "length_unit", "ADAPTIVE") or "ADAPTIVE"
        clean_system = system.replace("_", " ").title()
        clean_length = length_unit.replace("_", " ").title()
        return f"{clean_system} / {clean_length}"


    def _number_triplet(value: Any, separator: str = " x ") -> str:
        try:
            return separator.join(f"{float(part):.4g}" for part in value)
        except Exception:
            return "Unknown"


    def _modifier_payloads(obj: Any | None) -> list[dict[str, str]]:
        if obj is None:
            return []
        modifiers = []
        for modifier in obj.modifiers[:12]:
            detail = _modifier_summary(modifier).lstrip("- ")
            prefix = f"{modifier.name}: "
            if detail.startswith(prefix):
                detail = detail[len(prefix):]
            modifiers.append({"name": modifier.name, "detail": detail})
        return modifiers


    def _scene_material_names(context: Any, limit: int = 14) -> list[str]:
        names: list[str] = []
        active = context.active_object
        objects = [active] if active else []
        objects.extend(obj for obj in context.scene.objects if obj is not active)
        for obj in objects:
            for slot in obj.material_slots:
                material = slot.material
                if material and material.name not in names:
                    names.append(material.name)
                    if len(names) >= limit:
                        return names
        for material in bpy.data.materials:
            if material.name not in names:
                names.append(material.name)
                if len(names) >= limit:
                    break
        return names


    def _scene_summary_text(context: Any) -> str:
        counts: dict[str, int] = {}
        for obj in context.scene.objects:
            counts[obj.type] = counts.get(obj.type, 0) + 1
        count_text = ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))
        return f"{context.scene.name}; frame {context.scene.frame_current}; objects: {count_text or 'none'}"


    def _active_bevel_context(obj: Any | None) -> str:
        if obj is None:
            return ""
        for modifier in obj.modifiers:
            if modifier.type != "BEVEL":
                continue
            bits = []
            if hasattr(modifier, "width"):
                bits.append(f"amount={getattr(modifier, 'width'):.4g}")
            if hasattr(modifier, "segments"):
                bits.append(f"segments={getattr(modifier, 'segments')}")
            return "Bevel " + ", ".join(bits) if bits else "Bevel modifier"
        return ""


    def _bridge_context_line(context: Any, screenshot: bool) -> str:
        active = context.active_object
        if active:
            try:
                object_status = f"{active.name} selected" if active.select_get() else f"{active.name} active (not selected)"
            except Exception:
                object_status = f"{active.name} active"
        else:
            object_status = "No active object"
        facts = [
            _scene_unit_label(context.scene),
            object_status,
            context.mode.replace("_", " ").title(),
        ]
        bevel = _active_bevel_context(active)
        if bevel:
            facts.append(bevel)
        facts.append("Blender screen captured" if screenshot else "Scene data inspected")
        return "Used: " + " | ".join(facts)


    def _bridge_should_capture_screenshot(payload: dict[str, Any]) -> bool:
        mode = str(payload.get("screenshot", "never")).lower()
        if mode == "always":
            return True
        if mode != "auto":
            return False
        prompt = str(payload.get("prompt", ""))
        return core.should_send_screenshot(
            context_mode=core.CONTEXT_MODE_AUTO,
            include_screenshot=True,
            prompt=prompt,
        )


    def _build_bridge_context_payload(context: Any, payload: dict[str, Any]) -> dict[str, Any]:
        """Build read-only evidence for Blendy desktop; prompt policy lives in Electron."""

        request = _sanitize_bridge_request_payload(payload)
        props = context.scene.local_ai_chat
        prompt = request["prompt"]
        selection = request["contextSelection"]
        tier = selection["tier"]
        active = context.active_object

        runtime_facts = _build_bridge_runtime_facts(context, selection)
        scene_context = _build_bridge_scene_context(context, selection)
        snapshot_limit = {"compact": 60, "focused": 100, "expanded": 160}[tier]
        current_snapshot = _build_scene_snapshot(context, object_limit=snapshot_limit)
        previous_snapshot = core.load_scene_snapshot(props.last_scene_snapshot)
        scene_diff = core.scene_snapshot_diff(previous_snapshot, current_snapshot)
        scene_diff = _bridge_cap_text(scene_diff, tier, "scene changes")

        screenshot = ""
        screenshot_error = ""
        active_area_error = ""
        visual_evidence: list[dict[str, str]] = []
        if _bridge_should_capture_screenshot(request):
            try:
                overview_max_px = max(
                    BLENDY_DESKTOP_OVERVIEW_MAX_PX,
                    int(getattr(props, "screenshot_max_px", BLENDY_DESKTOP_OVERVIEW_MAX_PX) or 0),
                )
                screenshot, screenshot_kind = _capture_screenshot_data_url(
                    overview_max_px,
                    with_kind=True,
                    context=context,
                )
                visual_evidence.append(
                    {
                        "kind": screenshot_kind,
                        "label": (
                            "Full active Blender window"
                            if screenshot_kind == "overview"
                            else "Focused Blender editor (full-window capture was unavailable)"
                        ),
                        "editorType": "SCREEN" if screenshot_kind == "overview" else "VIEW_3D",
                        "dataUrl": screenshot,
                        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "maxEdge": str(overview_max_px),
                        "byteCount": str(len(screenshot.encode("utf-8"))),
                    }
                )
                if screenshot_kind == "overview":
                    try:
                        focused_max_px = max(
                            BLENDY_DESKTOP_FOCUSED_MAX_PX,
                            int(getattr(props, "screenshot_max_px", BLENDY_DESKTOP_FOCUSED_MAX_PX) or 0),
                        )
                        active_data_url, editor_type = _capture_active_area_data_url(
                            focused_max_px,
                            selection,
                        )
                        visual_evidence.append(
                            {
                                "kind": "active_editor",
                                "label": f"Focused {editor_type.replace('_', ' ').title()} evidence",
                                "editorType": editor_type,
                                "dataUrl": active_data_url,
                                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "maxEdge": str(focused_max_px),
                                "byteCount": str(len(active_data_url.encode("utf-8"))),
                            }
                        )
                    except Exception as exc:
                        active_area_error = str(exc)
            except Exception as exc:
                screenshot_error = str(exc)

        visual_evidence, omitted_visual_count = _bounded_visual_evidence(visual_evidence)
        if omitted_visual_count:
            active_area_error = (
                f"{omitted_visual_count} optional focused capture was omitted to keep the local bridge response bounded"
            )
        overview_evidence = next(
            (item for item in visual_evidence if item.get("kind") == "overview"),
            None,
        )
        screenshot = str((overview_evidence or visual_evidence[0]).get("dataUrl", "")) if visual_evidence else ""

        project = _bridge_project_payload(context)
        context_line = _bridge_context_line(context, bool(screenshot))
        if visual_evidence:
            captured_labels = ", ".join(item["label"] for item in visual_evidence)
            visual = f"Captured: {captured_labels}."
        else:
            visual = "No Blender screenshot was captured; only live runtime and scene facts are available."
        if screenshot_error:
            visual = f"Blender screen capture failed: {screenshot_error}. Live facts are still available."
        elif active_area_error:
            visual += f" Focused editor capture unavailable: {active_area_error}."
        visual_context = "\n".join(
            [
                context_line,
                visual,
                (
                    f"Visual evidence count: {len(visual_evidence)}. Evidence labels are truthful capture scopes."
                    if visual_evidence
                    else "Visual evidence count: 0. Do not claim to see the Blender screen."
                ),
            ]
        )
        return {
            "ok": True,
            "bridge": {
                "protocolVersion": BLENDY_BRIDGE_PROTOCOL_VERSION,
                "host": BLENDY_BRIDGE_HOST,
                "port": _active_bridge_port(),
                "blenderVersion": bpy.app.version_string,
            },
            "project": project,
            "contextTier": tier,
            "contextSelection": selection,
            "contextLine": context_line,
            "selected": {
                "object": active.name if active else "None",
                "objectType": active.type if active else "None",
                "mode": context.mode.replace("_", " ").title(),
                "units": _scene_unit_label(context.scene),
                "dimensions": _number_triplet(active.dimensions) if active else "None",
                "scale": _number_triplet(active.scale, separator=", ") if active else "None",
            },
            "runtimeState": _authoritative_ui_state(context),
            "modifiers": _modifier_payloads(active),
            "scene": {
                "name": context.scene.name,
                "summary": _scene_summary_text(context),
                "materials": _scene_material_names(context),
            },
            "visual": visual,
            "used": {
                "screenshot": bool(visual_evidence),
                "screenshotOverview": any(item["kind"] == "overview" for item in visual_evidence),
                "activeEditorScreenshot": any(item["kind"] == "active_editor" for item in visual_evidence),
                "screenshotReason": request["screenshot"],
                "screenshotError": screenshot_error,
                "focusedCaptureError": active_area_error,
                "contextTier": tier,
                "knowledgeMode": "desktop_managed",
            },
            "promptParts": {
                "scene_context": scene_context,
                "scene_diff": scene_diff,
                "runtime_facts": runtime_facts,
            },
            "visualEvidence": visual_evidence,
            "_sceneSnapshot": core.dump_scene_snapshot(current_snapshot) if prompt.strip() else "",
        }


    def _submit_bridge_job(payload: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
        event = threading.Event()
        job: dict[str, Any] = {
            "payload": payload,
            "event": event,
            "result": None,
            "error": None,
            "cancelled": False,
            "deadline": time.monotonic() + timeout,
        }
        try:
            _BRIDGE_JOB_QUEUE.put_nowait(job)
        except queue.Full as exc:
            raise _BridgeBusyError("Blender is already preparing context. Try again in a moment.") from exc
        if not event.wait(timeout):
            job["cancelled"] = True
            raise TimeoutError("Blender did not return context before the bridge timeout.")
        if job["error"]:
            raise RuntimeError(str(job["error"]))
        return dict(job["result"] or {})


    def _process_bridge_jobs() -> None:
        for _ in range(BLENDY_BRIDGE_MAX_JOBS_PER_TICK):
            try:
                job = _BRIDGE_JOB_QUEUE.get_nowait()
            except queue.Empty:
                break
            if job.get("cancelled") or time.monotonic() >= float(job.get("deadline", 0)):
                job["cancelled"] = True
                job["event"].set()
                continue
            try:
                result = _build_bridge_context_payload(bpy.context, job["payload"])
                snapshot = str(result.pop("_sceneSnapshot", ""))
                if job.get("cancelled") or time.monotonic() >= float(job.get("deadline", 0)):
                    job["cancelled"] = True
                    job["error"] = "Context request expired before it could be returned."
                else:
                    if snapshot:
                        bpy.context.scene.local_ai_chat.last_scene_snapshot = snapshot
                    job["result"] = result
            except Exception as exc:
                job["error"] = str(exc)
            finally:
                job["event"].set()


    class _BlendyBridgeHandler(BaseHTTPRequestHandler):
        server_version = "BlendyBridge/2.1.0"

        def log_message(self, format: str, *args: Any) -> None:
            return None

        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _require_safe_origin(self) -> bool:
            if _bridge_origin_allowed(self.headers):
                return True
            self._send_json(403, {"ok": False, "error": "Browser origin is not allowed."})
            return False

        def _require_token(self) -> bool:
            if _bridge_token_matches(self.headers):
                return True
            self._send_json(401, {"ok": False, "error": "Bridge token is missing or invalid."})
            return False

        def do_OPTIONS(self) -> None:
            self._send_json(403, {"ok": False, "error": "Browser requests are not accepted."})

        def do_GET(self) -> None:
            if not self._require_safe_origin() or not self._require_token():
                return
            route = self.path.split("?", 1)[0]
            if route != "/health":
                self._send_json(404, {"ok": False, "error": "Unknown endpoint."})
                return
            self._send_json(
                200,
                {
                    "ok": True,
                    "name": "Blendy Blender bridge",
                    "protocolVersion": BLENDY_BRIDGE_PROTOCOL_VERSION,
                    "blenderVersion": bpy.app.version_string,
                    "port": _active_bridge_port(),
                },
            )

        def do_POST(self) -> None:
            route = self.path.split("?", 1)[0]
            if route != "/context":
                self._send_json(404, {"ok": False, "error": "Unknown endpoint."})
                return
            if not self._require_safe_origin() or not self._require_token():
                return
            try:
                transfer_encoding = _header_value(self.headers, "Transfer-Encoding")
                if transfer_encoding:
                    self._send_json(400, {"ok": False, "error": "Chunked request bodies are not accepted."})
                    return
                content_type = _header_value(self.headers, "Content-Type").lower()
                media_type = content_type.split(";", 1)[0].strip()
                if media_type != "application/json":
                    self._send_json(415, {"ok": False, "error": "Content-Type must be application/json."})
                    return
                try:
                    length = _validated_bridge_content_length(
                        _header_value(self.headers, "Content-Length")
                    )
                except OverflowError:
                    self._send_json(413, {"ok": False, "error": "Request body is too large."})
                    return
                except ValueError:
                    self._send_json(400, {"ok": False, "error": "Content-Length is invalid."})
                    return
                raw = self.rfile.read(length) if length else b"{}"
                if len(raw) != length:
                    self._send_json(400, {"ok": False, "error": "Request body is incomplete."})
                    return
                payload = json.loads(raw.decode("utf-8", errors="strict") or "{}")
                payload = _sanitize_bridge_request_payload(payload)
                result = _submit_bridge_job(payload)
                self._send_json(200, result)
            except _BridgeBusyError as exc:
                self._send_json(429, {"ok": False, "error": str(exc)})
            except TimeoutError as exc:
                self._send_json(504, {"ok": False, "error": str(exc)})
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
                self._send_json(400, {"ok": False, "error": f"Invalid request: {exc}"})
            except Exception:
                self._send_json(500, {"ok": False, "error": "Blender could not prepare context."})


    def _write_bridge_discovery(port: int) -> None:
        payload = {
            "version": 2,
            "protocolVersion": BLENDY_BRIDGE_PROTOCOL_VERSION,
            "host": BLENDY_BRIDGE_HOST,
            "port": port,
            "url": f"http://{BLENDY_BRIDGE_HOST}:{port}",
            "token": _BRIDGE_TOKEN,
            "tokenHeader": BLENDY_BRIDGE_TOKEN_HEADER,
            "pid": os.getpid(),
            "blenderVersion": bpy.app.version_string,
        }
        path = _bridge_discovery_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        temporary.replace(path)


    def _clear_bridge_discovery(port: int | None) -> None:
        path = _bridge_discovery_path()
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("pid") != os.getpid() or data.get("port") != port:
                return
            path.unlink()
        except Exception:
            pass


    def _start_bridge_server() -> None:
        global _BRIDGE_SERVER, _BRIDGE_THREAD, _BRIDGE_PORT, _BRIDGE_TOKEN
        if _BRIDGE_SERVER is not None:
            return
        _BRIDGE_TOKEN = secrets.token_urlsafe(32)
        server = None
        last_error = None
        for offset in range(BLENDY_BRIDGE_PORT_SCAN_COUNT):
            port = BLENDY_BRIDGE_DEFAULT_PORT + offset
            try:
                server = ThreadingHTTPServer((BLENDY_BRIDGE_HOST, port), _BlendyBridgeHandler)
                _BRIDGE_PORT = port
                break
            except OSError as exc:
                last_error = exc
        if server is None:
            print(
                "Blendy bridge could not start on ports "
                f"{BLENDY_BRIDGE_DEFAULT_PORT}-{BLENDY_BRIDGE_DEFAULT_PORT + BLENDY_BRIDGE_PORT_SCAN_COUNT - 1}: {last_error}"
            )
            _BRIDGE_PORT = None
            _BRIDGE_TOKEN = ""
            return
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, name="BlendyBridge", daemon=True)
        _BRIDGE_SERVER = server
        _BRIDGE_THREAD = thread
        thread.start()
        _write_bridge_discovery(_BRIDGE_PORT)


    def _stop_bridge_server() -> None:
        global _BRIDGE_SERVER, _BRIDGE_THREAD, _BRIDGE_PORT, _BRIDGE_TOKEN
        server = _BRIDGE_SERVER
        port = _BRIDGE_PORT
        _BRIDGE_SERVER = None
        _BRIDGE_THREAD = None
        _BRIDGE_PORT = None
        _BRIDGE_TOKEN = ""
        if server is None:
            return
        try:
            server.shutdown()
            server.server_close()
        except Exception:
            pass
        while True:
            try:
                job = _BRIDGE_JOB_QUEUE.get_nowait()
            except queue.Empty:
                break
            job["cancelled"] = True
            job["error"] = "Blender bridge stopped."
            job["event"].set()
        _clear_bridge_discovery(port)


    def _url_reachable(url: str, timeout: float = 0.75) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=timeout):
                return True
        except (OSError, urllib.error.URLError):
            return False


    def _find_blendy_exe() -> Path | None:
        candidates = []
        env_exe = os.environ.get("BLENDY_EXE")
        if env_exe:
            candidates.append(Path(env_exe))
        local_appdata = os.environ.get("LOCALAPPDATA")
        if local_appdata:
            candidates.append(Path(local_appdata) / "Programs" / "Blendy" / "Blendy.exe")
        program_files = os.environ.get("ProgramFiles")
        if program_files:
            candidates.append(Path(program_files) / "Blendy" / "Blendy.exe")
        project_root = Path(__file__).resolve().parents[1]
        candidates.append(project_root / "blendy" / "release" / "win-unpacked" / "Blendy.exe")
        candidates.append(project_root / "blendy" / "release-fresh" / "win-unpacked" / "Blendy.exe")
        candidates.append(project_root / "blendy" / "dist" / "win-unpacked" / "Blendy.exe")
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return None


    def _no_console_kwargs(hide_startup_window: bool = False) -> dict[str, Any]:
        if os.name != "nt":
            return {}
        kwargs = {
            "creationflags": subprocess.CREATE_NO_WINDOW,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if hide_startup_window:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            kwargs["startupinfo"] = startupinfo
        return kwargs


    def _find_blendy_app_dir() -> Path | None:
        env_dir = os.environ.get("BLENDY_APP_DIR")
        candidates = [Path(env_dir)] if env_dir else []
        candidates.append(Path(__file__).resolve().parents[1] / "blendy")
        for candidate in candidates:
            if (candidate / "package.json").exists():
                return candidate
        return None


    def _launch_blendy_process() -> str:
        global _BLENDY_PROCESS
        if _BLENDY_PROCESS is not None and _BLENDY_PROCESS.poll() is None:
            return "Blendy is already running from this Blender session."

        exe_path = _find_blendy_exe()
        if exe_path is not None:
            _BLENDY_PROCESS = subprocess.Popen(
                [str(exe_path)],
                cwd=str(exe_path.parent),
                **_no_console_kwargs(),
            )
            return "Opened installed Blendy."

        app_dir = _find_blendy_app_dir()
        if app_dir is None:
            raise FileNotFoundError(
                "Could not find Blendy. Set BLENDY_EXE to the installed app or BLENDY_APP_DIR to the development folder."
            )
        script = "start" if _url_reachable("http://127.0.0.1:5187") else "dev"
        npm = "npm.cmd" if os.name == "nt" else "npm"
        _BLENDY_PROCESS = subprocess.Popen(
            [npm, "run", script],
            cwd=str(app_dir),
            **_no_console_kwargs(hide_startup_window=True),
        )
        return "Opened Blendy development app."


    class LOCALAI_OT_LaunchBlendy(Operator):
        bl_idname = "local_ai_chat.launch_blendy"
        bl_label = "Launch Blendy"
        bl_description = "Open the floating Blendy companion app"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            try:
                if _BRIDGE_PORT is not None:
                    _write_bridge_discovery(_BRIDGE_PORT)
                message = _launch_blendy_process()
            except Exception as exc:
                props.status_kind = "ERROR"
                props.status_text = f"Blendy launch failed: {exc}"
                self.report({"ERROR"}, props.status_text)
                return {"CANCELLED"}
            props.status_kind = "OK"
            props.status_text = message
            self.report({"INFO"}, message)
            return {"FINISHED"}


    class LOCALAI_OT_TestConnection(Operator):
        bl_idname = "local_ai_chat.test_connection"
        bl_label = "Test Connection"
        bl_description = "Check the LM Studio local server"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            if props.is_busy:
                self.report({"WARNING"}, "Local AI is already working.")
                return {"CANCELLED"}
            props.is_busy = True
            props.active_task = "TEST"
            props.status_kind = "BUSY"
            props.status_text = "Testing local model server..."
            threading.Thread(
                target=_threaded_model_list,
                args=(context.scene.name, props.backend_base_url, props.model_name),
                daemon=True,
            ).start()
            return {"FINISHED"}


    class LOCALAI_OT_Send(Operator):
        bl_idname = "local_ai_chat.send"
        bl_label = "Send"
        bl_description = "Send the prompt, live scene context, and optional screenshot"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            prompt = props.prompt.strip()
            if props.is_busy:
                self.report({"WARNING"}, "Local AI is already working.")
                return {"CANCELLED"}
            if not prompt:
                props.status_kind = "WARN"
                props.status_text = "Write a prompt first."
                return {"CANCELLED"}
            truth_path = _truth_path_for_current_file()

            try:
                parts = _current_context_parts(context, props, truth_path)
                send_screenshot = core.should_send_screenshot(
                    context_mode=props.context_mode,
                    include_screenshot=props.include_screenshot,
                    prompt=prompt,
                )
                screenshot = (
                    _capture_screenshot_data_url(props.screenshot_max_px)
                    if send_screenshot
                    else None
                )
            except Exception as exc:
                props.status_kind = "ERROR"
                props.status_text = f"Context capture failed: {exc}"
                return {"CANCELLED"}

            recent = _messages_as_dicts(props)
            payload = core.build_chat_payload(
                model_name=props.model_name,
                prompt=prompt,
                truth_md=parts["truth_md"],
                scene_context=parts["scene_context"],
                runtime_facts=parts["runtime_facts"],
                tool_references=parts["tool_references"],
                scene_diff=parts["scene_diff"],
                router_decision=parts["router_decision"],
                scene_diagnostic_flags=parts["scene_diagnostic_flags"],
                workflow_cards=parts["workflow_cards"],
                troubleshooting_cards=parts["troubleshooting_cards"],
                knowledge_references=parts["knowledge_references"],
                web_references=parts["web_references"],
                semantic_scene_card=parts["semantic_scene_card"],
                verification_notes=parts["verification_notes"],
                knowledge_mode=props.knowledge_mode,
                recent_messages=recent,
                compacted_summary=props.compacted_summary,
                screenshot_data_url=screenshot,
                response_max_tokens=props.response_max_tokens,
            )

            _add_message(props, "user", prompt)
            props.prompt = ""
            props.last_scene_snapshot = core.dump_scene_snapshot(parts["scene_snapshot"])
            props.is_busy = True
            props.active_task = "CHAT"
            props.status_kind = "BUSY"
            props.status_text = (
                "Asking local tutor with Blender screen image..."
                if screenshot
                else "Asking local tutor with scene data..."
            )
            threading.Thread(
                target=_threaded_call,
                args=("chat", context.scene.name, props.backend_base_url, payload),
                daemon=True,
            ).start()
            return {"FINISHED"}


    class LOCALAI_OT_CompactChat(Operator):
        bl_idname = "local_ai_chat.compact_chat"
        bl_label = "Compact Chat"
        bl_description = "Summarize the current chat into compact session memory"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            if props.is_busy:
                self.report({"WARNING"}, "Local AI is already working.")
                return {"CANCELLED"}
            messages = _messages_as_dicts(props)
            if not messages and not props.compacted_summary.strip():
                props.status_kind = "WARN"
                props.status_text = "Nothing to compact yet."
                return {"CANCELLED"}
            payload = core.build_compaction_payload(
                model_name=props.model_name,
                messages=messages,
                existing_summary=props.compacted_summary,
            )
            props.is_busy = True
            props.active_task = "COMPACT"
            props.status_kind = "BUSY"
            props.status_text = "Compacting chat with local model..."
            threading.Thread(
                target=_threaded_call,
                args=("compact", context.scene.name, props.backend_base_url, payload),
                daemon=True,
            ).start()
            return {"FINISHED"}


    class LOCALAI_OT_NewChat(Operator):
        bl_idname = "local_ai_chat.new_chat"
        bl_label = "New Chat"
        bl_description = "Clear in-memory chat but keep truth.md project memory"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            while len(props.messages):
                props.messages.remove(0)
            props.compacted_summary = ""
            _scroll_chat_to_latest(props)
            _sync_chat_text(props)
            props.status_kind = "OK"
            props.status_text = "Started a new chat. truth.md and scene baseline are unchanged."
            return {"FINISHED"}


    class LOCALAI_OT_OpenChatText(Operator):
        bl_idname = "local_ai_chat.open_chat_text"
        bl_label = "Open Chat Split"
        bl_description = "Open the Blender Tutor transcript in a scrollable Text Editor split"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            text = _sync_chat_text(props)
            if text is None:
                props.status_kind = "ERROR"
                props.status_text = "Could not create Blender Tutor Chat text."
                return {"CANCELLED"}

            screen = context.window.screen
            for area in screen.areas:
                if area.type == "TEXT_EDITOR":
                    _assign_chat_text_to_area(area, text)
                    props.status_kind = "OK"
                    props.status_text = "Chat transcript opened in Text Editor."
                    return {"FINISHED"}

            source_area = context.area if context.area and context.area.type == "VIEW_3D" else None
            if source_area is None:
                view_areas = [area for area in screen.areas if area.type == "VIEW_3D"]
                if view_areas:
                    source_area = max(view_areas, key=lambda area: area.width * area.height)
            if source_area is None:
                props.status_kind = "ERROR"
                props.status_text = "No 3D View area available to split."
                return {"CANCELLED"}

            window_region = next((region for region in source_area.regions if region.type == "WINDOW"), None)
            before = set(screen.areas)
            try:
                override = {"window": context.window, "screen": screen, "area": source_area}
                if window_region is not None:
                    override["region"] = window_region
                with context.temp_override(**override):
                    bpy.ops.screen.area_split(direction="VERTICAL", factor=0.68)
            except Exception as exc:
                props.status_kind = "ERROR"
                props.status_text = f"Could not split area: {exc}"
                return {"CANCELLED"}

            new_areas = [area for area in screen.areas if area not in before]
            target_area = max(new_areas or screen.areas, key=lambda area: area.x)
            _assign_chat_text_to_area(target_area, text)
            props.status_kind = "OK"
            props.status_text = "Opened Blender Tutor Chat in a right-side Text Editor."
            return {"FINISHED"}


    class LOCALAI_OT_ConnectionPopup(Operator):
        bl_idname = "local_ai_chat.connection_popup"
        bl_label = "Connection"
        bl_description = "Show local model connection settings"

        def invoke(self, context: Any, event: Any) -> set[str]:
            return context.window_manager.invoke_popup(self, width=420)

        def draw(self, context: Any) -> None:
            props = context.scene.local_ai_chat
            layout = self.layout
            layout.prop(props, "backend_base_url")
            layout.prop(props, "model_name")
            row = layout.row(align=True)
            row.enabled = not props.is_busy
            row.operator("local_ai_chat.test_connection", icon="CHECKMARK")

        def execute(self, context: Any) -> set[str]:
            return {"FINISHED"}


    class LOCALAI_OT_SettingsPopup(Operator):
        bl_idname = "local_ai_chat.settings_popup"
        bl_label = "Context Settings"
        bl_description = "Show context, image, and tutor input settings"

        def invoke(self, context: Any, event: Any) -> set[str]:
            return context.window_manager.invoke_popup(self, width=360)

        def draw(self, context: Any) -> None:
            props = context.scene.local_ai_chat
            layout = self.layout
            truth_path = _truth_path_for_current_file()
            if truth_path is not None:
                try:
                    breakdown = _current_context_breakdown(context, props, truth_path)
                    context_tokens = sum(breakdown.values())
                    limit = props.context_limit_tokens or core.DEFAULT_CONTEXT_LIMIT_TOKENS
                    percent = core.context_percent(context_tokens, limit)
                    status = core.context_status(context_tokens, limit)
                    row = layout.row()
                    row.alert = status in {"WARN", "DANGER"}
                    icon = "CHECKMARK" if status == "OK" else ("ERROR" if status == "WARN" else "CANCEL")
                    row.label(text=f"Context {context_tokens:,}/{limit:,} ({percent}%)", icon=icon)
                except Exception as exc:
                    layout.label(text=f"Context unavailable: {str(exc)[:48]}", icon="ERROR")
            else:
                layout.label(text="Save the .blend to measure project context.", icon="INFO")
            layout.separator()
            layout.prop(props, "context_mode")
            layout.prop(props, "include_screenshot", toggle=True)
            layout.prop(props, "screenshot_max_px")
            layout.prop(props, "include_runtime_facts", toggle=True)
            layout.prop(props, "include_tool_refs", toggle=True)
            layout.prop(props, "knowledge_mode")
            layout.prop(props, "context_limit_tokens")
            layout.prop(props, "response_max_tokens")
            if props.compacted_summary.strip():
                layout.separator()
                layout.label(text="Session summary active", icon="TEXT")
                _draw_wrapped(layout, props.compacted_summary, width=44, max_lines=6)

        def execute(self, context: Any) -> set[str]:
            return {"FINISHED"}


    class LOCALAI_OT_ProjectMemoryPopup(Operator):
        bl_idname = "local_ai_chat.project_memory_popup"
        bl_label = "Project Memory"
        bl_description = "Create or open this project's truth.md"

        def invoke(self, context: Any, event: Any) -> set[str]:
            return context.window_manager.invoke_popup(self, width=360)

        def draw(self, context: Any) -> None:
            props = context.scene.local_ai_chat
            truth_path = _truth_path_for_current_file()
            layout = self.layout
            if truth_path is None:
                layout.label(text="Save the .blend to enable truth.md.", icon="ERROR")
            else:
                exists = truth_path.exists()
                layout.label(
                    text=f"{truth_path.name}: {'ready' if exists else 'not created'}",
                    icon="CHECKMARK" if exists else "INFO",
                )
            row = layout.row(align=True)
            row.enabled = not props.is_busy
            row.operator("local_ai_chat.create_truth", text="Create", icon="FILE_TICK")
            row.operator("local_ai_chat.open_truth", text="Open", icon="FILE_FOLDER")

        def execute(self, context: Any) -> set[str]:
            return {"FINISHED"}


    class LOCALAI_OT_ChatPage(Operator):
        bl_idname = "local_ai_chat.chat_page"
        bl_label = "Chat Page"
        bl_description = "Move through the visible chat rows"

        direction: StringProperty(name="Direction", default="LATEST")

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            rows = _chat_viewport_rows(context)
            max_offset = max(0, len(_chat_display_lines(props)) - rows)
            if self.direction == "OLDER":
                props.chat_scroll_offset = max(0, props.chat_scroll_offset - CHAT_PAGE_STEP)
            elif self.direction == "NEWER":
                props.chat_scroll_offset = min(max_offset, props.chat_scroll_offset + CHAT_PAGE_STEP)
            else:
                props.chat_scroll_offset = max_offset
            return {"FINISHED"}


    class LOCALAI_OT_CreateTruth(Operator):
        bl_idname = "local_ai_chat.create_truth"
        bl_label = "Create truth.md"
        bl_description = "Create a starter truth.md beside the saved Blender file"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            truth_path = _truth_path_for_current_file()
            if truth_path is None:
                props.status_kind = "WARN"
                props.status_text = "Save this Blender file first."
                return {"CANCELLED"}
            if not truth_path.exists():
                truth_path.write_text(
                    core.starter_truth_md(Path(bpy.data.filepath).stem),
                    encoding="utf-8",
                )
                props.status_kind = "OK"
                props.status_text = f"Created {truth_path.name}."
            else:
                props.status_kind = "OK"
                props.status_text = "truth.md already exists."
            return {"FINISHED"}


    class LOCALAI_OT_OpenTruth(Operator):
        bl_idname = "local_ai_chat.open_truth"
        bl_label = "Open truth.md"
        bl_description = "Open truth.md in your normal system editor"

        def execute(self, context: Any) -> set[str]:
            props = context.scene.local_ai_chat
            truth_path = _truth_path_for_current_file()
            if truth_path is None:
                props.status_kind = "WARN"
                props.status_text = "Save this Blender file first."
                return {"CANCELLED"}
            if not truth_path.exists():
                truth_path.write_text(
                    core.starter_truth_md(Path(bpy.data.filepath).stem),
                    encoding="utf-8",
                )
            try:
                os.startfile(truth_path)  # type: ignore[attr-defined]
            except AttributeError:
                import subprocess

                subprocess.Popen(["xdg-open", str(truth_path)])
            props.status_kind = "OK"
            props.status_text = "Opened truth.md."
            return {"FINISHED"}


    def _draw_wrapped(layout: Any, text: str, width: int = 42, max_lines: int = 24) -> None:
        for line in core.wrap_for_sidebar(text, width=width, max_lines=max_lines):
            layout.label(text=line)


    def _chat_viewport_rows(context: Any) -> int:
        region = getattr(context, "region", None)
        height = int(getattr(region, "height", 0) or 0)
        if height <= 0:
            return 6
        available = height - CHAT_RESERVED_PIXEL_ESTIMATE
        rows = available // CHAT_ROW_PIXEL_ESTIMATE
        return max(CHAT_VIEWPORT_MIN_ROWS, min(CHAT_VIEWPORT_MAX_ROWS, rows))


    def _draw_chat_viewport(layout: Any, props: Any, context: Any) -> None:
        chat = layout.box()
        chat.label(text=f"Conversation ({len(props.messages)})", icon="SPEAKER")

        if not props.messages:
            chat.label(text="Ask a question to start.")
            return

        display_lines = _chat_display_lines(props)
        if not display_lines:
            chat.label(text="Chat display is rebuilding.", icon="INFO")
            return
        rows = _chat_viewport_rows(context)
        total = len(display_lines)
        max_offset = max(0, total - rows)
        start = min(max(0, props.chat_scroll_offset), max_offset)
        end = min(total, start + rows)
        for kind, role, text in display_lines[start:end]:
            if kind == "HEADER":
                chat.label(text=text, icon=_chat_role_icon(role))
            else:
                chat.label(text=text)
        for _index in range(max(0, rows - (end - start))):
            chat.label(text=" ")
        if total > rows:
            pager = chat.row(align=True)
            pager.operator("local_ai_chat.chat_page", text="Older").direction = "OLDER"
            pager.operator("local_ai_chat.chat_page", text="Newer").direction = "NEWER"
            pager.operator("local_ai_chat.chat_page", text="Latest").direction = "LATEST"


    class LOCALAI_PT_Panel(Panel):
        bl_label = "Local AI"
        bl_idname = "LOCALAI_PT_panel"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "Local AI"
        bl_options = {"HIDE_HEADER"}

        def draw(self, context: Any) -> None:
            layout = self.layout
            props = context.scene.local_ai_chat

            launch_row = layout.row(align=True)
            launch_row.scale_y = 1.35
            launch_row.operator("local_ai_chat.launch_blendy", text="Launch Blendy", icon="URL")

            status = layout.box()
            status.label(text="Blendy", icon="OUTLINER_OB_LIGHT")
            status.label(text=f"Bridge: {BLENDY_BRIDGE_HOST}:{_active_bridge_port()}", icon="LINKED")
            if props.is_busy:
                status.label(text=props.active_task.title(), icon="TIME")
            else:
                status.label(text=props.status_text[:90] or "Bridge ready", icon=_status_icon(props.status_kind))

            if props.status_kind in {"ERROR", "WARN"}:
                status = layout.row()
                status.alert = True
                status.label(text=props.status_text[:90], icon=_status_icon(props.status_kind))


    # Blendy 2 has one prompt/model runtime: the Electron companion. The older
    # in-panel chat operators remain below only as migration-readable source;
    # they are deliberately not registered and therefore cannot compete with
    # the desktop prompt, persistence, tool, or privacy policies.
    classes = (
        LOCALAI_Message,
        LOCALAI_ChatLine,
        LOCALAI_Properties,
        LOCALAI_OT_LaunchBlendy,
        LOCALAI_PT_Panel,
    )


    def register() -> None:
        global _TIMER_ACTIVE
        _cleanup_stale_capture_files()
        for cls in classes:
            bpy.utils.register_class(cls)
        bpy.types.Scene.local_ai_chat = bpy.props.PointerProperty(type=LOCALAI_Properties)
        if not _TIMER_ACTIVE:
            bpy.app.timers.register(_poll_worker_queue, persistent=True)
            _TIMER_ACTIVE = True
        _start_bridge_server()


    def unregister() -> None:
        global _TIMER_ACTIVE
        _stop_bridge_server()
        if hasattr(bpy.types.Scene, "local_ai_chat"):
            del bpy.types.Scene.local_ai_chat
        for cls in reversed(classes):
            bpy.utils.unregister_class(cls)
        _TIMER_ACTIVE = False


else:

    def register() -> None:
        raise RuntimeError("This add-on can only be registered inside Blender.")


    def unregister() -> None:
        return None
