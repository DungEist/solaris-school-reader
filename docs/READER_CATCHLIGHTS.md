The shared Reader renderer preserves each resource’s authored catchlights in stage portraits and dialogue avatars, including both Rover variants. The [exhaustive source-to-render report](../test-results/reader-catchlights/coverage/source-to-render.json) passes **408 available Spine combinations** and **2,418 actual source transition pairs**, with **0 maximum geometry discrepancy** over **72,882 samples**. Static reflections, closed eyes and special eye shapes retain their source treatment.

The [route inventory](../test-results/reader-catchlights/coverage/routes.json) enumerates **429 scripts, 8,493 nodes, 419 choice edges and 8,981 correlated character states**. Its 508 stage/avatar/gender/source-expression/effective-clip tuples comprise 408 ready Spine, 60 static-image and 40 unavailable tuples. There are **316 published visible combinations**: **279 Spine** and **37 static images**, split into **220 stage portraits / 96 dialogue avatars**. Actual `ScriptRunner` replay corroborates all 316: 315 settled combinations over 283 witnesses, plus one timed-only interval.

Structural reachability abstracts external story predicates. Conditions, hidden-choice precedence, concrete path witnesses and explicit Developer overrides remain recorded. These counts do not assert that every branch is attainable in one playthrough. Character membership, expression and visibility remain correlated along actual paths, rather than taking a Cartesian product of separately encountered values.

The table counts resource-specific combinations. **Checked S/A** includes available hidden and non-speaker compositions; **Visible S/A** counts published portrait/avatar intervals. **A/S/H/X** counts individual eyes in visible combinations: animated reflection, static reflection (separate or baked), hidden closed eye, special eye shape without a catchlight. “Complete” includes the existing documented female mouth spelling repair; absent literal clips remain explicit below.

| Character | Native rows / complete | Checked S/A | Visible S/A | Visible eyes A/S/H/X | Source transition pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Changli | 15 / 15 | 13 / 13 | 13 / 6 | 0 / 36 / 2 / 0 | 184 |
| Chisa | 15 / 14 | 14 / 14 | 14 / 8 | 0 / 40 / 4 / 0 | 140 |
| Abby | 23 / 23 | 22 / 22 | 22 / 6 | 8 / 24 / 10 / 14 | 284 |
| Cartethyia | 27 / 27 | 27 / 27 | 27 / 8 | 40 / 8 / 22 / 0 | 448 |
| Shorekeeper | 15 / 14 | 10 / 10 | 10 / 2 | 22 / 0 / 2 / 0 | 80 |
| Phoebe | 25 / 25 | 23 / 23 | 22 / 12 | 68 / 0 / 0 / 0 | 288 |
| Buling | 16 / 16 | 13 / 13 | 13 / 6 | 10 / 20 / 8 / 0 | 164 |
| Roccia | 22 / 22 | 19 / 19 | 19 / 3 | 0 / 44 / 0 / 0 | 210 |
| Verina | 16 / 16 | 15 / 15 | 15 / 1 | 24 / 0 / 8 / 0 | 114 |
| Male Rover | 12 / 6 | 4 / 10 | 1 / 10 | 0 / 18 / 4 / 0 | 59 |
| Female Rover | 9 / 9 | 2 / 10 | 1 / 10 | 18 / 0 / 4 / 0 | 51 |
| Xiangli Yao | 13 / 13 | 13 / 13 | 13 / 4 | 0 / 34 / 0 / 0 | 172 |
| Galbrena | 12 / 12 | 11 / 11 | 11 / 7 | 34 / 0 / 2 / 0 | 118 |
| Ciaccona | 13 / 12 | 11 / 11 | 11 / 4 | 24 / 3 / 3 / 0 | 106 |

All 408 checked tuples contain **816 eyes**: **344 animated separate reflections, 188 static separate reflections, 148 static baked reflections, 116 hidden closed eyes and 20 special eye shapes**. The visible subset contains 558 eyes: 248 animated, 227 static, 69 hidden and 14 special. All **233 native source rows** are inventoried, including unreferenced/test rows; 224 have complete primary compositions. Full per-eye texels, curves, clipping and blink blockers are in the [source-eye audit](../test-results/reader-catchlights/coverage/source-eyes.json).

Routes encounter **201 declared source expression IDs**; **200** have a playable visible composition and **199** appear in settled visible intervals. Phoebe `700122` at `4002/62` is visible at 0s and 0.425s before a cue at 0.85s replaces it with `700120`. Phoebe `700124` at `1011/42` never renders because she has already exited. The 206 visible effective expression IDs include Rover avatar projection IDs. Literal NPC expression `0` has no source animation row and remains separate. Verina has a visible avatar combination, `700136` at `6015/11`.

Rover has an actual stage portrait at **`1051/35`, expression `700127`, both genders**. Choose optionId **5** (zero-based choice index **3**) at node 19, then follow 29→30→31→32→33→34→35. The literal RoleConfig sets `HidePortrait=false`, `HideAvatar=true`. Both skeletons contain the required body/mouth/eye/blink clips. The [source exception record](../test-results/reader-catchlights/coverage/rover-stage-exception.json) and new recordings establish static male reflections and animated female reflections. Earlier hidden-portrait checks of `1001/1,11,16,21` remain valid for those checkpoints.

The [original controller summary](../test-results/reader-catchlights/source-controller/controller-summary.json) and [selected complete IL](../test-results/reader-catchlights/source-controller/controller-evidence.json) establish playback. Installed resource 3.8.9 `Aki.Game.dll` has SHA-256 `069bcb5b9c3d4d28780be8f51b59e7d52d2a9cbd8eab2c037f2a3be925db2049`. Native stage and dialogue presentations own separate `VisualNovelSpineCharacter` instances with the same animation logic.

`PlayTrackAnimation` (`0x0602529A`) loops body/mouth/eye clips on tracks 0/1/2 at speed 1, preserving equal clip names and clocks across expression changes. `PlayBlink` (`0x060252A0`) replaces track 2 with a one-shot blink, then restores the mapped open-eye loop from phase zero while body/mouth clocks continue. `ScheduleBlink` (`0x0602529F`) chooses 3–6 seconds between blink starts, including the first delay. Matching blink mappings preserve the schedule; changes reschedule and cancel the old blink. The native `IsEyeTrackBlinking` flag persists after completion, so a mapping change after a previous blink also reinstates the open-eye loop from phase zero.

The [shared actor](../src/spine/ChangliSpineScene.ts) follows that contract. This coverage work fixed a first-render attachment/deformation defect: Spine retained old `mixingFrom` state with `defaultMix=0`, allowing a pose change during or after blinking to paint old eye geometry until a positive frame update. Replaced channels are now cleared before replacement. Setup properties/deformations are reset and reapplied from current tracks, preserving unchanged clip clocks. Blink start and reopen use the same path. Pose changes, closed eyes and winks therefore select correct attachments on the immediate zero-delta frame.

The comparison checks every slot’s attachment, vertices/deformations, UVs, triangles, colors, active bones, blend mode, clipping end slot and draw order. Samples include authored keys plus 120 Hz points, repeated eye cycles, and complete blink/reopen intervals. The 2,418 transition pairs join actual `sourceTransitions` operations and path witnesses; 2,056 change expression and 1,138 change body pose. Each is tested before, during and after blinking, immediately and after a frame advance. Fresh source skeletons receive original clips directly, independently of Reader track lifecycle. Totals are **30,664 open-eye, 29,462 blink and 12,756 transition samples**. Unavailable compositions and new-entry/resource replacement cases are retained separately.

This table describes each resource’s own native rows. Animated entries animate catchlights in **both eyes**. Static refers to the small white iris reflection even when other eye marks move. ID ranges are inclusive. Exact exported periods are `0.20000001788139343s`, `0.6666666865348816s` and `1.3333333730697632s`, abbreviated below. The complete audit includes optional mouth variants and effective Reader/Rover compositions.

| Resource | Animated catchlights / period | Static catchlights | Hidden, special or unavailable primary compositions |
| --- | --- | --- | --- |
| Changli | None | Baked: `700003`, `700038–700050` | Closed: `700051`. |
| Chisa | None | Baked: `700152–700157`, `700159–700164` | Closed: `700158`, `700165`. Unavailable legacy: `700009`. |
| Abby | `700006`, `700212`, `700228` / 0.2s | Separate: `700215`, `700220`, `700225`, `700229`. Baked: `700213`, `700218`, `700222`, `700223`, `700230`, `700231`. | Closed: `700214`, `700219`, `700224`, `700232`. Special white shapes without colored irises/catchlights: `700216`, `700217`, `700221`, `700226`, `700227`, `700233`. |
| Cartethyia | `700001`, `700013`, `700016`, `700018`, `700020`, `700022`, `700023`, `700027`, `700029`, `700031`, `700033`, `700035`, `700036` / ⅔s | Baked watery-eye dots: `700015`, `700021`, `700028`, `700034`; tear gleams have their own ⅔s motion. | Closed: `700002`, `700014`, `700017`, `700019`, `700024–700026`, `700030`, `700032`, `700037`. |
| Shorekeeper | `700088–700092`, `700094–700098`, `700100`, `700101` / 1⅓s | None | Closed: `700093`, `700099`. Unavailable legacy: `700008`. |
| Phoebe | `700005`, `700102–700125` / 1⅓s | None | None in mapped native eye rows. |
| Buling | `700074`, `700079`, `700084` / 1⅓s | Separate: `700011`, `700073`, `700077`, `700078`, `700082`, `700083`, `700087`. Baked: `700076`, `700081`, `700086`. | Closed smiles: `700075`, `700080`, `700085`. |
| Roccia | None | Separate: `700004`, `700191–700211` | None. Eyelid glints are recorded separately. |
| Verina | `700136–700138`, `700140–700142`, `700144–700146`, `700148–700150` / 1⅓s | None | Closed: `700139`, `700143`, `700147`, `700151`. |
| Male Rover | None | Separate, complete: `700012`, `700126`, `700127`, `700131`, `700132`, `700234`. | Unavailable full compositions: `700128–700130`, `700133–700135`; see literal channels below. |
| Female Rover | `700052`, `700054`, `700056`, `700058`, `700235` / ⅔s | None | Closed: `700053`, `700055`, `700057`, `700059`. Extra native thinking-eye clips have the same animated cycle. |
| Xiangli Yao | None | Separate: `700007`, `700179–700190` | None. |
| Galbrena | `700166`, `700168–700170`, `700172–700176`, `700178` / 1⅓s | None | Closed: `700171`, `700177`. |
| Ciaccona | `700061–700063`, `700065–700068`, `700070–700072` / 1⅓s | Wink `700064`, `700069`: source-screen-left retains baked reflections. | Source-screen-right wink eye is closed/hidden. Unavailable legacy: `700010`. |

Abby’s normal eye clip animates twelve scale timelines on six reflection-weighted bones. `01_A_高光` supplies gold/blue reflections; `01_A_眼珠` uses stationary iris bones. Verina’s corresponding clip animates two reflection bones through translation/scale curves while `A_03_眼珠` stays fixed. All **456 animated eyes** in the native/optional-mouth/Reader union have zero sampled iris-center drift, zero iris-size drift and zero period-endpoint discrepancy.

Classification uses actual UV-masked atlas texels and projected white components. The [earlier texel audit](../test-results/reader-catchlights/source-catchlight-texels.json) and [contact sheet](../test-results/reader-catchlights/source-catchlight-uv-contact-sheet.png) establish reflection layers independently of slot names; the new audit adds combined painted eyes and full layering. Abby’s star eyes retain baked gold/blue reflections beneath the stars. Buling’s `xianqi` eyes retain upper white dots distinct from mint lower iris glow. Cartethyia’s watery irises have static painted dots and moving tear gleams. Ciaccona’s wink detaches normal `A_眼珠` / `A_高亮` and selects combined `参考` attachment `CK_wink_001_`.

Occlusion sampling uses native UV triangles, weighted vertices, clipping, draw order, colors and blend modes. Closed-eye area and upper-layer coverage are assessed independently of attachment existence: reflection meshes may remain attached behind lids. Phoebe’s multiply blush is the only non-normal source slot blend and is included in compositing. Retained [blink geometry](../test-results/reader-catchlights/coverage/source-blink-occlusion-snapshots.json) and source rasters distinguish conservative transmitted-alpha probes from final visible pixels.

Cartethyia’s two thinking-blink compositions (`700016`, `700029`) retain conservative alpha-probe flags. The [final RGB layer ablations](../test-results/reader-catchlights/coverage/source-blink-occlusion-confirmation.json) at 0.3666666746s find **zero visible white catchlight pixels in either eye**; open positive controls show reflections in both eyes. A genuine **nine-pixel blue iris sliver** remains beneath the source-screen-left lashes in each 1500px source close-up; the right iris has zero colored contribution pixels. This authored iris residual is preserved separately from catchlight occlusion. The renderer matches those source layers exactly, and there are **zero unresolved catchlight occlusion cases**.

Unresolved source assets and approximations remain separate from successful renderer coverage:

| Resource / source rows | Absent literal channels / status |
| --- | --- |
| Male and female Rover `700128`, `700133` | Missing mouth `dongzuo1_yansu_zui`; full literal composition unavailable. |
| Male and female Rover `700129`, `700134` | Missing `dongzuo1_wunai_zui`, `dongzuo1_wunai_biyan`. |
| Male and female Rover `700130`, `700135` | Missing `dongzuo1_nanguo_zui`, `dongzuo1_nanguo_zhengyan`, `dongzuo1_nanguo_zhayan`. |
| Female Rover `700126`, `700131` | Missing mouth `dongzuo1_zhengchang_bizui` after gender resource selection. |
| Legacy/test `700008`, `700009`, `700010` | Missing eye clips; Chisa `700009` also lacks named body/mouth. Not reached as authored route expressions. |
| Unnamed Shorekeeper `700013`, stage `who=1759` | `1007/13` modifies and `/19` moves this identity without an Enter or usable expression/default; remains non-present. |

There are **14 unavailable literal Rover stage tuples** (six male / eight female), source-hidden in the enumerated routes. The existing **14 Rover avatar approximations/repairs** have complete verified effective clips; their static/animated/closed treatment is checked among the 408 combinations. Literal missing channels and approximation reasons remain in `unresolved.projectedAvatarApproximations`; appearance with absent native clips is unresolved. Four female native mouth spelling errors retain `dongzuo1_ zhoumei_zui` → `dongzuo1_zhoumei_zui`. Optional missing speaking-mouth variants are listed in the source audit.

Male Rover `700128` / `700133` have valid static eye clips despite their missing mouth channel. Both eyes have explicit `partialEyeChannelAssessment` links to a complete verified composition using that same source eye clip. Six unavailable native/Reader compositions have such known eye-channel evidence; their full literal compositions remain unavailable.

The 26 unspecified-expression stage/avatar tuples have no published visible interval. Unentered, exited, hidden and non-speaker observations are retained, including unnamed Shorekeeper; no default pose is inferred. The 21 configured static portrait identities have no Spine catchlight timeline; 37 static-image combinations actually render. Intentional text-only talker `850013` and 14 unbound dialogue labels remain non-Spine inventory records.

All **382 JavaScript tests**, Python asset-preparation checks and production typecheck/build pass. The **73 focused tests** include binary eye curves, repeated cycles, static expressions, phase continuity, native blink scheduling and immediate attachment replacement through winks/pose changes. The exhaustive report has **0 failures**.

The original recordings are reused. Their [historical verification](../test-results/reader-catchlights/playback/capture-source-replay-verification.json) preserves original capture/build identities. The [current compatibility replay](../test-results/reader-catchlights/playback/source-replay-verification.json) applies fresh source skeletons and today’s actor at each saved eye time through the recorded transform/camera/crop. All **246 frames** match iris and reflection geometry with **0px discrepancy**. Historical hashes remain separate from current hashes.

| Reused recording | Frames / interval | Tracked close-up | White-dot area variation, screen-left / screen-right |
| --- | ---: | --- | --- |
| Abby stage · `1001/10` · `700212` | 85 / 2.0011s | [MP4](../test-results/reader-catchlights/playback/abby-stage/tracked-close-up.mp4) | Gold 15.1%, blue 12.2% |
| Verina stage · `1016/1` · `700136` | 93 / 2.0004s | [MP4](../test-results/reader-catchlights/playback/verina-stage/tracked-close-up.mp4) | Green 35.3% / 16.9% |
| Abby avatar · `1034/56` · `700212` | 68 / 3.2067s | [MP4](../test-results/reader-catchlights/playback/abby-avatar/tracked-close-up.mp4) | Gold 17.7%, blue 29.2% |

Every reused frame is open-eyed, with zero exact iris/root/scale/camera/canvas drift. The [RGB pixel analysis](../test-results/reader-catchlights/playback/pixel-analysis/pixel-summary.json) follows upper white dots through colored iris boundaries. Red boxes track white pixels; fixed teal guides mark irises. Visually reviewed sheets: [Abby stage](../test-results/reader-catchlights/playback/abby-stage/tracked-contact-sheet.png), [Abby avatar](../test-results/reader-catchlights/playback/abby-avatar/tracked-contact-sheet.png), [Verina](../test-results/reader-catchlights/playback/verina-stage/tracked-contact-sheet.png). The [encoding manifest](../test-results/reader-catchlights/playback/encoded-recordings.json) verifies frame counts/timestamps.

The [new production verification](../test-results/reader-catchlights/coverage/playback/verification-summary.json) passes **eight recordings, 583 frames and 7,719 eye layers**, with **0 discrepancy** against independent source replay. Renderer SHA-256 is `3a00b9f3507c1ba00bfa502b01dd60c35f9b4c8dac979cf47555d7ea62081871`; bundle `index-Bq3aBsZ-.js`. The [capture report](../test-results/reader-catchlights/coverage/playback/production-browser-result.json) retains 173 actually served local response-byte identities. Navigation uses the existing Developer selector, then ordinary Reader advances and eligible choices. The probe observes clocks/geometry and copies actual renderer pixels into a fixed crop.

| New Reader case | Frames / interval | Source behavior and close-up |
| --- | ---: | --- |
| Buling stage · `1011/29→30` | 77 / 2.421s | `700082` static thinking → `700074` animated normal · [MP4](../test-results/reader-catchlights/coverage/playback/buling-pose-change/close-up.mp4) |
| Ciaccona wink · `12003/9→10` | 93 / 2.419s | `700061` → `700064`: left baked reflection, right closed · [MP4](../test-results/reader-catchlights/coverage/playback/ciaccona-wink/close-up.mp4) |
| Abby avatar · `1034/56→57` | 46 / 2.414s | `700212` animated normal → `700222` static up eyes · [MP4](../test-results/reader-catchlights/coverage/playback/abby-avatar-pose-change/close-up.mp4) |
| Male Rover avatar · `1001/2` | 61 / 2.005s | `700131`, static · [MP4](../test-results/reader-catchlights/coverage/playback/rover-male-avatar/close-up.mp4) |
| Female Rover avatar · `1001/2` | 61 / 2.027s | Source `700131` → effective `700056`, animated · [MP4](../test-results/reader-catchlights/coverage/playback/rover-female-avatar/close-up.mp4) |
| Male Rover stage · `1051/35` | 83 / 2.018s | Literal `700127`, static · [MP4](../test-results/reader-catchlights/coverage/playback/rover-male-stage/close-up.mp4) |
| Female Rover stage · `1051/35` | 86 / 2.014s | Literal `700127`, animated · [MP4](../test-results/reader-catchlights/coverage/playback/rover-female-stage/close-up.mp4) |
| Ciaccona blink · `12003/6` | 76 / 2.002s | 17 blink / 59 open frames; both reflections covered · [MP4](../test-results/reader-catchlights/coverage/playback/ciaccona-natural-blink/close-up.mp4) |

Every new open-eye phase has zero iris/root/camera drift. Reflection motion is measured relative to the iris. Male Rover stays static; female Rover moves in both compositions. Buling and Abby naturally blink before the ordinary pose advance, exercising the repaired lifecycle. Ciaccona’s first wink frame selects `CK_wink_001_`; [decoded blink frame 5](../test-results/reader-catchlights/coverage/playback/ciaccona-natural-blink/decoded-review-0005.png) at 0.170s shows both reflections covered while their meshes remain attached. MP4 frame counts match captured PNGs, with **0.5ms maximum timestamp quantization**. [Contact sheets and decoded samples](../test-results/reader-catchlights/coverage/playback/visual-review-index.json) are retained beside clips.

Recordings preserve native playback speed and nonuniform gaps: maxima 161ms in new cases and 197ms in reused cases. Historical RAF eye time and renderer-finish wall time have measured variation within the retained 60ms bound. Hair partly covers one female Rover reflection. Exact geometry and raster analysis complement representative recordings, which do not sample every cycle phase. No interpolation, stabilization or synthetic animation is used.

REA process evidence: `ev_dc8f958709b63ddb7b4f527b10becec379c593901f914f2156ac4367cc6e88ac` for reused captures, `ev_1ab0faba68109d914c5b612f7b538595bd1f70b5fbe385be35ef2725766445e8` for new captures. Owned process-group cleanup is verified. Failed and before-fix attempts remain local and are excluded from current verification.

To reproduce with the supplied native resources and data:

```sh
node --experimental-strip-types tools/enumerate_reader_catchlight_routes.mjs
node --experimental-strip-types tools/audit_reader_catchlight_eyes.mjs --reader-compositions test-results/reader-catchlights/coverage/routes.json
python3 tools/confirm_reader_catchlight_eye_occlusion.py test-results/reader-catchlights/coverage/source-blink-occlusion-snapshots.json test-results/reader-catchlights/coverage/source-eyes.json test-results/reader-catchlights/coverage/source-blink-occlusion-confirmation
node --experimental-strip-types tools/verify_reader_catchlight_coverage.mjs
node --experimental-strip-types tools/verify_reader_catchlight_recordings.mjs
npm test
npm run build
node tools/reader-catchlight-coverage-browser-check.mjs
```

Managed IL establishes native playback requests; skeleton/atlas data establishes authored motion, timing and layering; exhaustive actor replay establishes composition/lifecycle agreement; browser recordings establish visible Reader playback. Original-game Unreal/LGUI framebuffer output was not recorded.
