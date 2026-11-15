Current Reader fixes and fresh playback verification (2026-11-16) are recorded in [READER_RUNTIME_FIX.md](READER_RUNTIME_FIX.md). Its music coverage and named VFX/avatar repairs supersede the earlier unresolved-coverage statements below; dated original-source evidence remains retained.

Reader VFX extraction now preserves each authored family selector, asset reference, CustomType, complete EffectConfig, portrait target, Amplitude, StartTime, phase and explicit StopScreenEffect. Full raw performances remain available, including additional or future parameters. The generated [cue inventory](../public/data/maps/vfx.json) contains 476 source performances: 293 portrait motions, 134 screen starts and 49 screen stops. The source comparison tests check every performance against its original flow JSON, including option performances and both start/end phases.

The previous extractor read only PersistentEffectPath. Consequently, OneShot Butterfly and Huaban both became the same `OneShot` label with no asset, and Custom Shake lost its CustomType. Extraction now selects OneShotEffectPath for OneShot, PersistentEffectPath for Persistent and CustomType for Custom. Asset usage and manifests include option performances too.

The authored cases are preserved exactly:

| Scene | Original action |
| --- | --- |
| 1006/15 | Butterfly OneShot at 0.0 s, followed by Huaban OneShot at +0.2 s; distinct complete prefab paths |
| 1002/6 | Screen CustomType Shake at 0.0 s; the source supplies no custom parameters |
| 1001/10 | Portrait Shake, target WhoId 1316 (Abby), Amplitude Medium, at +0.3 s |
| 11007/103 | Persistent SunGlow start at 0.0 s |
| 11007/108 | Explicit stop of the same full Persistent SunGlow path at 0.0 s |

Abby's authored 300 ms delay starts with node 10's start-performance phase. Its Move starts at 0 ms and lasts 300 ms; the Shake starts at that same phase's +300 ms boundary. They run alongside one another. The delay does not restart after arrival, dialogue publication, or voice start. The regression observes the pending cue and zero-time Move sharing `phaseStartedAtMs`, checks no Shake at +299 ms, and checks that arrival has settled when the Shake begins at +300 ms. The production check observes the same pending deadline and actual renderer frames against the real phase clock. The original TextAction executes start performances before its separate dialogue delay and later voice call.

The shared catalog accepts an explicit `primaryImage: null` for a prefab without a verified drawable bitmap. Previously that value rejected the entire real catalog, suppressing verified Butterfly, Huaban, and SunGlow textures as well. The loader regression checks all 18 authored references and exact drawable primaries while preserving the unresolved bitmap entries. Danger, Black, SpeedLine, and SpeedLineBlack have no verified primary bitmap and remain explicit limitations.

Screen Shake translates the complete player, including its background and dialogue. The Reader layout clips that translation with `overflow: clip`, preserving normal page scrolling for tall mobile content. The production check requires fixed layout dimensions throughout the Shake and verifies that the background and dialogue follow the same translation. It also saves original compositor frames for screen and Abby portrait motion, plus transparent VFX canvas captures for the bitmap previews.

All 18 authored prefab references resolve to selected installed packages. Their complete stored-payload SHA-1 matches the pak header, decoded length is checked, and decoded uasset/uexp SHA-256 values are retained in [prefab extraction evidence](../test-results/reader-vfx-source/prefab-extraction.json). Exact Unreal import tables link each prefab to its Niagara systems, materials and textures. The investigation resolved 159 dependency packages using 193 usable container indexes; 33 other indexes could not be decoded. No requested prefab or followed dependency was missing within that search.

The retained [asset evidence](../test-results/reader-vfx-source/asset-evidence.json) contains the native hashes, exact imports, material texture bindings, source SubImageSize values and texture hashes. Fifty-one texture PNGs are decoded from source BC7Prep data, checked for expected BC7 byte length and dimensions, and decoded through Pillow's BC7 DDS support. Decoder identity and the adaptation of DLL copies to the installed .NET 8 runtime are recorded in [decoder provenance](../test-results/reader-vfx-source/decoder-provenance.json). Native packages were never modified. REA evidence `ev_939f7c628c91f418ebd7df20e947aa88a2eaef1b0d3164efb5a978ff432b69e9` binds the decoder's selected original methods to CUE4Parse SHA-256 `7fb11a7a8e40983936294c536b8136258ce00acd122c109de8b9d94734369322`.

`python3 tools/prepare_reader_vfx.py` prepares the browser manifest and texture files from retained local evidence and decoded assets. It verifies each texture hash, dimensions and image mode before copying. It performs no network requests and never opens the game installation. The shared Reader renderer consumes [the prepared manifest](../public/assets/reader-vfx/manifest.json) by exact authored prefab reference.

| Family | Verified asset evidence | Remaining behavior limits |
| --- | --- | --- |
| Butterfly | Niagara `NS_Fx_LGUI_Xueyuan_Trail`; actual mesh Base texture `T_UI_Wenli_X140011`, transparent 256×512 wing | Reader mirrors textured wings for its bitmap preview; native 3D mesh, vertex-animation texture, trajectories, materials and emission are unverified |
| Huaban OneShot | `NS_Fx_LGUI_FeiXue_Huaban_Sparks` → material Base `T_UI_Sub_21042`; native 2×2 SubImageSize | Four pink petal variants are stable sprite choices; native particle selection, trajectory, size and shader processing are unverified |
| GreenHuaban | `NS_Fx_LGUI_Leaf_Burst` → Base `T_UI_Leaves_90001` | Native leaf atlas/UV selection, emission, tint and shader masking remain unverified |
| Sound | `NS_Fx_LGUI_JieZou_Lizi_Loop05` → Base `T_UI_Sub_45007`; native 3×3 atlas | Native symbol selection and particle behavior remain unverified |
| Celebrate OneShot | `NS_Fx_LGUI_Backpack_Burst6` → Base `T_UI_Sub_45016`; native 3×3 atlas | Native particles, trails and color mix remain unverified |
| Black | LGUI UISprite using `SP_CommonDefault` | A standalone effect bitmap and native black-overlay sequence curves are unverified |
| SpeedLine / SpeedLineBlack | LGUI UITexture using `MI_SpeedLine`, `_2`, `_3` and default texture | Procedural shader, variant colors and exact sequence behavior remain unverified |
| SunGlow | `NS_Fx_LGUI_Bulin` → Base `T_UI_Sub_Glow_70001`; native 4×4 atlas | Exact SubImageIndex selection, particle tint, distribution and shader processing remain unverified; authored persistent start/stop identity is verified |
| SunLight | Two source Niagara systems and traced glow/atlas textures | Native rays, bokeh mixture, tint and shader processing remain unverified |
| SunGlowBig_2 | `NS_Fx_LGUI_JiaNanHua_Glow_Loop` → `MI_UI_Lizi_21003` and its Base mask | Native glow color, intensity, distribution and final geometry remain unverified |
| Huaban Persistent | `NS_Fx_LGUI_QianDao_Flower` → Base `T_UI_Sub_HuaBan_21003`; native 2×2 atlas | Native petal distribution, tint and shader processing remain unverified |
| PurpleHuaban | `NS_Fx_LGUI_XLY_Flowers_Loop` → Base `T_UI_Sub_90005`; native 2×2 atlas | Native particle distribution, tint and shader processing remain unverified |
| Celebrate Persistent | Burst/confetti Niagara systems, including Base `T_Sub_X140009`; native 2×3 atlas | Native mixture, trajectories, bursts and color mix remain unverified |
| Star | Three source Niagara systems with traced flare/glow textures | Native sparkle mixture, timing and shader processing remain unverified |
| Fog | `NS_Fx_LGUI_Babieta_Screen` → Base noise `T_UI_Tile_017` plus other material inputs | Noise is identified as noise; native distortion, transparency and composite remain unverified |
| BUG | Three source Niagara systems and glitch/noise texture inputs | Exact native distortion, UV processing, selection and color channel offsets remain unverified |
| Custom Shake | Original renderer selects SolarSchool root sequence `Shake`; complete CustomType/config retained | Exact sequence asset curves and duration remain unverified; Reader screen target is verified separately through playback |
| Custom BurstEye | Original renderer selects root sequence `EyeOpen`; complete CustomType/config retained | Exact native eye-opening mask, curves and duration remain unverified |
| Portrait Shake | Original renderer selects the portrait's `shake` sequence; actor and authored Amplitude retained | Native sequence curve/duration remain unverified; native Shake does not consume the Distance derived from Amplitude |
| Portrait Jump / Sigh | Original controller's signed Y offset, Small/Medium/Large Distance 12/24/36 and 80 ms outward/80 ms return are traced | Native tween ease identifiers and original game pixels are separate from the Reader playback verification |

Native sequence PlaybackRange and TickResolution numerator were recovered for the imported effect sequences. The serialized FrameRate omits its denominator and complete native sequence playback was not observed; the asset manifest therefore leaves `durationMs` null instead of promoting a derived duration to verified evidence. Fifteen additional texture inputs use other native formats or layouts outside the bounded BC7Prep decoding pass, including VAT and normal maps. They remain listed in the prepared manifest's decode limitations. They are not rendered as petals or sprite assets.

The [per-cue verification report](../test-results/reader-vfx-source/cue-verification.json) links all 476 normalized performances to their source context and carries the relevant limits for each cue. Native GPU/material/sequence fidelity is not established by finding an asset or by successful Reader playback. Browser captures and playback checks validate the Reader implementation; they do not establish visual equivalence to native Niagara.

Validation: `python3 tests/reader_vfx_source_test.py` passes all five tests, including every original flow cue, distinct Butterfly/Huaban order, nested future Custom parameters, all 18 exact prefab references, all prepared image hashes/dimensions, native atlas layout evidence and the requested primary texture bindings. Audio extraction and audio/Spine playback code were not changed by this source/asset work.
