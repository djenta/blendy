# Blendy Live Validation Checklist

Use this after the rebuild when Blender and LM Studio are available. The goal is
to test Blendy during a real project, not just with easy one-question demos.

## Before The Project

1. Load the normal Gemma 4 vision model in LM Studio and start the local server.
2. Open one ordinary Blender project and launch Blendy.
3. Confirm the composer says the full screen and scene are ready.
4. Open the context menu. Confirm it separately shows the configured limit, the
   loaded model limit, answer reserve, and estimated next request.

## Test 1: Exact Mode Wins

1. Stay in Object Mode and ask: `What mode am I in, and what should I do next?`
2. Switch to Edit Mode, select a few faces, and ask the same question.
3. Return to Object Mode and ask: `Am I still in Edit Mode?`

Pass: every answer agrees with Blender's actual mode and selection.

Red flag: Blendy repeats an older mode because it appeared earlier in chat.

## Test 2: Whole-Screen Understanding

1. Keep the active object visible in the viewport.
2. Also leave useful information visible elsewhere, such as the Outliner,
   modifier panel, mode selector, or transform values.
3. Ask: `Look at my whole Blender window. What is the most important thing I
   should notice before I continue?`

Pass: the answer can use both the visible shape and UI/scene information. Its
receipt says a full-window image actually reached the model.

Red flag: it talks only about the selected object's raw vertex count or claims
it saw an image when the receipt says it did not.

## Test 3: Complex Project Continuity

1. Start a small multi-part prop, such as a flash grenade.
2. Tell Blendy the complete goal, intended style, and whether the result is for
   a game, render, or 3D print.
3. Follow at least eight checkpoints, including separate body, cap, lever, pin,
   and safety-ring objects.
4. Deliberately ask vague follow-ups such as `what next?`, `does this look
   right?`, and `where should this attach?`

Pass: Blendy remembers the end goal, recognizes nearby parts and relationships,
and gives one useful next checkpoint with a clear "done when" check.

Red flag: it forgets what object a part belongs to, restarts the project, or
turns a rejected suggestion into the new plan.

## Test 4: Correction Recovery

1. Let Blendy recommend a shape or workflow.
2. Correct it plainly: `No, I mean the circular pin, not the square lever.`
3. Continue for two more turns.

Pass: the rejected answer stops influencing later guidance. The correction does
not need to be repeated.

## Test 5: Reference Continuity

1. Attach a named reference photo.
2. Ask Blendy to identify the major forms.
3. Continue for several messages without reattaching the photo.
4. Regenerate one answer.

Pass: the reference remains visibly attached and is named correctly in each
relevant turn until removed. A retry uses the same reference.

Red flag: Blendy confuses the reference with the live Blender screenshot or the
attachment vanishes after the first send.

## Test 6: Long Context And Compaction

1. Continue until the conversation has a substantial history.
2. Compare `Estimated next request` with `Last request measured` after several
   turns.
3. Trigger compaction manually once, or let automatic compaction occur near the
   safe threshold.
4. Scroll upward afterward.

Pass: the complete transcript is still visible and stored. Earlier messages are
summarized only for model input, and the context menu reports how many messages
are recent, summarized, and stored.

Red flag: old visible messages disappear or the context meter presents an
estimate as an exact measurement.

## Test 7: Failure Truthfulness

Try one condition at a time:

- make the Blender bridge unavailable;
- use a model without vision support;
- cause the full-window capture to fail;
- cancel an answer midway;
- retry after an answer failure.

Pass: Blendy says exactly what did and did not reach the model. It never claims
it saw the screen when it did not. Cancelled and failed drafts do not influence
the next answer.

## What To Save When Something Goes Wrong

Write down:

- the exact question;
- what Blender mode you were actually in;
- what the context/evidence strip showed;
- the receipt under the answer;
- the context menu's measured previous-request value;
- whether the wrong idea had appeared earlier in the chat.

The diagnostic prompt packet intentionally contains text and evidence metadata,
not screenshot or reference-image pixels.
