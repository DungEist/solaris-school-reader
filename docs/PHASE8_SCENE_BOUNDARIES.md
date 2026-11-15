# Phase 8 scene-boundary regressions

Both regressions were reproduced and fixed through a fresh production Reader at `/?script=1001`. The browser used public mouse controls, including Settings → Instant text. It played the opening, 03/16 Morning → School year → Explore → Go out, then Places → Central Square without opening a destination script directly. Passive inspection recorded runner snapshots, event order, stage actor membership, and actual canvas identities. The address bar remained `?script=1001`; the active runner reached `1006` and `1008`.

## Relationship timing

| Character | Authored earned trigger | Before display | Correct completion | Confirm resumes |
| --- | --- | --- | --- | --- |
| Abby, role 12 | `1001/1`, SolarSchool action 5912, tier 0→1 | `1001/1` | After final dialogue `1001/22` and its end actions; runner `completed` | `1003/1` |
| Chisa, role 11 | Hidden option at `1004/1`, action 5911, tier 0→1 | `1004/2` | After final dialogue `1004/27`; runner `completed` | 03/16 Morning planning, day 2/slot 1 |

Source initialization sets favor to locked tier 0 with zero points. The two actions genuinely earn Acquainted; they are not restored existing levels. Before the fix, every delivered `favorLevel` immediately entered the visible confirmation queue. That exposed Abby's card at entry and Chisa's immediately after her hidden option.

The presentation now holds scene-earned tier notices until that scene's `completed` event. In the recorded after run, Abby earned at event 12; `1001/22` delivered its end-phase Exit for `who1316` at 129, finished dialogue at 131, then completed at 132. Chisa earned at 210; `1004/27` finished dialogue at 342 and completed at 343. Her earlier authored Exit at `1004/7` remains unchanged. Entry and final-dialogue captures contain no tier card. Each completion capture has one, with no pending stage actions.

The Reader's continuation gate retains the next authored task until Confirm. Confirm dismisses the notice without applying an action or reward. It also handles multiple earned tiers in one scene: Central Square's Cartethyia and Ciaccona cards appear consecutively after `1008` completes. Developer uses the same gameplay state without the Reader presentation gate.

Attaching a presentation observer to historical mutations suppresses tier announcements. Checkpoint restore retains the saved level and cannot redispatch its earned event. A fresh playthrough resets the tier and can earn it again. A delayed-end test grants a real item at its authored .25-second trigger, executes Exit at .75 seconds, and only then announces the queued tier.

## Actor handoff

The outgoing interior is `1004/completed`. Abby `who1316` remains authored in that interior, with its latest event at `1004/27`. Before the fix, continuation reset retained that actor in `StageState.characters`. The same mounted Abby canvas, ID 15 in the before observation, survived into the street and Central Square. A late asset callback was unnecessary to reproduce the bug.

| Actual runner location | Before rendered portraits | After rendered portraits |
| --- | --- | --- |
| `1006/1` | Abby1316 | None |
| `1006/6` | Abby1316 + Shorekeeper1398 | Shorekeeper1398 |
| `1008/5` | Abby1316 + Cartethyia50074 | Cartethyia50074 |
| `1008/54` | Abby1316 + Cartethyia50074 + Ciaccona150036 | Cartethyia50074 + Ciaccona150036 |

Continuation reset now clears actor membership and transition tracks while retaining `StoryState`, the run ID, and the event timeline. A separate scene identity changes on handoff. The visual stage's run/scene key disposes the old canvases, actors, animation frames, and load tickets. Within-scene dialogue changes retain the existing lifetime and the intended two-character composition.

In the after observation, outgoing Abby canvas 26 is explicitly removed with `connected=false`. The handoff retains run 1 and changes scene 4→5. Canvas26 is absent at street entry, after assets settle, at Shorekeeper's line, at both Central Square compositions, and after completion. A deferred-load regression also resolves old Abby/Chisa assets after a same-run handoff and verifies that neither portrait returns. Street entry's authored Rover avatar remains permitted.

## Retained playthrough state

| Checkpoint | Abby tier / points | Chisa tier / points | Feeling, attribute 5 | School Badges | Inventory |
| --- | --- | --- | --- | --- | --- |
| Outgoing Morning interior | 1 / 10 | 1 / 0 | 20 | 2,000 | Empty |
| Street `1006/1` | 1 / 10 | 1 / 0 | 20 | 2,000 | Empty |
| Central Square `1008/5` | 1 / 10 | 1 / 0 | 21 | 2,000 | Empty |
| After Central Square completion | 1 / 10 | 1 / 0 | 22 | 2,000 | Empty |

The street's Feeling +1 fires exactly once at `1006/13`, action 20000207. The separate action 20000211 at `1008/72` grants the later +1. The complete attribute, favor, and inventory maps match the before run at all four checkpoints; the fixes change presentation and actor lifetime without changing authored progression. History reopening preserves the completed state. Restoring the saved Morning checkpoint reproduces its full attribute/favor/inventory maps and shows no existing-tier card.

This opening route owns no items. Positive inventory preservation is separately checked with authored item 49 reward action 103090 in the engine boundary test; handoffs retain its quantity, favor, and route flags.

## Reproduction controls and captures

Choose the following public responses to reproduce the captured route:

| Script/node | Option or journey control |
| --- | --- |
| `1003/1` | Option 12 |
| `1003/6` | Option 15 |
| `1004/11` | Option 2 |
| `1004/16` | Option 6 |
| 03/16 Morning planning | School year → Explore → Go out, `explore:2` |
| `1006/12` | Option 2 |
| Street planning | Places → Central Square, `location:1015` |
| `1008/22` | Option 2 |
| `1008/44` | Option 6 |
| `1008/71` | Option 10 |

Advance through the other dialogue controls and confirm each completed-scene tier card. Both successful observations have 15 local JPEG captures. The compact [comparison](../test-results/phase8-boundaries/comparison.json) includes actual IDs, actor/canvas sets, earned/completed event order, state values, and capture paths. The [after report](../test-results/phase8-boundaries/after/result.json) and [event trace](../test-results/phase8-boundaries/after/trace.json) retain the full inspected snapshots.

| Capture | Before | After |
| --- | --- | --- |
| Abby tier | [Early card](../test-results/phase8-boundaries/before/captures/abby-card.jpg) | [Completed scene](../test-results/phase8-boundaries/after/captures/abby-card.jpg) |
| Chisa tier | [Early card](../test-results/phase8-boundaries/before/captures/chisa-card.jpg) | [Completed scene](../test-results/phase8-boundaries/after/captures/chisa-card.jpg) |
| Street entry | [Abby persists](../test-results/phase8-boundaries/before/captures/street-node-1.jpg) | [Clean entry](../test-results/phase8-boundaries/after/captures/street-node-1.jpg) |
| Shorekeeper | [Overlap](../test-results/phase8-boundaries/before/captures/street-node-6.jpg) | [Destination actor](../test-results/phase8-boundaries/after/captures/street-node-6.jpg) |
| Cartethyia | [Abby behind](../test-results/phase8-boundaries/before/captures/central-square-node-5.jpg) | [Destination actor](../test-results/phase8-boundaries/after/captures/central-square-node-5.jpg) |

REA evidence: before `ev_ce1acf1987841872184b405220c44de1388b01a29f8a4b77d9e4c193db4f4ff1`; after `ev_c651195d97f8f8c550aa935b1bc6e04cb99a325369530e904c6a9c0a1faaa378`. Both exited with code 0 with verified cleanup of their owned process group. Compact manifests are saved alongside each report. An intermediate after attempt is retained under `after-single-card-assertion`: it passed both requested regressions, then stopped because the harness incorrectly assumed that confirming Cartethyia would also remove Ciaccona's distinct queued card. The completed after report supersedes that attempt.

The complete suite passes 328 tests plus Python asset checks. It includes three successive school years with 44,749 public-controller inputs across 613 scenes and the existing ending routes. The focused boundary/presentation/portrait/UI run passes 51 tests, and the production build/typecheck passes. Logs are [full-tests.log](../test-results/phase8-boundaries/full-tests.log), [focused-tests.log](../test-results/phase8-boundaries/focused-tests.log), and [build.log](../test-results/phase8-boundaries/build.log). The browser harness is [phase8-boundary-browser-check.mjs](../tools/phase8-boundary-browser-check.mjs). No completion prerequisites remain unknown for these two regressions.
