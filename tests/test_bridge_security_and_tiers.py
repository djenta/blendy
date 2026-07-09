import unittest
from pathlib import Path

from local_ai_chat import (
    BLENDY_BRIDGE_MAX_REQUEST_BYTES,
    BLENDY_BRIDGE_MAX_PROMPT_CHARS,
    _bounded_visual_evidence,
    _bridge_context_selection,
    _bridge_origin_allowed,
    _bridge_request_token,
    _bridge_token_matches,
    _sanitize_bridge_request_payload,
    _validated_bridge_content_length,
)


class BridgeSecurityTests(unittest.TestCase):
    def test_capability_token_accepts_canonical_and_bearer_headers(self) -> None:
        token = "session-secret"
        self.assertEqual(_bridge_request_token({"X-Blendy-Token": token}), token)
        self.assertTrue(_bridge_token_matches({"x-blendy-token": token}, token))
        self.assertTrue(_bridge_token_matches({"Authorization": f"Bearer {token}"}, token))
        self.assertFalse(_bridge_token_matches({"X-Blendy-Token": "wrong"}, token))
        self.assertFalse(_bridge_token_matches({}, token))

    def test_all_browser_origins_are_denied(self) -> None:
        self.assertTrue(_bridge_origin_allowed({}))
        self.assertFalse(_bridge_origin_allowed({"Origin": "app://blendy"}))
        self.assertFalse(_bridge_origin_allowed({"Origin": "null"}))
        self.assertFalse(_bridge_origin_allowed({"Origin": "https://example.com"}))
        self.assertFalse(_bridge_origin_allowed({"Origin": "http://127.0.0.1:5187"}))

    def test_request_payload_is_small_and_strict(self) -> None:
        cleaned = _sanitize_bridge_request_payload(
            {"prompt": "Inspect this material", "screenshot": "auto", "contextLevel": "standard"}
        )
        self.assertEqual(cleaned["contextTier"], "focused")
        self.assertNotIn("webApproved", cleaned)
        with self.assertRaises(ValueError):
            _sanitize_bridge_request_payload({"prompt": "x" * (BLENDY_BRIDGE_MAX_PROMPT_CHARS + 1)})
        with self.assertRaises(ValueError):
            _sanitize_bridge_request_payload({"prompt": "hello", "screenshot": "sometimes"})
        with self.assertRaises(ValueError):
            _sanitize_bridge_request_payload({"prompt": "hello", "contextTier": "unbounded"})

    def test_http_body_length_cap_is_executable(self) -> None:
        self.assertEqual(_validated_bridge_content_length("2048"), 2048)
        with self.assertRaises(ValueError):
            _validated_bridge_content_length("not-a-number")
        with self.assertRaises(ValueError):
            _validated_bridge_content_length("-1")
        with self.assertRaises(OverflowError):
            _validated_bridge_content_length(str(BLENDY_BRIDGE_MAX_REQUEST_BYTES + 1))

    def test_visual_evidence_drops_focused_capture_before_overview(self) -> None:
        evidence = [
            {"kind": "overview", "dataUrl": "a" * 8},
            {"kind": "active_editor", "dataUrl": "b" * 8},
        ]
        kept, omitted = _bounded_visual_evidence(evidence, max_bytes=10)
        self.assertEqual([item["kind"] for item in kept], ["overview"])
        self.assertEqual(omitted, 1)


class BridgeContextTierTests(unittest.TestCase):
    def test_default_context_is_compact(self) -> None:
        selection = _bridge_context_selection("What should I do next?")
        self.assertEqual(selection["tier"], "compact")
        self.assertFalse(any(selection["sections"].values()))

    def test_prompt_expands_only_relevant_evidence(self) -> None:
        material = _bridge_context_selection("Why is this material roughness node wrong?")
        self.assertEqual(material["tier"], "focused")
        self.assertTrue(material["sections"]["nodes"])
        self.assertTrue(material["sections"]["materials"])
        self.assertFalse(material["sections"]["keymap"])

        keymap = _bridge_context_selection("What shortcut should I press here?")
        self.assertEqual(keymap["tier"], "focused")
        self.assertTrue(keymap["sections"]["keymap"])
        self.assertFalse(keymap["sections"]["nodes"])

    def test_explicit_tier_wins_and_expanded_has_all_sections(self) -> None:
        compact = _bridge_context_selection("Show all node links", "compact")
        self.assertEqual(compact["tier"], "compact")
        self.assertTrue(compact["sections"]["nodes"])

        expanded = _bridge_context_selection("What next?", "expanded")
        self.assertEqual(expanded["tier"], "expanded")
        self.assertTrue(all(expanded["sections"].values()))


class BridgeSourceBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source_path = Path(__file__).resolve().parents[1] / "local_ai_chat" / "__init__.py"
        cls.source = source_path.read_text(encoding="utf-8")

    def test_discovery_contract_contains_rotating_capability(self) -> None:
        self.assertIn('"protocolVersion": BLENDY_BRIDGE_PROTOCOL_VERSION', self.source)
        self.assertIn('"token": _BRIDGE_TOKEN', self.source)
        self.assertIn('"tokenHeader": BLENDY_BRIDGE_TOKEN_HEADER', self.source)
        self.assertIn("secrets.token_urlsafe(32)", self.source)

    def test_context_endpoint_has_no_wildcard_cors(self) -> None:
        handler = self.source[
            self.source.index("class _BlendyBridgeHandler") : self.source.index("def _write_bridge_discovery")
        ]
        self.assertNotIn('Access-Control-Allow-Origin", "*"', handler)
        self.assertIn("_require_token", handler)
        self.assertIn("_validated_bridge_content_length", handler)
        self.assertIn("_BridgeBusyError", handler)
        self.assertIn("self._send_json(429", handler)
        self.assertIn('media_type != "application/json"', handler)

    def test_desktop_bridge_returns_facts_not_a_second_system_prompt(self) -> None:
        bridge = self.source[
            self.source.index("def _build_bridge_context_payload") : self.source.index("def _submit_bridge_job")
        ]
        self.assertNotIn("core.SYSTEM_PROMPT", bridge)
        self.assertNotIn("retrieve_knowledge", bridge)
        self.assertNotIn('"system_prompt"', bridge)
        self.assertNotIn('"truthPath"', bridge)
        self.assertIn('"visualEvidence"', bridge)
        self.assertIn('"contextTier"', bridge)
        self.assertNotIn('"screenshotDataUrl"', bridge)
        self.assertNotIn('"context_text"', bridge)

    def test_bridge_queue_is_bounded_and_expired_jobs_are_cancelled(self) -> None:
        self.assertIn('queue.Queue(maxsize=2)', self.source)
        processor = self.source[
            self.source.index("def _submit_bridge_job") : self.source.index("class _BlendyBridgeHandler")
        ]
        self.assertIn("put_nowait", processor)
        self.assertIn("BLENDY_BRIDGE_MAX_JOBS_PER_TICK", processor)
        self.assertIn('job["cancelled"] = True', processor)
        self.assertIn('job.get("deadline"', processor)

    def test_discovery_is_readvertised_without_plaintext_project_path(self) -> None:
        discovery = self.source[
            self.source.index("def _write_bridge_discovery") : self.source.index("def _clear_bridge_discovery")
        ]
        self.assertNotIn('"blendPath"', discovery)
        self.assertIn("os.getpid()", discovery)
        launch = self.source[
            self.source.index("class LOCALAI_OT_LaunchBlendy") : self.source.index("class LOCALAI_OT_TestConnection")
        ]
        self.assertIn("_write_bridge_discovery(_BRIDGE_PORT)", launch)

    def test_visible_blender_panel_only_launches_desktop_path(self) -> None:
        panel = self.source[
            self.source.index("class LOCALAI_PT_Panel") : self.source.index("classes = (")
        ]
        self.assertIn('operator("local_ai_chat.launch_blendy"', panel)
        self.assertNotIn('operator("local_ai_chat.send"', panel)
        self.assertNotIn('prop(props, "backend_base_url"', panel)

    def test_legacy_model_operators_are_not_registered(self) -> None:
        registration = self.source[
            self.source.index("classes = (") : self.source.index("def register()")
        ]
        self.assertIn("LOCALAI_OT_LaunchBlendy", registration)
        self.assertNotIn("LOCALAI_OT_Send,", registration)
        self.assertNotIn("LOCALAI_OT_TestConnection,", registration)
        self.assertNotIn("LOCALAI_OT_CompactChat,", registration)


if __name__ == "__main__":
    unittest.main()
