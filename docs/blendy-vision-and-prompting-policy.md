# Blendy Vision And Prompting Policy

## Product Contract

Blendy is a natural local chat tutor for Blender with extra evidence attached.
It should feel like a normal chatbot that can also inspect Blender, not like a
scripted router.

On every non-empty Send, Blendy should provide:

- the user's natural-language prompt
- a Blender screen screenshot when Visual is enabled
- live Blender runtime and scene data
- read-only tool definitions for docs, workflow notes, and web lookup

## VLM Requirement

A VLM is a Vision-Language Model. In plain English, it is an LLM that can read
images as well as text.

Blendy can attach a screenshot to the model request, but the loaded local model
must support image input for that screenshot to be useful. A text-only model can
still answer from Blender scene data, but it cannot actually see the screenshot.

## Screenshot Rule

Do not use trigger phrases to decide whether the model gets a screenshot.

Auto mode means:

- if the prompt is empty, do not capture
- if the prompt is non-empty and Visual is enabled, capture the Blender screen
- if Scene Data Only is selected, do not capture

## Prompting Rule

Guardrails should protect honesty and evidence quality:

- do not claim Blendy can see the screen if no screenshot reached the model
- do not invent Blender state, UI locations, web results, or completed actions
- trust live screen/runtime/scene facts before docs and model memory

Guardrails should not replace the model's natural-language understanding:

- no screenshot trigger-word gates
- no mandatory model-facing route labels
- no treating workflow cards as commands

## Retrieval Rule

Do not preselect docs, workflow notes, troubleshooting notes, or web references
before the model sees the user's prompt.

The local model should decide whether it needs a read-only tool:

- `search_blender_docs`
- `search_workflow_notes`
- `web_search`
- `fetch_url`

Tool results are optional evidence. They should not appear as a mandatory route
or replace the user's natural-language intent.

## Web Rule

Default Tool Use mode is Auto. In that mode, Blendy offers web tools to the
local model and executes them only when the model requests them.

The model must not claim web access unless a `web_search` or `fetch_url` result
is present in the conversation.

Web should not be used to decide what is visible on the user's current Blender
screen. For live-screen questions, screenshot and runtime evidence win.

## Context Meter Rule

The context meter should count the real setup cost, including:

- base system and Blender context
- chat history
- tool definitions
- reserved space for tool calls/results
- screenshot/image reserve when a screenshot is attached
