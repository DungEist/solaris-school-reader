# Shared Reader runtime fixes — 2026-11-16

Rover dialogue avatars now render using available channels from the selected gender's actual skeleton. All 18 authored screen-effect prefabs have a drawable sprite or an explicit Reader material projection. All authored music events resolve original media, including Central Square's `spring_day`. These fixes live in shared asset resolution, playback and rendering; there are no script/node-specific runtime exceptions.

## Fresh playback for this task

The production Chromium harness uses ordinary dialogue advances and eligible choices. Rover gender changes use Settings. VFX source scripts are selected through the existing Developer source selector, then played from their beginning in Reader; these are representative scene checks, not claims that every route was manually played from New playthrough. Central Square is reached from New playthrough through **Go out → Central Square**, without selecting script 1008 or injecting story state. Passive probes observe actual WebGL draws, framebuffer pixels, canvas pixels, audio sources and PCM. They do not advance the engine or supply replacement audio.

### Rover

The missing avatar was not a lost logical visibility flag: the before capture had actor `750088`, expression `700129`, `hidePortrait=true`, `hideAvatar=false`, opacity `1`, and an avatar container, but **no Rover skeleton draw**. Required authored `wunai` eye/mouth channels are absent in the selected resources. Strict resolution therefore rejected the expression. The fix validates explicit dialogue-only replacements against each real skeleton. Male `700129` uses standing body plus available `biyannanguo` closed-eye/mouth channels; female `700129` projects to pose `700053` with the same closed-eye intent. Authored expression IDs, flags and stage characters remain unchanged. Missing angry/sad/thinking variants use the same shared mechanism; all mappings are recorded in `SchoolRover.ts` and tested against actual skeleton animations.

[Compact avatar comparison](../test-results/reader-runtime-playback/captures/avatar-pairs.jpg) shows both requested pairs with both genders. [Final measurements](../test-results/reader-runtime-playback/avatar-final/playback.json) contain 16 framebuffer checks and 8 compact compositor clips, including additional inherited pairs `1001/16→17` and `1002/30→31` (`700134`; female render pose `700057`).

| Requested pair | Gender | Render expression | Visible painted framebuffer pixels on each line | Pixels above paper on each line | Clip |
| --- | --- | --- | --- | --- | --- |
| 1001/21→22 | Male | 700129 with repaired channels | 43,254 | 7,676 | [MP4](../test-results/reader-runtime-playback/avatar-final/1001-male-avatar.mp4) |
| 1001/21→22 | Female | 700053 | 50,014 | 10,344 | [MP4](../test-results/reader-runtime-playback/avatar-final/1001-female-avatar.mp4) |
| 1002/35→36 | Male | 700129 with repaired channels | 43,254 | 7,676 | [MP4](../test-results/reader-runtime-playback/avatar-final/1002-male-avatar.mp4) |
| 1002/35→36 | Female | 700053 | 50,014 | 10,344 | [MP4](../test-results/reader-runtime-playback/avatar-final/1002-female-avatar.mp4) |

Each measured requested state has one drawn Rover avatar, white RGBA and avatar opacity `1`; avatar layer z-index `7` exceeds paper `6`. Gender-specific head transforms remain male `[20,100,1]`, female `[-80,150,1]`, with their existing facing calibration. Abby retains brightness `.58`, expression `700230`, and her authored `.65s` move to `[0,0,1]`. The intermediate final captures show that move still running; the earlier [settled captures from this task](../test-results/reader-runtime-playback/fresh/playback.json) show its destination. `1001/22` retains Abby's authored end-phase `.25s` exit. The subsequent scene completes; there is no authored dialogue node `1001/23`. Older screenshot filenames containing `/23` or `1002/37` denote post-advance captures, not actual node IDs. The regression suite checks state inheritance, timing, dimming, removal and cleanup.

### Cartethyia audio

[48-second recording with AAC audio](../test-results/reader-runtime-playback/audio-final/1008-central-square-audio.mp4), **2.3 MB**. [Chapter timestamps](../test-results/reader-runtime-playback/audio-final/1008-recording-chapters.json) identify each cue. [PCM measurements](../test-results/reader-runtime-playback/audio-final/playback.json) contain zero page/resource errors and six successful checks.

| Authored point | Output verified | Maximum measured RMS |
| --- | --- | --- |
| Entry | `spring_day` on music plus `square_quiet` on effects | Music .03153 |
| /4 | Original audition cue on effects | Isolated audition .01790 |
| /33 | Authored `slience`; music removed while ambience continues | Music 0 |
| /35, +3s | Original `katixiya_sing` on effects; full 23.476s cue finishes before /44 | Isolated singing .03267; effects output also nonzero |
| /44 | Authored `slience`; no music or residual singing source | Music 0 |
| /45 | Original `spring_day` returns | Music .05413 |

The recording taps the same three channel gains connected to the AudioContext destination. Per-cue taps distinguish singing from street ambience; nonzero music-channel PCM establishes music playback independently of the event log. The recording contains actual decoded output, not an offline replacement soundtrack. FFprobe confirms H.264 video and AAC audio. Physical speakers and human hearing were not observed.

Music source coverage was repaired through the installed pak keyring/bank/media resolution and regenerated shared playback manifest. `spring_day` resolves original `404151635.wem`; audition resolves `467124566.wem`; singing resolves `79871984.wem`. The Wwise music-plan fix subtracts nonzero entry time from exit time even for a repeating segment: `spring_day` loops offset **2.4s**, duration **103.2s**, within its **105.600s** media. The previous length included the pre-entry interval and extended outside the media. This applies to other affected music plans. The current manifest has **274 events, 810 assets, zero unresolved authored event cues**, including all music. Existing scene cleanup preserves music/ambience and clears scene-owned effects; the successful Go out entry and singing output show no remaining cleanup or channel-routing failure for this case. Story voice variants still have separately recorded gaps.

### VFX

Every one of the **476 authored performances** is compared against original flow data, preserving exact prefab references, custom type, phase, start time, target, amplitude and stop identity. The previous extraction/validation repairs are retained. New shared playback fixes add Danger, Black and both SpeedLine material projections, render Fog using its actual noise dependency, treat Sound as rising music symbols, and animate BUG's glitch projection. Noise/VAT data is not substituted for a missing sprite.

[Compact onset/removal comparison](../test-results/reader-runtime-playback/captures/effects-onset-removal.jpg). Every row below passed painted onset, changed actual canvas pixel hash during motion, and removal by authored stop, scene completion or the documented Reader burst lifetime. Exact full asset paths are retained in [the manifest](../public/assets/reader-vfx/manifest.json) and the measurement records.

| Exact prefab name | Real authored node | Capture set |
| --- | --- | --- |
| UiItem_FxLoop_Danger | 6012/19; stop /26 | [MP4](../test-results/reader-runtime-playback/vfx-final/6012-19-Loop_Danger.mp4) |
| UiItem_FxStart_Black | 1015/40; automatic traversal to /44 | [MP4](../test-results/reader-runtime-playback/vfx-final/1015-40-Start_Black.mp4) |
| UiItem_FxStart_SpeedLine | 9013/13 | [MP4](../test-results/reader-runtime-playback/vfx-final/9013-13-Start_SpeedLine.mp4) |
| UiItem_FxStart_SpeedLineBlack | 8018/11 | [MP4](../test-results/reader-runtime-playback/vfx-final/8018-11-Start_SpeedLineBlack.mp4) |
| UiItem_FxLoop_PurpleHuaban | 1002/5; stop /11 | vfx-final |
| UiItem_FxStart_Butterfly | 1002/15 | vfx-final |
| UiItem_FxStart_Huaban | 1006/15 | vfx-final |
| UiItem_FxStart_Sound | 1008/36 | vfx-additional |
| UiItem_FxLoop_Fog | 3016/1; stop /3 | vfx-final |
| UiItem_FxLoop_SunGlow | 11007/103; stop /108 | vfx-final |
| UiItem_FxLoop_SunGlowBig_2 | 3016/9; stop /28 | vfx-final |
| UiItem_FxLoop_SunLight | 6006/4; stop /21 | vfx-final |
| UiItem_FxStart_Celebrate | 3009/1 | vfx-final |
| UiItem_FxLoop_Celebrate | 3009/2; stop /8 | vfx-final |
| UiItem_FxLoop_Huaban | 6003/27 | vfx-additional |
| UiItem_FxLoop_Star | 6018/6 | vfx-additional |
| UiItem_FxLoop_BUG | 7045/30; stop /39 | vfx-additional |
| UiItem_FxStart_GreenHuaban | 12003/84 | vfx-additional |

Measurements: [vfx-final](../test-results/reader-runtime-playback/vfx-final/playback.json), [vfx-additional](../test-results/reader-runtime-playback/vfx-additional/playback.json). The first contains 14 completed checks before a navigation timeout seeking Huaban removal; the second successfully completes the remaining four and repeats Sound after its final change. The earlier initial `vfx` attempt found Fog's zero-pixel failure and is superseded. No failed/incomplete case is counted as verified.

Additional effect types passed target/motion/removal checks: screen `BurstEye` at `3010/31`, screen `Shake` at `1002/6`, portrait `Shake` at `1001/10` ([completed first three](../test-results/reader-runtime-playback/custom/playback.json)); portrait `Sigh` at `1008/10` and `Jump` at `1001/12` ([final rendered-root checks](../test-results/reader-runtime-playback/custom-rendered/playback.json)). Sigh's actual draw root moves Y `-80→-85.055`; Jump's moves `720→727.410`, then both return to their original roots. The first custom run then failed to reach a skipped branch at `1004/18`; Sigh was verified at its independent real `1008/10` occurrence. A later harness assertion sampled an empty renderer map before the first draw; waiting for that draw fixed the harness and the final run passed. Jump/Sigh have only 160ms motion; post-probe screenshots can already show the settled pose. Their compositor clips and actual draw-root samples establish movement, not the screenshot filename.

## Reused evidence

Original managed-controller evidence, both Rover skeletons and animation metadata, gender/facing/head calibration, avatar/paper stacking and earlier pixel controls were reused. The existing extraction evidence for all 18 original prefabs, exact material/texture imports, 51 decoded textures, hashes and atlas layouts was reused without reopening or executing the native game. See [source VFX audit](READER_VFX_SOURCE.md), [rendering audit](READER_RENDERING_FIX.md), and [audio provenance](AUDIO.md). Completed captures made earlier during this task were retained as described above; fresh final Rover/audio checks were run again after the handoff.

## Still unverified or approximate

All 18 original prefab packages were found. Standalone effect bitmaps for **Danger, Black, SpeedLine and SpeedLineBlack** remain unverified; these now have visible Reader material approximations. **Fog, BUG, Sound, Butterfly, Huaban, GreenHuaban, Celebrate, PurpleHuaban, Star, SunGlow, SunGlowBig_2 and SunLight** use traced assets with Reader motion/shading. Native Niagara emission, shader processing, exact sequence curves/durations, tint and UV selection remain unverified. Screen/portrait **Shake** and **BurstEye/EyeOpen** also approximate native sequences. **Jump/Sigh** preserve traced distance and two 80ms phases; native easing and original game pixels remain unverified. Native equivalence is not inferred from successful Reader playback.

The bounded texture pass leaves these dependencies undecoded: `T_CommonDefault_UI`, `T_UI_Mask_300153`, `T_UI_Color_003`, `T_UI_Mask_009`, `T_UI_Mask_022`, `T_UI_Mask_023`, `T_UI_Normal_001`, `T_UI_Normal_007`, `T_UI_Normal_011`, `T_UI_Tile_21009`, `T_Shouanren_Butterfly_01_VAT`, `T_DefaultColorWhite_D`, `T_DefaultColorBlack_Linear_D`, `T_DefaultColorWhite_Linear_D`, `T_Default_Matcap_Metal`. Full paths/formats/reasons are in the manifest's `decodeLimitations`; they are not silently represented as decoded assets.

Rover replacement expressions approximate unavailable authored `wunai`, `yansu`, `nanguo` channels and gender-specific mouth variants. The native game's missing-clip handling remains unverified. Every authored VFX occurrence and every route was not manually replayed; source-wide comparison and shared runtime/route regression cover broader applicability. Missing story voice variants and movie audio are outside the completed music/singing check.

## Validation and reproducibility

- [Regression](../test-results/reader-runtime-playback/regression-passed.log): `npm test` — **375 passed**, 0 failed, plus Python asset preparation checks. Earlier failing regression logs are retained separately and are superseded by this passing run.
- [VFX source comparison](../test-results/reader-runtime-playback/vfx-source-tests.log): **5 passed**, covering all 476 source performances and all 18 prefab/texture identities.
- [Audio source checks](../test-results/reader-runtime-playback/audio-source-tests.log): **3 passed**, including keyring selection and the nonzero-entry loop range.
- [Production build](../test-results/reader-runtime-playback/build.log): `npm run build` passed. Vite retains its existing bundle-size warning.
- [Runtime receipts](../test-results/reader-runtime-playback/runtime-receipts.json) bind final observations to REA evidence, executable, scenario and exit status. [Verification index](../test-results/reader-runtime-playback/verification-summary.json) records selected measurements, hashes and clips.

Run `node tools/reader-runtime-playback-check.mjs` with `READER_PART=avatar|audio|vfx|custom` and a distinct `READER_RESULT_DIR`. Optional `READER_EFFECTS` and `READER_CUSTOM_EFFECTS` select effect names. The harness requires production `dist`, Chromium and FFmpeg; where shell loopback sockets are unavailable it can run through REA process capture. Source/build files used by playback match the passing build; subsequent changes are limited to the capture harness and evidence reports.
