# Solaris School Reader — Technical Review

Audit date: 2026-11-11. Sources: the supplied SPEC, builder and report; Arikatsu/WutheringWaves_Data; alt3ri/WW_Asset_Webp; and the VNreader player/parser referenced by SPEC.

**Handoff note:** The uploaded review is the original v0.3 audit. Its findings below describe that baseline. Subsequent schema 2 changes already corrected SolarSchool Spine mapping, added option.next and preserved flowActions/movie metadata. Use SPEC v0.4 and the updated builder as implementation authority; do not undo those fixes. The current Phase 1 scope is an engine plus a minimal test player. Skip movies; defer the main menu, polished UI, save/load, auto/skip, T2 and T3.

**Assessment:** T1 is feasible once data-contract defects are addressed. Background/CG paths match available WebP assets well. T2 can support ending exploration with simulated profiles, but faithful full-game progression remains unverified. Animated portraits require additional Spine data.

## 1. Architecture

Target: **Second Coming of Solaris: Unwritten Dreams** (SolarSchool, activity 111700001), not Collab Season (109700001).

- T1: individual scripts and choices.
- T2: story/ending graph and conditions.
- T3: calendar and stat simulation.

Keep neutral data, asset resolution and runtime/UI separate. The builder exports individual scripts and locale tables for lazy loading. Calendar/quest/behavior maps still contain substantial raw game data.

VNreader uses React/Vite. VnPlayer.jsx couples stage reconstruction with UI, PGR asset/audio naming, huaxu.app and pgr_save_* storage. Reuse interaction ideas but implement a pure ScriptRunner. Its existing rich-text parser handles only simple tags, not the complete WuWa placeholder syntax.

## 2. Baseline rebuild

Ran the original builder with --locales en against branch 3.8. Observed Git tree SHA: 49d65625340a32cec6851a12baedc03b5a630b25. Downloads used the branch name rather than pinning every request to that SHA. Source metadata: Game 3.8.0 / Resource 3.8.6 / Changelist 9383927.

| Check | Baseline result |
|---|---:|
| Scripts / nodes | 429 / 8,493 |
| Registered flows resolved | 426/426 |
| Referenced text keys | 8,804 |
| Missing English keys | 53 |
| Dangling jumps | 0 |
| Duplicate nid within a script | 0 |
| Scripts without dialogue nodes | 1: ID 1053 |
| Referenced conditions resolved | 410/410 |
| Background ID absent from its table | 800001 |

All locale-independent report fields and English results matched the supplied report. This initial run did not recheck ja or vi. Resolution means a reference was found, not that its semantics were proven.

Later schema 2 verification covered en/ja: 429 scripts and 8,493 nodes remained unchanged; missing keys were en=53, ja=54. Adding the event title key raised referenced keys to 8,805. Option transitions: 318 jump, 100 seq, 1 end; no control conflicts.

## 3. Asset coverage

| Category | Used logical IDs | Unique WebP paths | Paths found |
|---|---:|---:|---:|
| Backgrounds | 28 | 43, including day/night | 43/43 |
| CGs | 63 | 93, including gender variants | 93/93 |

Mapping removes /Game/Aki/UI/, strips the UE object suffix after the dot, then appends .webp. These are path-existence checks, not visual verification of every image. Missing background 800001 is excluded from the 43-path denominator.

Under UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool, Bg, CG, HighCG, Map and other UI textures exist. Generate an explicit, validated asset map and pin source revisions. Fetch only required assets.

All 14 character directories under UIResources/UiActivity/Spine/Activity38/SolarSchool were inspected recursively. Each contained one WebP and no atlas/skeleton files in that subtree. The inspected Changli image contains separate character parts, not a finished portrait. Rendering it requires matching atlas/skeleton/animation data, or separately rendered portraits. This does not establish that Spine metadata is absent everywhere else in the repository.

## 4. Baseline findings and current status

### P1 — Wrong Spine fields: corrected in schema 2

The original builder used generic SpineAtlas/SpineSkeletonData. All 13 used talkers also have SolarSchoolSpineAtlas. For talker 850001, generic Spine points to Activity33/CatapultStory, while the event-specific field points to Activity38/SolarSchool/SolarSchool_Male.

Use SolarSchoolSpineAtlas/SolarSchoolSpineSkeletonData and export portrait texture/transforms where available. Missing event-specific data must produce a placeholder, not an unrelated event's Spine. Full original rows remain in maps/talkers.json.

Still verify protagonist gender substitution: the baseline manifest includes Male but no Female talker, although a Female texture exists.

### P1 — to:null loses FinishTalk semantics: corrected in schema 2

Script 17048, node 2, optionId 5 ("Maybe another time.", key AVG_BLLTFT_1_6) has no jump target but contains FinishTalk. Treating every to:null as sequential would incorrectly display node 3.

Use canonical option.next = seq/jump/end. FinishTalk ends the current ShowTalk block; the flow dispatcher then continues subsequent actions. Only finish the script when all flow actions complete. Navigation actions must not execute again as side effects. This is a required regression case.

### P1 — Movie and other flow actions discarded: metadata preserved in schema 2

The original flow parser handled only SetPlotMode and ShowTalk. Script 1053, StateKey 剧情_3.8索拉学院_开局_2_54, contains PlayMovie(VideoSolarSchoolOP01), but exported nodes:[]. Movie frame audio was also omitted from execution.

Epilogue actions such as BeginFlowTemplate, SetFlowTemplate, fades and entity operations were discarded. unknownStageOps cannot detect this because it only counts performances inside dialogue nodes.

Schema 2 preserves ordered flowActions and reports unsupported actions: seven types, eight occurrences. Script 1053 still has no dialogue nodes but retains its movie action. Current Phase 1 explicitly skips movies and their audio, logs the skip and continues. Preserve metadata for later support.

### P2 — Incomplete Interjection audio inventory

There are 1,239 Interjection occurrences, 133 distinct cue paths and 86 cue names missing from assets.manifest.audio. The builder extracts only PlayVoice/TalkAkEvent into node.voice.

Inventory Interjection separately rather than assuming full spoken dialogue. initialAudio is also classified wholesale as bgm, although script 17048 starts play_amb_avg_solarschool_street_day. Audio support is deferred in Phase 1.

### P2 — Save/load requires the actual branch path

The original spec mixed string script IDs with numeric PlayState fields. Use string ScriptId consistently, including x1–x3, and distinguish it from numeric game flow IDs.

Replaying array order to a target nid cannot reconstruct every branch correctly. Save a stage snapshot or replay recorded choices. Restoration must suppress audio and duplicate side effects. Persistent saves are deferred in Phase 1; retain in-memory navigation history.

### P2 — Stage phases and AVG flags

Stage operations include start and phase:end; executing all of them on node entry is incorrect. Define node entry, wait/choice, exit and scheduling explicitly, including skip/load behavior.

The original spec both requires options to write avgVars and says to leave them empty in T1. PlotOptionId → AVG BitFlag remains a hypothesis. Record choices reliably; keep inferred flag behavior separate. Phase 1 must not guess AVG side effects.

### P2 — Validation gaps

The original builder reports failures without enforcing the spec's CI exit status. tryload catches every Exception and substitutes empty data, potentially hiding missing/corrupt required tables. Source version metadata is hardcoded.

Validate required inputs, unsupported actions, empty scripts, graph links and reachable termination. Record source commit provenance. Zero dangling jumps does not prove every branch terminates.

Condition expressions are keyed only by numeric ID; main/activity precedence depends on the first reference. No conflicting use across those precedence groups was found in this snapshot, so this is an update risk rather than a demonstrated current defect. Exported main groups use Relation 0; this run does not establish Relation 1/10 semantics.

## 5. Deferred T2/T3 research

- story-graph.json is a 74-node ending graph, not the complete order of 429 scripts. Its actual start node is 48.
- Twelve ending system actions need verified handlers or explicit unsupported states; comments alone do not prove behavior.
- Of 284 ActivityAction IDs, 27 overlap flow IDs. Numeric overlap alone does not prove nested flow calls.
- Verify PlotKeyId, key60, ending selection and playthrough reset rules.
- Full-year ordering requires calendar, quest nodes, behavior, trigger timing and simulation state. Label manually configured profiles as simulated.
- The spec reports vi as empty; the initial audit did not recheck it. Separate locale tables support future translation.

## 6. Implementation sequence

1. Use the corrected schema 2 contract; retain remaining validation/provenance work.
2. Build the headless runner and minimal test page using real scripts. Test 17048 exit, 1053 movie skip, sequential choices, jumps and string IDs.
3. After user review, add the polished reader with real backgrounds/CGs, portraits/placeholders and persistent save/load.
4. Add T2 ending exploration with explicit unknown conditions.
5. Implement T3 only after trigger ordering and action effects are understood.

Do not claim full gameplay fidelity or exhaustive playthrough testing: no SolarSchool runtime was available during the audit. For the current first milestone, prioritize correct dialogue, choices, navigation, stage events and clean completion. Stop for user feedback before expanding scope.

## 7. Gameplay UI references supplied later

The user supplied five promotional screenshots showing the gameplay viewport. Treat the inner gameplay region as the player reference; distinguish it from the surrounding presentation frame, promotional captions and subtitles.

Visible patterns:
- A landscape stage with a full background and one or two prominent characters.
- The speaking character is emphasized; other characters can be dimmed. One screenshot shows translucent overlapping characters, but a still image cannot establish exact transition timing.
- A wide, pale, lined-paper dialogue panel near the bottom center, a blue speaker-name tab and a small advance indicator.
- A compact date/time-of-day display at top left and a small icon toolbar at top right.
- A fast-forward-style control near the lower-right edge.
- A right-side text panel appears in one screenshot; its exact behavior is not established by the image.

Do not infer button semantics, key bindings, animation timing or a choice layout solely from these screenshots. Use data/runtime evidence for behavior. Keep debug tools separate from the future player presentation. The references guide a later UI pass and do not expand Phase 1 into calendar simulation, toolbar features or visual polish.

## Sources

- Original supplied files: SPEC.md v0.3, build_data.py, build-report.json. Subsequent handoff uses SPEC v0.4/schema 2 and the latest Phase 1 prompt.
- [WutheringWaves_Data, branch 3.8](https://github.com/Arikatsu/WutheringWaves_Data/tree/3.8)
- [Flow state](https://github.com/Arikatsu/WutheringWaves_Data/blob/3.8/BinData/flowState/flowstate.json)
- [AvgTalkerConfig](https://github.com/Arikatsu/WutheringWaves_Data/blob/3.8/BinData/AvgTalkerConfig/avgtalkerconfig.json)
- [SolarSchool backgrounds/CG/UI](https://github.com/alt3ri/WW_Asset_Webp/tree/main/UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool)
- [SolarSchool character textures](https://github.com/alt3ri/WW_Asset_Webp/tree/main/UIResources/UiActivity/Spine/Activity38/SolarSchool)
- [VNreader player](https://github.com/DungEist/VNreader/blob/main/src/components/PgrReader/VnPlayer.jsx), observed tree SHA b3f86166034511492d6b4b90af5e7fc86877e261.
- Five user-supplied gameplay reference images: image(1).png through image(5).png.

Repository observations were made through GitHub API/raw during the original audit; branch URLs may change. This translation does not represent a fresh upstream audit and contains no full game dialogue or asset bundle.
