import unittest
from pathlib import Path

from local_ai_chat import core


class CoreTests(unittest.TestCase):
    def test_truth_file_path_for_saved_blend(self) -> None:
        path = core.truth_file_path(Path("C:/Projects/Castle/castle.blend"))
        self.assertEqual(path, Path("C:/Projects/Castle/truth.md"))

    def test_truth_file_path_for_unsaved_blend(self) -> None:
        self.assertIsNone(core.truth_file_path(""))

    def test_endpoint_url_does_not_duplicate_v1(self) -> None:
        self.assertEqual(
            core.endpoint_url("http://localhost:1234/v1", "/chat/completions"),
            "http://localhost:1234/v1/chat/completions",
        )

    def test_default_model_is_auto_for_loaded_lm_studio_model(self) -> None:
        payload = core.build_chat_payload(
            model_name="",
            prompt="What should I do next?",
            truth_md="",
            scene_context="Active object: Cube",
        )

        self.assertEqual(core.DEFAULT_MODEL_NAME, "auto")
        self.assertEqual(payload["model"], "auto")

    def test_build_text_only_payload_uses_string_user_content(self) -> None:
        payload = core.build_chat_payload(
            model_name="gemma-test",
            prompt="What should I do next?",
            truth_md="Make a tower.",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.1",
            tool_references="Tool card: Bevel",
            scene_diff="- Cube dimensions: (2, 2, 2) -> (2, 4, 0.2)",
            recent_messages=[{"role": "assistant", "content": "Start with primitives."}],
        )

        self.assertEqual(payload["model"], "gemma-test")
        self.assertEqual(payload["messages"][-1]["role"], "user")
        self.assertIsInstance(payload["messages"][-1]["content"], str)
        self.assertIn("PROJECT BRIEF / TRUTH.MD", payload["messages"][-1]["content"])
        self.assertIn("omitted by default", payload["messages"][-1]["content"])
        self.assertNotIn("Make a tower.", payload["messages"][-1]["content"])
        self.assertIn("VISUAL CONTEXT", payload["messages"][-1]["content"])
        self.assertIn("ROUTER DECISION", payload["messages"][-1]["content"])
        self.assertIn("BLENDER VERSION LOCK", payload["messages"][-1]["content"])
        self.assertIn("Active Blender runtime version: 5.0.1", payload["messages"][-1]["content"])
        self.assertIn("Treat this as authoritative", payload["messages"][-1]["content"])
        self.assertIn("No viewport screenshot is attached", payload["messages"][-1]["content"])
        self.assertIn("BLENDER RUNTIME FACTS", payload["messages"][-1]["content"])
        self.assertIn("SEMANTIC SCENE CARD", payload["messages"][-1]["content"])
        self.assertIn("READ-ONLY VERIFICATION NOTES", payload["messages"][-1]["content"])
        self.assertIn("SCENE DIAGNOSTIC FLAGS", payload["messages"][-1]["content"])
        self.assertIn("KNOWLEDGE REFERENCES", payload["messages"][-1]["content"])
        self.assertIn("WEB REFERENCES", payload["messages"][-1]["content"])
        self.assertIn("WORKFLOW CARDS", payload["messages"][-1]["content"])
        self.assertIn("TROUBLESHOOTING CARDS", payload["messages"][-1]["content"])
        self.assertIn("BLENDER TOOL REFERENCES", payload["messages"][-1]["content"])
        self.assertIn("SCENE CHANGES SINCE LAST PROMPT", payload["messages"][-1]["content"])
        self.assertIn("Blender version: 5.0.1", payload["messages"][-1]["content"])
        self.assertIn("Tool card: Bevel", payload["messages"][-1]["content"])
        self.assertIn("Cube dimensions", payload["messages"][-1]["content"])
        self.assertEqual(payload["max_tokens"], core.DEFAULT_RESPONSE_MAX_TOKENS)

    def test_current_scene_context_is_prioritized_before_tool_refs(self) -> None:
        payload = core.build_chat_payload(
            model_name="gemma-test",
            prompt="What next?",
            truth_md="",
            scene_context="Active object: Phone_Body",
            runtime_facts="Blender version: 5.0.1",
            tool_references="Tool card: Bevel",
        )
        content = payload["messages"][-1]["content"]

        self.assertLess(
            content.index("CURRENT BLENDER SCENE CONTEXT"),
            content.index("BLENDER TOOL REFERENCES"),
        )

    def test_build_chat_payload_allows_response_token_override(self) -> None:
        payload = core.build_chat_payload(
            model_name="gemma-test",
            prompt="What should I do next?",
            truth_md="Make a tower.",
            scene_context="Active object: Cube",
            response_max_tokens=12000,
        )

        self.assertEqual(payload["max_tokens"], 12000)

    def test_project_brief_is_only_included_when_prompt_asks_for_it(self) -> None:
        generic = core.build_chat_payload(
            model_name="gemma-test",
            prompt="What should I do next?",
            truth_md="Make a tower.",
            scene_context="Active object: Cube",
        )
        explicit = core.build_chat_payload(
            model_name="gemma-test",
            prompt="What is the project goal from truth.md?",
            truth_md="Make a tower.",
            scene_context="Active object: Cube",
        )

        self.assertIn("omitted by default", generic["messages"][-1]["content"])
        self.assertNotIn("Make a tower.", generic["messages"][-1]["content"])
        self.assertIn("Make a tower.", explicit["messages"][-1]["content"])

    def test_system_prompt_requires_functional_tool_steps(self) -> None:
        self.assertIn("You are Blendy", core.SYSTEM_PROMPT)
        self.assertIn("vibe-coded local Blender tutor Frank made", core.SYSTEM_PROMPT)
        self.assertIn("Truth ladder", core.SYSTEM_PROMPT)
        self.assertIn("The user's latest prompt is the task", core.SYSTEM_PROMPT)
        self.assertIn("Trust live Blender runtime facts and screenshot evidence first", core.SYSTEM_PROMPT)
        self.assertIn("The live Blender version is a hard constraint", core.SYSTEM_PROMPT)
        self.assertIn("do not fall back to older-version UI memory", core.SYSTEM_PROMPT)
        self.assertIn("Preserve object roles the user establishes", core.SYSTEM_PROMPT)
        self.assertIn("Do not skip a part the user already made", core.SYSTEM_PROMPT)
        self.assertIn("answer the immediate contact relationship first", core.SYSTEM_PROMPT)
        self.assertIn("Preserve the named roles in the user's wording", core.SYSTEM_PROMPT)
        self.assertIn("do not collapse an intermediate part into a larger body", core.SYSTEM_PROMPT)
        self.assertIn("KNOWLEDGE REFERENCES and WEB REFERENCES", core.SYSTEM_PROMPT)
        self.assertIn("Use WORKFLOW CARDS as veteran Blender workflow wisdom", core.SYSTEM_PROMPT)
        self.assertIn("Use TROUBLESHOOTING CARDS", core.SYSTEM_PROMPT)
        self.assertNotIn("charger body -> port/cutout -> connector plug -> cable", core.SYSTEM_PROMPT)
        self.assertIn("prefer Curve objects with bevel depth", core.SYSTEM_PROMPT)
        self.assertIn("Project Brief / truth.md is optional memory", core.SYSTEM_PROMPT)
        self.assertIn("I can see", core.SYSTEM_PROMPT)
        self.assertIn("I'm inferring", core.SYSTEM_PROMPT)
        self.assertIn("I can't tell from the current Blendy context", core.SYSTEM_PROMPT)
        self.assertIn("startup defaults, preferences, future new files, or general app behavior", core.SYSTEM_PROMPT)
        self.assertIn("Name the Blender mode, tool/menu/operator", core.SYSTEM_PROMPT)
        self.assertIn("direct answer first", core.SYSTEM_PROMPT)
        self.assertIn("natural tutor voice", core.SYSTEM_PROMPT)
        self.assertIn("do not use those as visible section labels", core.SYSTEM_PROMPT)
        self.assertIn("not vague critique", core.SYSTEM_PROMPT)
        self.assertIn("complete Blender beginner", core.SYSTEM_PROMPT)
        self.assertIn("one clear checkpoint", core.SYSTEM_PROMPT)
        self.assertIn("explain it in one plain-English sentence", core.SYSTEM_PROMPT)
        self.assertIn("Answer directly in the visible assistant response", core.SYSTEM_PROMPT)
        self.assertIn("inspect the current screenshot and scene context first", core.SYSTEM_PROMPT)
        self.assertIn("Never imply you clicked, created, deleted, applied, fixed, or rendered anything yourself", core.SYSTEM_PROMPT)

    def test_prompt_stated_blender_version_becomes_version_lock(self) -> None:
        payload = core.build_chat_payload(
            model_name="gemma-test",
            prompt="I am on Blender 5.0. How do I bevel this?",
            truth_md="",
            scene_context="Active object: Cube",
            runtime_facts="",
        )

        content = payload["messages"][-1]["content"]
        self.assertIn("BLENDER VERSION LOCK", content)
        self.assertIn("User-stated Blender version: 5.0", content)
        self.assertIn("follow the user's stated version", content)

    def test_context_meter_helpers(self) -> None:
        self.assertEqual(core.estimate_tokens("abcd"), 1)
        self.assertEqual(core.estimate_tokens("abcde"), 2)
        self.assertEqual(core.context_percent(35000, 70000), 50)
        self.assertEqual(core.context_status(1000, 70000), "OK")
        self.assertEqual(core.context_status(56000, 70000), "WARN")
        self.assertEqual(core.context_status(64000, 70000), "DANGER")
        self.assertEqual(core.auto_compact_threshold(70000), 66500)

    def test_estimate_prompt_tokens_includes_history(self) -> None:
        without_history = core.estimate_prompt_tokens(
            prompt="Next step?",
            truth_md="Make a tower.",
            scene_context="Cube selected.",
        )
        with_history = core.estimate_prompt_tokens(
            prompt="Next step?",
            truth_md="Make a tower.",
            scene_context="Cube selected.",
            recent_messages=[{"role": "user", "content": "Previous question."}],
        )
        self.assertGreater(with_history, without_history)

    def test_chat_history_is_not_rolled_off_by_default(self) -> None:
        messages = [
            {"role": "user", "content": f"Message {index}"}
            for index in range(core.DEFAULT_HISTORY_MESSAGES + 3)
        ]

        trimmed = core.trim_chat_history(messages)

        self.assertEqual(len(trimmed), len(messages))
        self.assertEqual(trimmed[0]["content"], "Message 0")
        self.assertEqual(trimmed[-1]["content"], "Message 14")

    def test_build_vision_payload_uses_image_content_parts(self) -> None:
        payload = core.build_chat_payload(
            model_name="gemma-test",
            prompt="Look at this",
            truth_md="Make a tower.",
            scene_context="Active object: Cube",
            screenshot_data_url="data:image/png;base64,abc",
        )

        content = payload["messages"][-1]["content"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0]["type"], "text")
        self.assertIn("Viewport screenshot is attached", content[0]["text"])
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], "data:image/png;base64,abc")

    def test_should_send_screenshot_modes(self) -> None:
        self.assertTrue(
            core.should_send_screenshot(
                context_mode=core.CONTEXT_MODE_VIEWPORT,
                include_screenshot=True,
                prompt="Explain modifiers",
            )
        )
        self.assertFalse(
            core.should_send_screenshot(
                context_mode=core.CONTEXT_MODE_SCENE,
                include_screenshot=True,
                prompt="Does this look like a phone?",
            )
        )
        self.assertTrue(
            core.should_send_screenshot(
                context_mode=core.CONTEXT_MODE_AUTO,
                include_screenshot=True,
                prompt="Does this shape look like an iPhone?",
            )
        )
        self.assertFalse(
            core.should_send_screenshot(
                context_mode=core.CONTEXT_MODE_AUTO,
                include_screenshot=False,
                prompt="Does this shape look like an iPhone?",
            )
        )

    def test_tool_cards_are_targeted(self) -> None:
        cards = core.select_tool_cards(
            "I want to round the corners and make a screen border.",
            "Active object: Cube",
        )

        self.assertIn("Tool card: Bevel", cards)
        self.assertIn("Tool card: Inset", cards)
        self.assertNotIn("Tool card: Normals", cards)

    def test_tool_cards_do_not_match_inside_unrelated_words(self) -> None:
        cards = core.select_tool_cards(
            "How should I model this phone body slightly wider?",
            "Active object: Cube",
        )

        self.assertNotIn("Tool card: Object Mode vs Edit Mode", cards)
        self.assertNotIn("Tool card: Product Lighting", cards)

    def test_tool_cards_cover_apply_scale_and_modifiers(self) -> None:
        cards = core.select_tool_cards(
            "The bevel looks wrong after scaling. Should I apply scale?",
            "Active object: Phone_Body",
        )

        self.assertIn("Tool card: Apply Scale", cards)
        self.assertIn("Tool card: Bevel", cards)

    def test_tool_cards_cover_startup_units(self) -> None:
        cards = core.select_tool_cards(
            "How do I make Blender load in meters instead of mm on start?",
            "Project Brief says the current product project uses millimeters.",
        )

        self.assertIn("Tool card: Startup Units and New File Defaults", cards)
        self.assertIn("Save Startup File", cards)
        self.assertIn("Metric and Length to Meters", cards)

    def test_tool_cards_cover_bevel_troubleshooting(self) -> None:
        cards = core.select_tool_cards(
            "The bevel modifier does nothing.",
            "Active object: Cube\nScale: (4, 1, 1)",
        )

        self.assertIn("Tool card: Apply Scale", cards)
        self.assertIn("Tool card: Bevel Troubleshooting", cards)
        self.assertIn("Clamp Overlap", cards)

    def test_bevel_questions_include_apply_scale_when_scene_scale_is_not_one(self) -> None:
        cards = core.select_tool_cards(
            "Does this bevel look right?",
            "Active object: Cube\nScale: (4, 1, 1)\nModifier stack:\n- Bevel amount=0.01 segments=5",
        )

        self.assertIn("Tool card: Apply Scale", cards)
        self.assertIn("Tool card: Bevel", cards)

    def test_tool_cards_cover_camera_render_and_materials(self) -> None:
        camera_cards = core.select_tool_cards(
            "How do I frame the camera and make a render for the product shot?",
            "Scene has one mesh and one camera.",
        )
        material_cards = core.select_tool_cards(
            "I need a black glass material for the screen.",
            "Active object: Screen",
        )

        self.assertIn("Tool card: Camera Framing", camera_cards)
        self.assertIn("Tool card: Render Basics", camera_cards)
        self.assertIn("Tool card: Materials", material_cards)

    def test_tool_cards_do_not_carry_object_specific_charger_patches(self) -> None:
        cards = core.select_tool_cards(
            "Would it be smart to keep the small cube and turn it into the charging cable?",
            "Cube.001 selected. User made a connector cutout shape and a connector.",
        )

        self.assertNotIn("Tool card: Connector Assembly Reasoning", cards)
        self.assertNotIn("body -> port/cutout -> connector plug -> cable", cards)
        self.assertNotIn("Tool card: Flexible Cable With Curve", cards)

    def test_knowledge_retrieval_covers_flexible_cable_with_official_curve_docs(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="How should I make a flexible charging cable instead of a stiff cylinder?",
            scene_context="Cube.001 selected. User made a connector cutout shape and a connector.",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("Curve Geometry - Blender Manual", knowledge["knowledge_references"])
        self.assertIn("Bevel Depth", knowledge["knowledge_references"])
        self.assertIn("official Blender docs", knowledge["knowledge_references"])
        self.assertIn("Live Blender version available: 5.0.0", knowledge["verification_notes"])

    def test_knowledge_retrieval_covers_bevel_apply_scale_and_startup_units(self) -> None:
        bevel = core.retrieve_knowledge(
            prompt="The bevel modifier does nothing after I scaled the cube.",
            scene_context="Active object: Cube\nScale: (4, 1, 1)",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )
        startup = core.retrieve_knowledge(
            prompt="How do I make Blender load in meters instead of mm on start?",
            scene_context="Scene units are currently millimeters.",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("Apply - Blender Manual", bevel["knowledge_references"])
        self.assertIn("Bevel Modifier - Blender Manual", bevel["knowledge_references"])
        self.assertIn("non-unit scale", bevel["verification_notes"])
        self.assertIn("Defaults and Scene Units - Blender Manual", startup["knowledge_references"])
        self.assertIn("Save Startup File", startup["knowledge_references"])
        self.assertIn("future new files", startup["verification_notes"])

    def test_knowledge_retrieval_covers_camera_render_and_materials(self) -> None:
        camera = core.retrieve_knowledge(
            prompt="How do I frame the camera and render the final product image?",
            scene_context="Scene has one mesh and one camera.",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )
        material = core.retrieve_knowledge(
            prompt="I need a black glass material for the screen.",
            scene_context="Active object: Screen",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("Cameras - Blender Manual", camera["knowledge_references"])
        self.assertIn("Rendering and Output Properties - Blender Manual", camera["knowledge_references"])
        self.assertIn("Principled BSDF and Materials - Blender Manual", material["knowledge_references"])

    def test_version_sensitive_web_fallback_uses_official_current_sources(self) -> None:
        def fake_fetcher(url: str) -> dict[str, str]:
            if "blender.org/download" in url:
                return {
                    "title": "Blender Download",
                    "text": "Official Blender download page with current release information.",
                }
            return {
                "title": "Blender Release Notes",
                "text": "Official Blender release notes and version history.",
            }

        knowledge = core.retrieve_knowledge(
            prompt="What is the newest Blender release available today?",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_fetcher=fake_fetcher,
            allow_default_web=True,
        )

        web_refs = knowledge["web_references"]
        self.assertIn("www.blender.org/download", web_refs)
        self.assertIn("www.blender.org/download/releases", web_refs)
        self.assertIn("Web lookup used 2 official source", knowledge["verification_notes"])

    def test_ask_before_web_mode_does_not_fetch_and_tells_model_to_ask(self) -> None:
        def fake_fetcher(_url: str) -> dict[str, str]:
            raise AssertionError("Ask Before Web should not fetch.")

        knowledge = core.retrieve_knowledge(
            prompt="Where is this Blender 5.0 setting now?",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_ASK_BEFORE_WEB,
            web_fetcher=fake_fetcher,
            allow_default_web=True,
        )

        self.assertIn("Ask Before Web", knowledge["web_references"])
        self.assertIn("ask Frank before online lookup", knowledge["verification_notes"])

    def test_ask_before_web_runs_when_user_explicitly_approves_lookup(self) -> None:
        seen: list[str] = []

        def fake_fetcher(url: str) -> dict[str, str]:
            seen.append(url)
            return {
                "title": "Blender Download",
                "text": "Download Blender latest stable release information from the official Blender website.",
            }

        knowledge = core.retrieve_knowledge(
            prompt="Go look for the most recent Blender version available as of today.",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_ASK_BEFORE_WEB,
            web_fetcher=fake_fetcher,
            allow_default_web=True,
        )

        self.assertTrue(seen)
        self.assertIn("www.blender.org/download", seen[0])
        self.assertIn("Web lookup approved by user", knowledge["verification_notes"])
        self.assertIn("Blender Download", knowledge["web_references"])

    def test_explicit_web_request_bypasses_local_enough_gate(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            return [
                {
                    "title": "Pristine Edge workflow note",
                    "url": "https://example.com/pristine-edge-workflow",
                    "snippet": "A searched source mentions a pristine edge workflow for product modeling.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="do a web search on pristine edge",
            scene_context="Cube selected in Object Mode",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["pristine edge"])
        self.assertNotIn("Web lookup not needed", knowledge["web_references"])
        self.assertIn("https://example.com/pristine-edge-workflow", knowledge["web_references"])
        self.assertIn("general web search result", knowledge["web_references"])

    def test_non_blender_question_skips_blender_docs_and_searches_topic(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            return [
                {
                    "title": "Pristine Edge biography",
                    "url": "https://example.com/pristine-edge-actress",
                    "snippet": "Pristine Edge is an actress biography result from a broad web search.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="who is Pristine Edge the actress?",
            scene_context="Cube selected in Object Mode",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["Pristine Edge"])
        self.assertIn("no local official docs matched", knowledge["knowledge_references"])
        self.assertIn("https://example.com/pristine-edge-actress", knowledge["web_references"])

    def test_non_blender_lookup_ignores_active_scene_context(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            return [
                {
                    "title": "Pristine Edge profile",
                    "url": "https://example.com/pristine-edge",
                    "snippet": "Pristine Edge is a public figure profile result.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="who is pristine edge look her up online",
            scene_context="Active object: Cube\nSelected object: Cube\nMode: Object",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["pristine edge"])
        self.assertIn("no local official docs matched", knowledge["knowledge_references"])
        self.assertNotIn("Workflow card:", knowledge["workflow_cards"])
        self.assertNotIn("Troubleshooting card:", knowledge["troubleshooting_cards"])
        self.assertIn("https://example.com/pristine-edge", knowledge["web_references"])

    def test_plain_language_lookup_plans_entity_query(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            return [
                {
                    "title": "Pristine Edge profile",
                    "url": "https://example.com/pristine-edge-profile",
                    "snippet": "Pristine Edge profile result.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="just look up pristine edge actress and tell me",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["pristine edge"])
        self.assertIn("https://example.com/pristine-edge-profile", knowledge["web_references"])

    def test_plain_language_person_lookup_ignores_blender_edge_word(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            return [
                {
                    "title": "Pristine Edge profile",
                    "url": "https://example.com/pristine-edge-profile",
                    "snippet": "Pristine Edge profile result.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="web search for the female woman pristine edge",
            scene_context="Active object: Cube\nSelected object: Cube\nMode: Object",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["pristine edge"])
        self.assertIn("https://example.com/pristine-edge-profile", knowledge["web_references"])
        self.assertNotIn("Workflow card:", knowledge["workflow_cards"])

    def test_web_search_keeps_trying_when_first_query_results_are_irrelevant(self) -> None:
        seen_queries: list[str] = []

        def fake_searcher(query: str) -> list[dict[str, str]]:
            seen_queries.append(query)
            if query == "Pristine Edge":
                return [
                    {
                        "title": "Pristine Auction",
                        "url": "https://example.com/pristine-auction",
                        "snippet": "A sports memorabilia auction result.",
                    }
                ]
            return [
                {
                    "title": "Pristine Edge profile",
                    "url": "https://example.com/pristine-edge-profile",
                    "snippet": "Pristine Edge profile result.",
                }
            ]

        knowledge = core.retrieve_knowledge(
            prompt="who is Pristine Edge the actress?",
            scene_context="Active object: Cube",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
            web_searcher=fake_searcher,
            allow_default_web=True,
        )

        self.assertEqual(seen_queries, ["Pristine Edge", '"Pristine Edge"'])
        self.assertIn("Query: \"Pristine Edge\"", knowledge["web_references"])
        self.assertIn('"Pristine Edge"', knowledge["knowledge_status"]["webSearchUsedQueries"])

    def test_system_prompt_forbids_fake_web_claims_without_web_refs(self) -> None:
        self.assertIn("Never claim you searched Google", core.SYSTEM_PROMPT)
        self.assertIn("unless WEB REFERENCES contains actual retrieved source URLs", core.SYSTEM_PROMPT)
        self.assertIn("Do not say you lack a web search tool", core.SYSTEM_PROMPT)

    def test_uncertain_knowledge_tells_model_to_ask_one_question(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="What is the frobnicate slider for?",
            scene_context="Active object: Cube",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("no local official docs matched", knowledge["knowledge_references"])
        self.assertIn("ask one clarifying question", knowledge["verification_notes"])

    def test_veteran_cards_load_all_research_cards_with_schema(self) -> None:
        cards = core.load_veteran_cards()

        self.assertEqual(len(cards), 81)
        self.assertEqual(sum(1 for card in cards if card["type"] == "workflow_shortcut"), 38)
        self.assertEqual(sum(1 for card in cards if card["type"] == "troubleshooting"), 43)
        for card in cards:
            self.assertTrue(card["id"])
            self.assertIn(card["type"], {"workflow_shortcut", "troubleshooting"})
            self.assertTrue(card["tags"])
            self.assertIn(card["source_quality"], {"strong", "mixed", "weak"})
            self.assertIn(card["router_priority"], {"P0", "P1", "P2"})
            self.assertTrue(any(source["source_type"] == "official" for source in card["sources"]))
            joined = "\n".join(str(value).lower() for value in card.values())
            self.assertNotIn("youtube transcript", joined)
            self.assertNotIn("reddit thread dump", joined)

    def test_expanded_workflow_cards_select_uv_texture_shortcuts(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="My label gets skinny and stretched around the side. Is there a faster way to check the UVs?",
            scene_context="Active object: Product box\nMaterial image texture present\nMode: Object",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        titles = [card["title"] for card in knowledge["router_trace"]["workflowCards"]]
        self.assertTrue(
            any(title in titles for title in ("Checker Test Before Final Texture", "Hidden UV Seams for Product Textures"))
        )

    def test_expanded_troubleshooting_cards_select_missing_texture_path(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="I moved the blend file and now everything is pink and the textures disappeared",
            scene_context="Active object: Product box\nImage Texture nodes present\nMode: Object",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        titles = [card["title"] for card in knowledge["router_trace"]["troubleshootingCards"]]
        self.assertIn("Textures Turn Pink or Missing After Moving the Blend File", titles)

    def test_router_selects_bevel_troubleshooting_before_more_modeling(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="I added bevel but it still looks sharp.",
            scene_context=(
                "Active object: Cube\n"
                "Scale: (4, 1, 1)\n"
                "Modifier stack:\n"
                "- Bevel: BEVEL, viewport=on (width=0.001, segments=3)"
            ),
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertEqual(knowledge["router_trace"]["selectedRoute"], "troubleshooting")
        self.assertIn("Bevel Modifier Appears to Do Nothing", knowledge["troubleshooting_cards"])
        self.assertIn("Object scale is not 1,1,1", knowledge["scene_diagnostic_flags"])
        self.assertIn("Bevel Modifier for Realistic Edges", knowledge["workflow_cards"])
        selected = knowledge["knowledge_status"]["selectedCards"]
        self.assertLess(
            selected.index("Bevel Modifier Appears to Do Nothing"),
            selected.index("Bevel Modifier for Realistic Edges"),
        )

    def test_router_selects_workflow_shortcuts_for_manual_loop_pain(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="Do I need to move all 30 loops by hand to bend this cable?",
            scene_context="Active object: Cylinder\nObject type: MESH\nScale: (1, 1, 1)",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn(knowledge["router_trace"]["selectedRoute"], {"implementation", "planning_next_step"})
        self.assertTrue(
            any(
                title in knowledge["workflow_cards"]
                for title in (
                    "Straight Model First, Bend Later",
                    "Simple Deform for Bend / Twist / Taper",
                    "Lattice Cage for Broad Shape Changes",
                    "Proportional Editing for Smooth Local Push/Pull",
                    "Flexible Cable / Tube / Wire as a Curve",
                )
            )
        )

    def test_router_prefers_curve_workflow_for_flexible_cable(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="How do I make a flexible cable instead of this stiff cylinder?",
            scene_context="Active object: Cylinder\nObject type: MESH",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("Flexible Cable / Tube / Wire as a Curve", knowledge["workflow_cards"])
        self.assertIn("Dedicated cable-as-curve card matched", knowledge["workflow_cards"])
        self.assertIn("Curve Geometry - Blender Manual", knowledge["knowledge_references"])

    def test_part_relationship_choice_question_raises_assembly_role_flag(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="I made a small cube as the connector. Should the cable plug into the charger body or the connector?",
            scene_context="User made a connector cube and charger body. Active object: Camera",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("User-defined part relationship may matter", knowledge["scene_diagnostic_flags"])
        self.assertIn("check_immediate_contact_chain", knowledge["scene_diagnostic_flags"])

    def test_generic_part_relationship_choice_without_connector_terms_is_flagged(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="Should this handle attach to the side panel or the top piece?",
            scene_context="User has a handle object, side panel, and top piece.",
            runtime_facts="Blender version: 5.0.1",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertIn("User-defined part relationship may matter", knowledge["scene_diagnostic_flags"])

    def test_router_selects_wrong_mode_troubleshooting_for_missing_tools(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="I pressed the tool but it is missing and nothing happens.",
            scene_context="Active object: Cube\nMode: Object",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertEqual(knowledge["router_trace"]["selectedRoute"], "troubleshooting")
        self.assertIn("Wrong Mode or Object Selection Makes Tools Missing", knowledge["troubleshooting_cards"])
        self.assertIn("Mode or selection may control the result", knowledge["scene_diagnostic_flags"])

    def test_startup_units_route_uses_docs_not_modeling_cards(self) -> None:
        knowledge = core.retrieve_knowledge(
            prompt="How do I make Blender load in meters instead of mm on start?",
            scene_context="Scene units are millimeters.",
            runtime_facts="Blender version: 5.0.0",
            knowledge_mode=core.KNOWLEDGE_MODE_LOCAL_ONLY,
        )

        self.assertEqual(knowledge["router_trace"]["selectedRoute"], "settings_version_docs")
        self.assertIn("Defaults and Scene Units - Blender Manual", knowledge["knowledge_references"])
        self.assertIn("[no workflow shortcut cards selected]", knowledge["workflow_cards"])
        self.assertIn("[no troubleshooting cards selected]", knowledge["troubleshooting_cards"])

    def test_context_breakdown_includes_tool_refs(self) -> None:
        breakdown = core.context_breakdown(
            prompt="How do I bevel this?",
            truth_md="Make an iPhone.",
            scene_context="Cube selected.",
            runtime_facts="Blender version: 5.0.1",
            tool_references="Tool card: Bevel",
            router_decision="Selected route: troubleshooting",
            scene_diagnostic_flags="- Object scale is not 1,1,1",
            workflow_cards="- Card: Bevel Modifier for Realistic Edges",
            troubleshooting_cards="- Card: Bevel Modifier Appears to Do Nothing",
            knowledge_references="Title: Bevel Modifier - Blender Manual",
            web_references="Title: Bevel - live official docs",
            semantic_scene_card="Latest task: How do I bevel this?",
            verification_notes="Live Blender version available: 5.0.1.",
            scene_diff="- Bevel modifier added.",
            compacted_summary="We made a base rectangle.",
            recent_messages=[{"role": "assistant", "content": "Use a cube."}],
        )

        self.assertGreater(breakdown["Tool refs"], 0)
        self.assertGreater(breakdown["Router"], 0)
        self.assertGreater(breakdown["Scene flags"], 0)
        self.assertGreater(breakdown["Workflow cards"], 0)
        self.assertGreater(breakdown["Troubleshooting cards"], 0)
        self.assertGreater(breakdown["Knowledge refs"], 0)
        self.assertGreater(breakdown["Web refs"], 0)
        self.assertGreater(breakdown["Semantic scene"], 0)
        self.assertGreater(breakdown["Verification"], 0)
        self.assertGreater(breakdown["Scene diff"], 0)
        self.assertGreater(breakdown["Recent chat"], 0)

    def test_scene_snapshot_diff_reports_meaningful_changes(self) -> None:
        previous = {
            "active_object": {"name": "Cube"},
            "selected_objects": ["Cube"],
            "object_counts": {"MESH": 1},
            "objects": {
                "Cube": {
                    "dimensions": [2.0, 2.0, 2.0],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                    "mesh": {"vertices": 8, "edges": 12, "faces": 6},
                    "modifiers": [],
                    "materials": [],
                    "visible": True,
                }
            },
        }
        current = {
            "active_object": {"name": "Phone_Body"},
            "selected_objects": ["Phone_Body"],
            "object_counts": {"MESH": 1},
            "objects": {
                "Phone_Body": {
                    "dimensions": [2.0, 4.0, 0.2],
                    "location": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                    "mesh": {"vertices": 16, "edges": 24, "faces": 14},
                    "modifiers": [{"name": "Bevel", "type": "BEVEL", "show_viewport": True}],
                    "materials": ["Black Glass"],
                    "visible": True,
                }
            },
        }

        diff = core.scene_snapshot_diff(previous, current)

        self.assertIn("Active object changed", diff)
        self.assertIn("Objects added: Phone_Body", diff)
        self.assertIn("Objects removed: Cube", diff)

    def test_scene_snapshot_diff_reports_no_major_changes(self) -> None:
        snapshot = {
            "active_object": {"name": "Cube"},
            "selected_objects": ["Cube"],
            "object_counts": {"MESH": 1},
            "objects": {"Cube": {"dimensions": [2.0, 2.0, 2.0]}},
        }

        self.assertEqual(
            core.scene_snapshot_diff(snapshot, snapshot),
            "No major scene changes detected since last prompt.",
        )

    def test_scene_snapshot_json_round_trip(self) -> None:
        snapshot = {"active_object": {"name": "Cube"}, "objects": {"Cube": {}}}
        raw = core.dump_scene_snapshot(snapshot)
        self.assertEqual(core.load_scene_snapshot(raw), snapshot)
        self.assertIsNone(core.load_scene_snapshot("{broken"))

    def test_parse_chat_response_string_content(self) -> None:
        response = {"choices": [{"message": {"content": "Use bevels."}}]}
        self.assertEqual(core.parse_chat_response(response), "Use bevels.")

    def test_parse_chat_response_recovers_reasoning_only_final_answer(self) -> None:
        response = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "reasoning_content": (
                            "\n*   Thinking about the user's units.\n"
                            "\n"
                            "    *   *Final plan*:\n"
                            "        1. Goal\n"
                            "        Make the bevel visible in millimeters.\n"
                            "\n"
                            "        2. Next tool\n"
                            "        Bevel Modifier (Amount).\n"
                            "\n"
                            "        3. Exact steps\n"
                            "        Type 1mm into Amount and press Enter.\n"
                            "\n"
                            "    *   *Wait, do not include this scratchpad note.*\n"
                        ),
                    },
                    "finish_reason": "length",
                }
            ]
        }

        parsed = core.parse_chat_response(response)

        self.assertIn("1. Goal", parsed)
        self.assertIn("Make the bevel visible", parsed)
        self.assertIn("Type 1mm", parsed)
        self.assertNotIn("scratchpad", parsed)

    def test_format_chat_display_text_removes_markdown_and_scaffold_labels(self) -> None:
        raw = (
            "**1. What I Think you are trying to make**\n"
            "The phone body.\n"
            "**2. Next tool/mode to use**\n"
            "**Object Mode** using the **Scale** tool.\n"
            "```python\nprint('no')\n```"
        )

        formatted = core.format_chat_display_text(raw)

        self.assertNotIn("**", formatted)
        self.assertNotIn("```", formatted)
        self.assertNotIn("Goal", formatted)
        self.assertNotIn("Next tool", formatted)
        self.assertIn("Object Mode using the Scale tool.", formatted)
        self.assertIn("The phone body.", formatted)

    def test_wrap_for_sidebar_uses_clean_display_text(self) -> None:
        lines = core.wrap_for_sidebar(
            "**1. What I think you are trying to make**\nBody\n**2. Exact steps**\nDo it",
            width=60,
            max_lines=20,
        )

        joined = "\n".join(lines)
        self.assertNotIn("**", joined)
        self.assertNotIn("Goal", joined)
        self.assertNotIn("Exact steps", joined)
        self.assertIn("Body", joined)
        self.assertIn("Do it", joined)

    def test_format_chat_display_text_cleans_old_numbered_tutor_scaffold(self) -> None:
        raw = (
            "1. Goal\n"
            "Make the bevel visible on your phone edges.\n\n"
            "2. Next tool\n"
            "Bevel Modifier (Amount setting).\n\n"
            "3. Exact steps\n"
            "1. Select the Cube.\n"
            "2. Change Amount to 0.05.\n\n"
            "4. Check\n"
            "The edges should now look rounded.\n\n"
            "5. If it looks wrong\n"
            "Do not click Apply yet."
        )

        formatted = core.format_chat_display_text(raw)

        self.assertNotIn("1. Goal", formatted)
        self.assertNotIn("2. Next tool", formatted)
        self.assertNotIn("3. Exact steps", formatted)
        self.assertNotIn("4. Check", formatted)
        self.assertNotIn("5. If it looks wrong", formatted)
        self.assertIn("Make the bevel visible", formatted)
        self.assertIn("Change Amount to 0.05", formatted)
        self.assertIn("Do not click Apply yet.", formatted)

    def test_compaction_payload_contains_existing_summary(self) -> None:
        payload = core.build_compaction_payload(
            model_name="gemma-test",
            existing_summary="We are making a stylized tower.",
            messages=[{"role": "user", "content": "How do I add windows?"}],
        )

        user_content = payload["messages"][1]["content"]
        self.assertIn("Existing compacted summary", user_content)
        self.assertIn("How do I add windows?", user_content)


if __name__ == "__main__":
    unittest.main()
