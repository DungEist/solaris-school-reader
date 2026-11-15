These notes record the original Changli integration and its verification at that time. The [full character report](ALL_CHARACTERS_INTEGRATION.md) records the current inventory, browser review and remaining blockers.

Changli (talker **850006**) renders through a small adapter observing persistent stage state and the existing timed presentation. Stage slot `999` selects its portrait through its expression. The current builder also preserves the source's explicit `speaker.json[999].AvgTalkerConfig = 850006` link in generated `speakers.json`; the earlier null join has been repaired. The runner contains no Spine code. A generic entry sequence distinguishes coalesced exit/re-entry snapshots.

The supplied local Spine Player **4.1.56** core loads the existing **4.1.23** skeleton, atlas, expression mapping and WebP-derived PNG from `public/assets/solarschool/characters/changli/`. These copies retain the existing cache ignore policy. `provenance.json` identifies the source directory and earlier WebP conversion; `SPINE-LICENSE.txt` accompanies the runtime. All rendering dependencies load locally.

Tracks 0–2 compose static body, mouth and eyes; track 3 plays a mapped verified blink once after an open-eye pause. Expression changes clear tracks and deformation, while presentation updates retain instances and playback time. Exit fades finish before disposal; hiding/exiting cancels blink timing and restores the mapped eye pose. Run changes, unmount and entry removal invalidate pending actor callbacks and frames. Missing assets/expressions produce labeled placeholders, and dialogue remains usable. Other characters remain placeholders.

Blink cadence is a **provisional viewer approximation** configured in `src/spine/ChangliBlinkCadence.ts` (`openPauseSeconds: [3, 6]`, also overridable through actor/scene options). The available `AvgSolarSchoolRoleAnimation`, `AvgTalkerConfig`, `SolarSchoolParam`, `SolarSchoolAvgParam` and `common_param` configs contain no applicable blink cadence. Expression `700039` separately maps `dongzuo1_jingya_zhengyan` and `dongzuo1_jingya_zhayan`; its blink lasts `0.5666666030883789s`. The earlier adapter continuously looped track 3; its expression guard already prevented restarts on identical snapshots. Each first/subsequent blink now follows a uniformly sampled 3–6 seconds of visible open-eye playback and runs at the original speed. Completion clears track 3 and residual deformation, then reapplies the existing static tracks. Timing uses the existing frame clock; expression/visibility changes and disposal cancel the countdown.

Placement is **provisional**: one bottom-center anchor and scale measured from expression `700048` apply to every expression on the existing 2560×1440 preview plane. Calibration lives in `src/spine/ChangliCalibration.ts`; the game pivot/canvas remains unresolved.

Start from your terminal:

```sh
npm --prefix /home/deist/Downloads/2ndsol run dev
```

Open **http://127.0.0.1:5173/?script=1009**, press **Start**, enable **Instant text**, and leave **Debug → Instant transitions** off. Watch Debug’s `nid`; wait at each timing checkpoint before advancing.

| Script | Exact checkpoints |
| --- | --- |
| `1009` | Nid **5**: expression `700048`, scale `1.02`, enter fade `.3s`. Select **Debug branch 2 / optionId 18**. Nid **8**: `700045`; **11**: dim; **12**: `700039` and highlight. At **13**, choose optionId **3**, “Um... I think there may be a misunderstanding.” Nid **20**: `700050`, scale `1.02→1.1` over `.7s`; **21**: dim; **22**: highlight and scale back over `.7s`. Choose optionId **7** at **23**, then **12** at **33**. Advancing from **44** starts the `.28s` exit fade. |
| [3007](http://127.0.0.1:5173/?script=3007) | Nid **1**: `.5s` enter. At **4**, choose optionId **2**, “All good. Nothing to worry about.” Nid **5**: `700050`, y `0→−16→0`, moves start at `.05/.32s`, each lasting `.22s`. Restart and choose optionId **3** at **4**: nid **9** holds static closed eyes (`700051`, no blink), then changes to open-eye `700041` after `.9s`; its first blink follows the configured pause. Advancing from **19** exits over `.5s`; from **28** re-enters over `.5s`; from **42** exits over `.5s`. |
| [9001](http://127.0.0.1:5173/?script=9001) | CG covers the portrait through nid **6** and clears at **7**. Nid **17**: `700046`; **21**: `700045→700050` after `.36s`; **23**: position `[20,0,1.02]→[-15,0,1.04]` over `.65s`, then exit on Advance. Silent nid **9004** re-enters before **26**. Advancing from **27** exits; **28** enters after **2s** with `hidePortrait:true`. Later expression changes keep it hidden; inspect persistent state in Debug. |

While Changli is visible, change player preferences and wait: blink playback should continue. Restart at `1009/12`: Changli clears until nid 5. Switch between `1009` and `3007`; advance rapidly through expression changes and across exits. Expect one current portrait, preserved stage timing and no resurrection from earlier loads.

For the blink correction, hold at **1009/12** for 15–20 seconds. Eyes should stay open for 3–6 seconds between short, original-speed blinks. Changing player preferences should retain the pending pause; advancing to a new expression starts a fresh pause.

**Verification:** The initial integration passed 157 JavaScript tests, typecheck and one production build (`test-results/changli-integration/tests.log`, `build.log`). This blink correction passed **35 relevant tests**, typecheck and one production build (`blink-build.log` in the same directory). Five new focused regressions check cadence bounds, one-shot speed, irregular frame timing, mapped-eye/deformation restoration, closed-eye preservation and cancellation during expression changes, exit, restart, script switch and disposal. Existing Changli mapping/lifecycle, real-script and React regressions also pass. Tests omit GPU drawing. **Browser rendering and visual calibration remain unverified until manual inspection.** Work stops here for review.
