import json
import unittest
from pathlib import Path


class AddonSourceNodeContextTests(unittest.TestCase):
    def setUp(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.source = (repo_root / "local_ai_chat" / "__init__.py").read_text(encoding="utf-8")
        package = json.loads((repo_root / "blendy" / "package.json").read_text(encoding="utf-8"))
        self.desktop_version = str(package["version"])

    def test_bridge_prefers_full_blender_screen_capture(self) -> None:
        screenshot_function = self.source[self.source.index("def _capture_screenshot_data_url") :]

        self.assertIn("bpy.ops.screen.screenshot(filepath=path", screenshot_function)
        self.assertIn("hide_props_region=False", screenshot_function)
        self.assertIn("_ordered_blender_windows(context)", screenshot_function)
        self.assertIn("if not captured:", screenshot_function)
        self.assertLess(
            screenshot_function.index("bpy.ops.screen.screenshot(filepath=path"),
            screenshot_function.index("bpy.ops.screen.screenshot_area(filepath=path)"),
        )

    def test_capture_temp_files_are_removed_after_overview_and_focused_capture(self) -> None:
        overview = self.source[
            self.source.index("def _capture_screenshot_data_url") : self.source.index("def _capture_active_area_data_url")
        ]
        focused = self.source[
            self.source.index("def _capture_active_area_data_url") : self.source.index("def _scene_unit_label")
        ]
        self.assertIn("finally:", overview)
        self.assertIn("os.remove(path)", overview)
        self.assertIn("finally:", focused)
        self.assertIn("os.remove(path)", focused)

    def test_addon_and_bridge_versions_match_desktop_release(self) -> None:
        version_tuple = ", ".join(self.desktop_version.split("."))
        self.assertIn(f'"version": ({version_tuple})', self.source)
        self.assertIn(f'server_version = "BlendyBridge/{self.desktop_version}"', self.source)

    def test_scene_context_includes_node_tree_inventory(self) -> None:
        self.assertIn("def _node_tree_summary", self.source)
        self.assertIn("Node/editor context:", self.source)
        self.assertIn("Visible node editor", self.source)
        self.assertIn("Scene compositor node tree", self.source)
        self.assertIn("Material node tree", self.source)
        self.assertIn("Geometry node tree from modifier", self.source)

    def test_context_line_does_not_call_an_unselected_active_object_selected(self) -> None:
        context_line = self.source[
            self.source.index("def _bridge_context_line") : self.source.index("def _bridge_should_capture_screenshot")
        ]
        self.assertIn("active.select_get()", context_line)
        self.assertIn('active (not selected)', context_line)


if __name__ == "__main__":
    unittest.main()
