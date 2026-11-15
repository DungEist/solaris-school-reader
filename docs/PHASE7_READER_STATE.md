# Phase 7 reader interfaces and story state

Historical report. Its limited condition coverage and unresolved precedence are superseded by [the current route verification](ROUTE_DATA_EVIDENCE.md), [original dispatcher evidence](ROUTE_DISPATCHER_EVIDENCE.md), and [Reader consequences](READER_CONSEQUENCES.md). Preserve the Phase 7 observations as evidence of that earlier implementation, rather than current feature limits.

The reader is **http://127.0.0.1:5173/** and the developer interface is **http://127.0.0.1:5173/debug**. Both accept the existing `?script=<id>` links. Click Begin reading in the reader, or Start fresh in the developer interface. The header links switch views within the page without loading another script, changing run/visit IDs, clearing History, or constructing another engine. Browser Back/Forward between those views also preserves playback. Opening another tab or reloading creates a separate, fresh in-memory session.

The reader uses a stage with a dialogue overlay on desktop. Choices, quizzes, and mobile dialogue use an attached panel that can grow naturally. History and Settings are native modals with focus restoration and synchronous input guards. Text/stage clocks continue while either is open. IDs, asset diagnostics, stage inspection, event logs, script selection, transition previews, and explicitly labeled branch/result overrides remain in the developer interface. Missing reader text/images use short readable fallbacks; hidden localization keys never become choices.

## Evidence and supported semantics

Architecture, SPEC, the Phase 3 hidden-choice audit, Phases 4–6, input-guard report, and current character integrations were read first. Source is `WutheringWaves_Data`, branch `3.8`, revision `49d65625340a32cec6851a12baedc03b5a630b25` as recorded by the earlier audits. Raw TalkItem option Actions/TypeParams/PreCondition, ordered performances, ActivityAction/client types, ActivityCondition/groups, rewards/reward groups, items, AVG parameters, ending-flow transitions, and all 11 hidden nodes were inspected.

`build_data.py` exports `maps/story-source.json`, retaining original row IDs, group `Logic`/`GroupId`, and string parameters. Missing/malformed definitions leave conditions unknown and produce a developer diagnostic. The engine consumes this export through the existing repository rather than reading game tables at runtime. `tools/audit_hidden_branches.py` produces the complete local trace at `test-results/phase7-hidden-branches.json`.

| Source evidence | Implemented behavior |
| --- | --- |
| ActivityAction type 2 names a `SolarSchoolRewardId`, resolved through `solarschoolrewards.RewardIds` to reward rows. Type 2 reward targets align with the item table and the acquisition popup IDs. | Apply inventory grants with source `TargetId`, `Value`, and `StackLimit`. Other reward types remain metadata. |
| ActivityAction type 13 explicitly sets AVG variables using `Params`, e.g. action 10024: `key31=true`. | Apply the literal boolean assignment to its original key. Malformed/unsupported expressions remain unresolved. |
| ActivityAction type 28 is **显示道具获取弹窗**: show item-acquisition popup. | Preserve the popup as metadata; it does not grant an item again. |
| `PlotOptionId` → AVG writes and `PlotKeyId` writes are hypotheses in SPEC and the research correction. No source action establishes those implicit assignments. | Record choices with original IDs; do not infer flag writes from selection, display, or reveal. |
| Hidden groups have one ActivityCondition leaf with `Logic=0`. Earlier audits establish 0=AND / 1=OR. Group entries are condition IDs. | Evaluate AND/OR with true/false/unknown, preserving decisive operands and unknowns. Support type 10 item possession, type 15 explicit AVG comparison, and type 30 observed ending achievement. Other types/structures remain unknown. |
| Every hidden node has a conditioned first option and an option without PreCondition. No priority/default rule is exported. ActivityAction `Priority` belongs to game actions, not option selection. | Select only one true candidate with every competitor false. Multiple matches, or a default competing with an unknown, stay unresolved. A known false condition can leave a unique unconditional candidate without needing a precedence rule. No first-match rule is assumed. |
| ActivityAction type 1 uses an explicit `SolarSchoolFlow` parameter, but **none of the performances in these 429 scripts references a type 1 action**. Some numeric action IDs overlap flow IDs. Ending-flow transitions also require management state. | No cross-script continuation is invented. Numeric overlaps are not calls. Source `option.next`, including FinishTalk, retains the existing talk-block behavior. Loading another script with retained state is an explicitly labeled developer investigation action. |

`StoryState.ts` holds immutable inventory bounds, explicit AVG values, and ending observations. Unobserved inventory has an unknown baseline. A capped grant can establish a definite count; a partial grant establishes a lower bound. Missing AVG variables and ending achievements stay unknown. No source performance here establishes an ending achievement, so ending 4 remains unavailable. None of the 11 hidden groups directly reads a prior option/AVG flag: ten read inventory obtained on other source routes; one reads an ending achievement.

## Hidden branch inventory

**Automatically resolved in a fresh session: 0 / 11.** This is an evidence limit, not an arbitrary fallback. The resolver is exercised with determined, ambiguous, and incomplete conditions in focused tests. Acquiring the required item makes its condition true, but still leaves the unconditional option competing under unverified precedence.

All 22 options have source `next: seq`; there are no JumpTalk/FinishTalk actions in these hidden options. Explicit empty strings and absent hidden text stay hidden.

| Script / node | Group → leaf | Dependency | Source acquisition route / phase | Option IDs | Classification |
| --- | --- | --- | --- | --- | --- |
| 1004 / 1 | 26100048 → 16100048 | item 10 × 1 | 4015 / 7 start; action 3510 → reward 60010 | 11 / 12 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1008 / 21 | 26100040 → 16100040 | item 7 × 1 | 4017 / 9 start; 3507 → 60007 | 14 / 15 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1008 / 53 | 26100045 → 16100045 | item 3 × 1 | 4021 / 4 start; 3503 → 60003 | 17 / 18 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1009 / 5 | 26100039 → 16100039 | item 8 × 1 | 4019 / 2 start; 3508 → 60008 | 17 / 18 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1010 / 5 | 26100041 → 16100041 | item 6 × 1 | 4008 / 3 start; 3506 → 60006 | 27 / 28 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1010 / 25 | 26100046 → 16100046 | item 2 × 1 | 4023 / 7 start; 3502 → 60002 | 18 / 19 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1011 / 29 | 26100044 → 16100044 | item 4 × 1 | 4006 / 6 end; 3504 → 60004 | 7 / 8 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1014 / 16 | 26100042 → 16100042 | item 5 × 1 | 4010 / 3 start; 3505 → 60005 | 7 / 8 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1014 / 26 | 26100043 → 16100043 | item 2 × 1 | 4023 / 7 start; 3502 → 60002 | 10 / 11 | Unavailable inventory; after grant, blocked by unverified precedence |
| 1034 / 43 | 26100047 → 16100047 | item 1 × 1 | 4003 / 5 end; 3501 → 60001 | 37 / 38 | Unavailable inventory; after grant, blocked by unverified precedence |
| 3010 / 35 | 29000111 → 19000111 | ending 4 achieved | No supported achievement mutation in these scripts | 2 / 3 | Dependent on unavailable ending state; fallback precedence also unverified |

The full trace includes both options' ActivityAction definitions and reward joins. At `1004/1`, option 11 schedules `[5911,5913,5911,5914,5911]` at 0/.05/.1/.15/.2 seconds; option 12 schedules 5911 once. These are favor upgrades/favor rewards, outside this phase's state model. They remain scheduled and logged once. All other hidden option consequences likewise retain their original phase, IDs, repetitions, and unknown game effects.

## Execution and lifecycle

One `ScriptRunner` still owns navigation, quizzes, scheduler delivery, and stage events. One `ManualReader` owns reveal; one `DialogueBacklog` owns readable history. React only projects snapshots. Story mutations execute when the source ActivityAction performance is delivered in its start/option/end phase. A selected option's actions are not applied by displaying text or completing reveal. Each scheduler task is removed before delivery; restart/load cancel abandoned callbacks. A `storyMutation` record links to the original stage-event sequence and action ID.

Determined hidden branches with spoken text remain readable until explicit Advance, then record an automatic decision and schedule that option. This manual-reader boundary is a documented reader policy, not observed game auto-selection timing. A determined silent hidden node can proceed without input. Unresolved nodes stay at their dialogue, explain the missing information briefly, and link to the developer view. Overrides claim no eligibility. `decision: player | automatic | debug-override` distinguishes records; automatic hidden text and overrides never enter player-response History.

| Action | Playback / History | Story state |
| --- | --- | --- |
| Header view switch, Back/Forward between views, profile/text settings, History | Preserve; clocks continue | Preserve |
| Advance / player choice / automatic resolved decision | Existing source navigation and scheduled phases | Apply only supported delivered consequences |
| Restart | New run, fresh stage/reveal/quiz/history/events | Roll back to this script's entry checkpoint, then replay source operations |
| Start fresh / Begin reading; `load()` default | Fresh script playback | Forget prior facts; establish a fresh unknown checkpoint |
| Developer “Load selected script, preserve story state”; `load(...,{preserveStoryState:true})` | Fresh playback of explicitly selected script | Preserve current facts as its entry checkpoint |
| Reset all story state and replay | Fresh playback of current script | Forget all facts and replace the checkpoint, then replay |
| Reload / new tab | Fresh session | No persistence |

Preferences remain in page memory across restart/script loads. Story state is separate from persistent-within-playback `StageState`. There are no save slots, browser storage writes, audio/video additions, or management simulation.

## Verification and exact playtests

`npm test`: **214 passing tests**, including all-character, reveal/history/quiz, structural real-data and timing suites; Python asset preparation checks pass. `npx tsc --noEmit` passes. `npm run build` passes. The focused story suite covers prior choice consequences, source end-phase grants, literal AVG writes, unknown/malformed conditions, AND/OR, multiple matches, unverified fallback priority, stale/duplicate inputs, restart/checkpoint/fresh resets, raw export fidelity, numeric flow-ID collisions, all 11 hidden nodes, and `17048/2` optionId 5. React render tests cover reader/debug separation and long text without replaying events.

Five completed controlled REA Chromium scenarios (143 declared actions) against the existing Vite server verified real reader/debug routes, run/node preservation, History/Settings keyboard isolation and focus restoration, hidden override performance counts, source item grants retained across script switching/restart, mobile rapid FinishTalk selection, three source quiz results, and 285-character opening text. Screenshots at 1280-wide desktop and 390×844 mobile were visually reviewed. Completed captures contain no page errors or error-level console events. Headless WebGL emitted performance warnings during screenshot readback. Complete evidence and a compact verification summary are in `test-results/phase7-browser-*.json` and `test-results/phase7-browser-summary.json`.

The managed shell cannot bind loopback HTTP (`listen EPERM`). REA could launch Chromium and reach an **already-running** Vite server. The standalone browser harness failed to launch under the managed shell (`setsockopt EPERM`, then `ECONNRESET`), recorded at `test-results/phase7-browser-results.json`; the new `npm run test:browser:interfaces` checks route projection, modals/focus, FinishTalk, hidden controls, and desktop/mobile overflow in an unrestricted terminal. Legacy browser modes now open `/debug`; their file fallback explicitly does not test HTTP routing. This phase did not verify physical mobile devices, Safari/Firefox, assistive technology, production HTTP delivery, or fidelity against the running game. Native Back/Forward and extreme synthetic-text scrolling are not claimed as browser playtests; route/render and text tests cover their underlying logic.

Exact review routes (all start explicitly):

- Reader [1004](http://127.0.0.1:5173/?script=1004), developer [1004](http://127.0.0.1:5173/debug?script=1004): readable hidden dialogue; unresolved notice; switch views without restarting; override 11 once and reach node 2 with five option performances. Restart restores the entry checkpoint.
- Developer [4015](http://127.0.0.1:5173/debug?script=4015): Start fresh, Advance six times to node 7, inspect item 10 `[1,1]`. Select 1004 and press **Load selected script, preserve story state**. Its condition is true, but automatic selection remains blocked by competing default precedence. These are investigation steps, not asserted story order.
- Reader [4003](http://127.0.0.1:5173/?script=4003), developer [4003](http://127.0.0.1:5173/debug?script=4003): node 5 text/reveal does not grant item 1; departing executes action 3501 once. Restart removes that run's grant.
- Reader [17048](http://127.0.0.1:5173/?script=17048), developer [17048](http://127.0.0.1:5173/debug?script=17048): node 2 “Maybe another time.”, optionId 5, finishes without node 3. Rapid input must produce one selection. History retains the selected response.
- Reader [7025](http://127.0.0.1:5173/?script=7025), developer [7025](http://127.0.0.1:5173/debug?script=7025): seven Advances with Instant text reach question 1 on node 7's end; answer IDs 1/5/9 are correct. Continue preserves source order through silent node 0 and node 8. Open History and Settings while a question is waiting.
- Reader [1051](http://127.0.0.1:5173/?script=1051), developer [1051](http://127.0.0.1:5173/debug?script=1051): long opening narration, responsive wrapping, Settings focus/escape, and retained character/background rendering.
- Reader [3010](http://127.0.0.1:5173/?script=3010), developer [3010](http://127.0.0.1:5173/debug?script=3010): node 35 remains blocked on unavailable ending 4 achievement. The absent hidden keys stay invisible.

Remaining scope limits: hidden fallback precedence, implicit AVG flags, ending achievements, ordinary-choice eligibility/lock semantics, and favor/attribute/quest/calendar effects need further evidence. Existing provisional character placement/easing and unsupported media/effects remain as documented in earlier reports. Development stops here for review.
