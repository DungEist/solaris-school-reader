# Phase 3 timing contract

> Historical phase report. [Phase 7](PHASE7_READER_STATE.md) supersedes its single-interface and hidden-branch/state policy; existing timing, reveal, history, and quiz contracts are preserved.

The headless scheduler and presentation model follow schema 2. This is a deterministic reader policy, not a claim to reproduce the game's runtime. Phase 1–2 navigation and persistent state remain available through instant mode.

## Evidence inspected

Source: Arikatsu/WutheringWaves_Data branch `3.8`, revision `49d65625340a32cec6851a12baedc03b5a630b25`, especially `BinData/flowState/flowstate.json`, the SolarSchool registry, EN/JA MultiText, and ActivityCondition tables. Local source inspection reports are `test-results/phase3-source-timing.json` and `test-results/phase3-hide-options-source.json` (generated game data, ignored).

`SPEC.md` v0.4 defines `StartTime` / neutral `t` in seconds and separates entry `StartPerformances` from exit `EndPerformances`. Source JSON contains numeric values without unit annotations. The reader converts seconds to monotonic clock milliseconds. Duration and fade fields use the same seconds convention; actual game timer quantization and scheduling have not been observed.

| Source evidence | Reader handling |
| --- | --- |
| Start-performance timestamps reach 3 s; 128 end performances have positive timestamps, up to 1.05 s. | Independent start/end phase clocks. Ends cannot be folded into entry. |
| `1001`, nid 8: Move at 0.1 s, Duration 2 s, y −1200 → −500; no EaseCurve. | Delayed linear placeholder move; raw coordinates remain unchanged. |
| `1004`, nid 1: Enter fades 0.3 s / 0.5 s; nid 4: ModifyRole at 2 s. | Explicit opacity fades and delayed expression changes. |
| `1004`, nid 7: end Exit at 0 s with 0.5 s fade; end Move at 0.5 s with 0.5 s duration. | Retain dialogue until the delayed end operation starts; its visual move can continue in nid 8. |
| `1015`, nid 0: EnterBlackScreen at 0 s, fade 0.5 s, ScreenType Black; end LeaveBlackScreen at 0.5 s, fade 0.5 s. ShowTalk lists this silent nid last, after nid 48. | Fade a black stage overlay at script completion, following source nid order. The final visual fade may continue after logical completion. |
| `9015`, nid 5: end EnterBlackScreen at 0.01 s, fade 0.5 s; nid 6: start LeaveBlackScreen at 0.51 s, fade 0.5 s. | End/start phase clocks remain distinct; the stage fades while dialogue at nid 6 stays readable. |
| 32 background Load configs, 85 CG LoadImage configs, 69 CG Clean configs. They contain only Type and ID; none supplies a fade field. | Background/CG image swaps and clears stay instant. No crossfade duration is invented. Black-screen operations can separately fade the stage containing those images. |
| 19 CG LoadPrefab configs include PrefabId and AnimationName. | Retain their raw configuration; show an unsupported placeholder. No prefab animation. |
| Move EaseCurve objects use numeric PresetType 2, 3, 6; CG moves also use other presets. | Preserve and log these values. No preset is interpreted as a guessed curve. |
| RoleConfig VisualEffect contains Highlight/Darken without an effect duration. | Apply the existing placeholder style at the scheduled instant. No default dimming tween is added. Visibility fades use explicit FadeInTime/FadeOutTime. |
| `1004`, nid 1: hidden option 11 contains five ActivityAction performances at 0 / 0.05 / 0.1 / 0.15 / 0.2 s, including repeated action 5911. Option 12 contains one at 0 s. Neither has a navigation action. | Preserve every performance, including repetitions and raw metadata. Only an explicitly selected branch is scheduled; its `next: seq` continues to nid 2. ActivityAction remains metadata. |

The builder preserves Move `ease`, original background/CG `raw` configs, option `preCondition`, full `typeParams` and option `raw`. `typeParams.OptionPerformances` is additionally normalized to ordered `performances` with `phase: option`, source `t` and each full performance `raw`. These are optional schema 2 extensions; no game table is read by the engine. Validation rejects preserved raw conditions/parameters that lost their normalized fields and incomplete performance arrays. The builder does not synthesize fade fields or change asset references.

## Lifecycle and interruption

1. Each visit has a distinct `visitId`; a run has a distinct `runId`. At entry, schedule start operations relative to the entry clock. Zero timestamps apply immediately. Other operations remain in `snapshot.pendingStage`, separate from `snapshot.stageState`.
2. Execute by timestamp, then original stage-array order. Equal timestamps retain source order within their phase. A phase queue removes a task before delivery, so callbacks cannot replay it.
3. Advance/choose accept one navigation request. A choice and its condition/flag/performance metadata are recorded once before departure. Pending start operations are settled immediately in their scheduled order, with `delivery: advance/choice`. They apply final logical state without launching future visual tracks. Already-applied state is preserved; ongoing visual tracks snap to that state.
4. When a selected option has performances, create an independent `option` phase clock at selection, execute by timestamp/source order, and retain dialogue while it is pending. Only this branch's performances are delivered, with its `optionIndex`; repeated activity IDs are separate source operations. When the option queue is empty, begin the end phase. Otherwise, Advance/choose begins the end phase immediately. The end phase clock starts at this actual boundary, including when a delayed clock callback completes the option queue. This option-before-end ordering is an explicit reader policy; the game's overlap/blocking behavior has not been observed.
5. The runner reports `ending`, retains the dialogue and rejects further navigation while option/end queues are pending. When the last end operation has applied, enter the destination by nid or finish the current talk block and dispatch subsequent flow actions. `FinishTalk` never displays the next node in that block. End animation durations do not delay the next dialogue: those visual tracks can continue into the next node or after logical script completion.
6. Silent nodes wait for their scheduled starts, then their ends; they do not wait on unsupported WaitTime/DialogDelay or invented dialogue timers. Automatic-loop detection spans timer callbacks and resets at user input boundaries.
7. Restart/load cancel pending start/option/end operations, abandon the old departure, clear visual tracks and reset persistent stage state before new configuration. Disposal cancels all timers and rejects commands. Cleared callbacks also check cancellation epochs, covering callbacks already queued by a clock. Revisiting the same nid creates a new visit with its own phase clocks.
8. Instant mode settles the active queue in order, snaps visual tracks and uses immediate execution for future phase queues. Turning it off affects future operations; it never replays or reverses applied events. The same explicitly selected route must have the same operation order, navigation and final logical stage state in timed, interrupted and instant modes.

## HideAndAutoSelect audit and selection policy

All 11 nodes have two source options. The first has a `SystemCondition` referencing a one-condition AND group; the second has no `PreCondition`. All 22 options lack JumpTalk/FinishTalk actions and normalize to `next: seq`. The group contents establish the required item/ending data, but do not establish selection precedence or the runtime result when state is unavailable.

| Script / nid | First option condition group | Verified condition parameters | Option IDs |
| --- | --- | --- | --- |
| 1004 / 1 | 26100048 | Type 10: item 10, count 1 | 11 / 12 |
| 1008 / 21 | 26100040 | Type 10: item 7, count 1 | 14 / 15 |
| 1008 / 53 | 26100045 | Type 10: item 3, count 1 | 17 / 18 |
| 1009 / 5 | 26100039 | Type 10: item 8, count 1 | 17 / 18 |
| 1010 / 5 | 26100041 | Type 10: item 6, count 1 | 27 / 28 |
| 1010 / 25 | 26100046 | Type 10: item 2, count 1 | 18 / 19 |
| 1011 / 29 | 26100044 | Type 10: item 4, count 1 | 7 / 8 |
| 1014 / 16 | 26100042 | Type 10: item 5, count 1 | 7 / 8 |
| 1014 / 26 | 26100043 | Type 10: item 2, count 1 | 10 / 11 |
| 1034 / 43 | 26100047 | Type 10: item 1, count 1 | 37 / 38 |
| 3010 / 35 | 29000111 | Type 30: ending 4 achieved | 2 / 3 |

Inventory and ending state are outside this phase. The reader implements no automatic selection, condition evaluation or assumed fallback. `choose()` rejects hidden branches; only `overrideHiddenChoice(index, visitToken?)` explicitly selects one and records `debugOverride: true`. The dialogue stays readable, ordinary choice buttons are absent, and Debug offers separate override buttons with original IDs, text keys, conditions and performance counts. Overrides claim no eligibility. Ordinary choices retain their normal controls; their conditions are preserved as metadata, without eligibility filtering.

EN and JA contain 18 explicitly empty hidden option strings, including `Flow_318000000_3450` and `3451` at `1004/1`. Four hidden keys are absent in both source locales: `Flow_318000000_3487`, `3488`, `Flow_456000000_2769`, `2770`. Hidden controls do not render missing-text labels for either case. The builder keeps explicit empty entries (including when fallback is requested), distinguishes them from absent keys, and now reports 35 genuinely missing English keys rather than 53. The English-only export retains all 74 option performances: 67 ActivityAction, 5 SendAudioEvent and 2 PlayScreenEffect. These activity/audio/screen operations are retained and logged without executing game actions or media.

## Presentation and input

`StageTransitions` lives outside React. Persistent state stores operation targets immediately on delivery; a separate clock-sampled presentation stores interpolated positions/opacities and fading exit placeholders. React projects this snapshot without timers or event-consuming effects. Clock ticks publish presentation changes without emitting stage events.

Explicit durations drive character enter/exit fades, Move endpoints and Black-screen fades. Linear interpolation is the preview convention for these transitions, including Move operations with unresolved EaseCurve metadata. Source presets are logged; their game easing semantics are not executed. Expression/visibility/effect patches without durations remain instant. Changing a character's expression does not restart an unrelated active movement; a new Move retargets from the sampled visual position.

Late callbacks drain overdue operations in order and sample visuals against source deadlines, so a delayed callback does not lengthen an already-ended fade. Actual browser frame delivery can still jitter. The 16 ms presentation sampling cadence is a reader implementation choice.

Placement uses the provisional 2560 × 1440 centered-x plane with a default 5% floor. Increasing stage Y moves upward; the original negative-Y-up convention was corrected using Abby's `1001/8–10` recording evidence. Neither the exact game canvas/pivot nor its opacity values/easing has been verified. Conversion remains centralized in `StageCoordinates.ts`; portrait calibration and Spine-local coordinates are separate from authored stage movement.

Controls are usable while entry operations and visual transitions run. Once a navigation request has been accepted, duplicate departure requests are rejected. UI callbacks carry run/visit tokens, and the page adds a 200 ms input guard for rapid clicks/keys. This is a reader input policy, not game timing. Headless clients default to no input guard. React StrictMode subscription cycles never dispose or restart the runner; the page entry point owns its lifetime and disposes it on unload/HMR.

## Validation and browser limits

Existing preflight passed 64 tests, including real `17048/2` optionId 5. Final `npm test` passes 87 tests plus Python asset-pipeline checks; `npm run build` passes TypeScript and the production bundle. Fake-clock coverage includes delayed/equal-time delivery, pending-start settlement, option/end phases, interruption, restart/switch/disposal races, revisits, instant toggles, late callbacks and duplicate input. Actual React render tests cover readable hidden dialogue, absent ordinary hidden-choice buttons, explicit overrides and event deduplication. Data checks compare all 11 hidden nodes with their preserved raw metadata and intentionally empty strings.

The structural route suite covers 429 scripts, 8,493 reachable nodes and 419 choice edges across 848 completed routes, including explicit debug overrides for hidden branches. Eight representative real scripts (`1001`, `1004`, `1015`, `9015`, `6012`, `17048`, `3018`, `1053`) compare final logical state, navigation and operation order in 24 timed/instant/interrupted routes. The timed and instant `17048/2` optionId 5 regression never displays nid 3.

Controlled REA browser checks against `http://127.0.0.1:5173/` completed for real `1004`: cached background decode, Enter opacity fades, readable hidden dialogue with no ordinary choice buttons, waiting without automatic selection, profile rerenders, one explicit optionId 11 selection with five scheduled performances, the delayed nid 4 expression, nid 7's exit ghost/pending end Move, and retained stage state at nid 8. All captured steps have matching emitted/applied event counts and no page errors or error-level console events. Screenshots were visually inspected. Evidence IDs are `ev_6dcd434793251eed68521e6a268bf6d1362128f613565a7b6c814fb7b9cc3990` and `ev_57d995f5bb9fe92a12ea247b20e7d9be631933b601d4c2b502ffeba33bc26d2d`; scoped summaries/screenshots are in ignored `test-results/phase3-browser-evidence.json`, `phase3-hidden-choices.png` and `phase3-timed-stage.png`.

Broader movement/rapid-input/restart/instant and FinishTalk browser scenarios stalled and were interrupted; their results are unavailable. Those behaviors are covered by fake-clock/real-data tests, and browser validation remains limited to the completed checks above. The standalone harness is syntax checked and updated for timing/hidden overrides, but managed-shell socket restrictions prevent running it here. Run `npm run test:browser` from a normal terminal, optionally with `SOLARIS_TEST_URL=http://127.0.0.1:5173/`, to repeat the expanded browser checks. No running-game comparison was performed.

## Playtests and remaining limits

- `1004` nid 1: Enter fades and readable dialogue, with no normal choice buttons. In Debug, explicitly override branch 1 (optionId 11) to see five metadata operations at 0 / 0.05 / 0.1 / 0.15 / 0.2 s, or branch 2 (optionId 12) for one at 0 s. Both continue to nid 2. Nid 4: wait two seconds for expression 700224 → 700212, or enable instant mode before the delayed change. Nid 7 → 8: timed end phase, Exit fade and movement.
- `1001` nid 8: wait at least 2.1 seconds for the delayed move. Portrait Jump on departure stays unsupported and logged.
- `9015` nid 5 → 6: end-phase Black-screen fade, then a start-phase fade back after 0.51 s. Stay at nid 6 to see it complete; its dialogue and controls remain readable.
- `1015` nid 0: the silent Black-screen sequence is last in source ShowTalk order, after nid 48. Read through the script to see the closing fade; the fade back finishes after logical completion.
- `6012` nids 2/4/6 and 10/26: background/CG swaps and clear stay instant; verify persistence and gender/day-night previews.
- `17048` nid 2 optionId 5: complete without nid 3. OptionId 3: route to nid 6, CG load at 7 and clear at 8.
- `1053`: movie/audio skip and normal completion.

Screen/portrait effects, CG moves/prefabs, role introductions, ActivityAction and AVG effects remain metadata. No Spine, typewriter, audio/video, extraction, auto/skip, saves or story progression is implemented. Game unit interpretation, option/end phase overlap, end-duration blocking, interruption behavior, linear easing, condition/fallback precedence and coordinate placement remain unverified against a running game; the reader policies above are explicit and covered by fake-clock tests.
