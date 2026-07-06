import type { ContextSnapshot, Message } from "./types";

export const contextSnapshot: ContextSnapshot = {
  project: "Example Blender project",
  projectBriefPath: "Project Brief lives beside the user's saved .blend file",
  appDataPath: "Stored in the user's Blendy app data folder",
  units: "Millimeters",
  selectedObject: "Cube",
  mode: "Object Mode",
  dimensions: "75.0 x 145.0 x 8.2 mm",
  scale: "1.0, 1.0, 1.0",
  modifiers: [
    { name: "Bevel", detail: "Amount 0.01mm · 5 segments · viewport on" },
  ],
  materials: ["Material"],
  scene: "1 mesh · 1 camera · 2 lights",
  visual: "Viewport will be inspected for visual prompts",
  contextTokens: 6400,
  baselineTokens: 4900,
  conversationTokens: 1500,
  latestPromptTokens: 80,
  contextLimitTokens: 70000,
  contextPercent: 9,
  promptPacketPath: "",
  knowledgeMode: "LOCAL_AUTO_WEB",
  knowledgeModeLabel: "Local + Auto Web",
  docsIndexStatus: "official-seed-v1; official Blender docs entries available",
  lastWebLookupStatus: "Not checked in mock mode.",
  knowledgeConfidence: 0.86,
  knowledgeReliedOn: "live scene + local official docs + model memory fallback",
  selectedRoute: "troubleshooting",
  routeScore: 82,
  answerRisk: "low",
  veteranCardsStatus: "53 veteran cards loaded; 25 workflow shortcuts; 28 troubleshooting cards",
  selectedCards: ["Bevel Modifier Appears to Do Nothing", "Scale / Units Make Values Feel Wrong"],
  knowledgeSourceUrls: ["https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html"],
  knowledgeSources: [
    {
      title: "Bevel Modifier - Blender Manual",
      url: "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html",
      authority: "official",
      confidence: 0.86,
    },
  ],
  brief:
    "Beginner hard-surface modeling project. One clear checkpoint at a time. User works in millimeters.",
};

export const seedMessages: Message[] = [
  {
    id: "m1",
    role: "user",
    content:
      "I typed 0.01 into the bevel modifier and segments 5, but the shape still looks sharp. Does using millimeters matter?",
    context:
      "Used: Units mm · Cube selected · Bevel 0.01mm / 5 seg · Viewport inspected",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "Yes, the millimeters setting matters a lot here. A bevel of 0.01mm is so tiny that it can be technically present but still look sharp on screen.\n\nTry changing the Bevel Amount to 0.5mm first. If that looks too soft for the phone body, bring it down to 0.2mm. Keep the modifier unapplied for now so you can keep adjusting it while the shape develops.",
  },
  {
    id: "m3",
    role: "user",
    content:
      "Okay, I changed it to 0.5mm and I can see it now. What should I do next?",
    context:
      "Used: Units mm · Cube selected · Bevel 0.5mm / 5 seg",
  },
  {
    id: "m4",
    role: "assistant",
    content:
      "Good. Now focus on making the phone read like a clean product shape before adding details.\n\nSelect the front face area and start blocking in the screen inset. Use a very shallow inset so you get a visible screen border without cutting too deep into the body. The goal is not a finished screen yet; it is just to create the first clean panel line.",
  },
];
