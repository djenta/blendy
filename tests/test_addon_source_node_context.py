import unittest
from pathlib import Path


class AddonSourceNodeContextTests(unittest.TestCase):
    def setUp(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.source = (repo_root / "local_ai_chat" / "__init__.py").read_text(encoding="utf-8")

    def test_bridge_prefers_full_blender_screen_capture(self) -> None:
        screenshot_function = self.source[self.source.index("def _capture_screenshot_data_url") :]

        self.assertIn("bpy.ops.screen.screenshot(filepath=path", screenshot_function)
        self.assertIn("hide_props_region=False", screenshot_function)
        self.assertIn("if not captured:", screenshot_function)
        self.assertLess(
            screenshot_function.index("bpy.ops.screen.screenshot(filepath=path"),
            screenshot_function.index("bpy.ops.screen.screenshot_area(filepath=path)"),
        )

    def test_scene_context_includes_node_tree_inventory(self) -> None:
        self.assertIn("def _node_tree_summary", self.source)
        self.assertIn("Node/editor context:", self.source)
        self.assertIn("Visible node editor", self.source)
        self.assertIn("Scene compositor node tree", self.source)
        self.assertIn("Material node tree", self.source)
        self.assertIn("Geometry node tree from modifier", self.source)


if __name__ == "__main__":
    unittest.main()
