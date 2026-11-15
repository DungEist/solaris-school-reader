These notes record the Chisa/Abby integration and its verification at that time. The [full character report](ALL_CHARACTERS_INTEGRATION.md) records the current inventory, successful production-browser checks, representative screenshot review and remaining blockers.

Chisa and Abby render assembled local Spine portraits through the existing stage presentation. Recovery retained the completed implementation and exports; the remaining verification and review notes are now complete. Changli's integration and corrected blink cadence remain intact.

| Portrait | Source talker | SolarSchool asset | Local compositions | Placement config |
| --- | --- | --- | --- | --- |
| Chisa | `850014` | `SolarSchool_Qianxiao` | 14 verified rows; 12 referenced by the generated manifest | `src/spine/ChisaCalibration.ts` |
| Abby | `700005` | `SolarSchool_Abu` | 23 verified rows; 22 referenced by the generated manifest | `src/spine/AbbyCalibration.ts` |

Both talker IDs, SolarSchool atlas/skeleton references and default expressions (`700152` / `700212`) match the local `AvgTalkerConfig` data. Expressions select the talker independently of stage `who` and dialogue speaker. Chisa's unused legacy test row `700009` references absent clips; it remains in source metadata and is excluded from verified compositions. All manifest expressions for both characters compose against their own Spine **4.1.23** skeletons.

Each character has separate resources, actors, canvas and calibration, sharing the supplied local Spine Player **4.1.56** runtime and its existing license. The stage adapter observes persistent state and timed presentation; it consumes no stage events. Source fades, movement, scaling, visibility and entry lifecycle continue through the existing engine. Missing assets or invalid compositions show one named fallback and preserve reading controls. Other characters remain placeholders.

Chisa uses a fixed reference anchor from expression `700152`, with height fraction `.84`. Abby uses expression `700212`, height fraction `.34` and floor offset `31%`, giving the mascot its own smaller, floating placement. Expressions do not trigger bounds fitting. These are **provisional viewer placements** on the existing 2560×1440 plane. Source `portraitTransform` fields stay metadata. The saved bounded controller inventory of `pakchunk70-WindowsNoEditor.pak` contains zero matching entries; it does not establish the game's pivot, canvas or controller behavior. Recovery performed no further controller scans or extraction.

Mapped blinks use the existing **3–6 seconds of open-eye playback**, followed by an original-speed one-shot clip and restoration of the mapped pose. Closed-eye and star-eye expressions without blink mappings stay in their source poses. Abby's verified `.20000001788139343s` normal open-eye clip plays once and holds its last key while the separate blink track runs. Changli's cadence, calibration, skeleton, atlas, PNG, expression metadata, runtime and license match the saved pre-integration hashes. The previously completed shared adapter/scene/runtime-loader changes are retained and covered by Changli regressions.

Recovery reused `/tmp/solarschool-chisa-abby-resume/exports/` and the saved Changli extraction helpers. Installed skeleton/atlas/metadata copies match those exports and their provenance hashes. Both metadata files exactly match their character's source expression rows; installed PNG pixels match the existing local WebP sources. No assets were downloaded or re-extracted. PNGs are WebP-derived, not game texture exports.

**Focused verification:** 44 tests pass, covering character mappings/compositions, stable placement, Abby's nonzero eye pose, one-shot blinks, closed/star eyes, shared runtime caching, source fades/movement, exit/re-entry, stale-load cancellation, Changli's blink correction and React loading/fallback rendering. Typecheck and the production build pass.

```sh
node --experimental-strip-types --test --experimental-test-isolation=none tests/school-portraits.test.ts tests/changli.test.ts tests/changli-blink.test.ts tests/changli-real-data.test.ts tests/ui.test.ts
npm run build
```

Small verification logs remain in `/tmp/solarschool-chisa-abby-resume/`. The prepared browser check could not serve HTTP (`listen EPERM`); a fallback using the existing compiled-page helper could not launch Chromium (`setsockopt: Operation not permitted`, pipe reset). Tests exercise the real Spine runtime without GPU drawing. **Browser rendering and visual placement still require manual review.** No large evidence bundle was generated.

Run from a normal terminal:

```sh
npm --prefix /home/deist/Downloads/2ndsol run dev
```

Press **Start**, enable **Instant text**, and leave **Debug → Timing and transitions → Instant transitions** off. Watch Debug's `nid` and wait at each checkpoint before advancing.

| Script | Exact playtest checkpoints |
| --- | --- |
| [1011](http://127.0.0.1:5173/?script=1011) — Chisa | **2:** `700152` enters over `.3s`; hold 15–20s to inspect open-eye pauses and short blinks. At **8**, choose the first response (`optionId 2`). **20:** `700158` holds closed eyes without blinking. **24:** `700163` scales `1→1.15` over `.7s` without a new anchor. **26:** source Enter replaces the entry over `.5s`. **27:** Chisa moves x `0→−560` over `.7s`; the other character enters at `.7s`. |
| [1001](http://127.0.0.1:5173/?script=1001) — Abby | **8:** starts at y `−1200`; after `.1s`, expression becomes `700216` and rises to `−500` over `2s`. Wait at least `2.1s`. **9:** `700226` rises to `−400` over `.2s`. **10:** `700212` rises to y `0` over `.3s`; hold 15–20s to inspect its open-eye hold and separated one-shot blinks. **15:** `700222`; Advance starts a `.25s` exit fade. **20:** `700224` re-enters over `.25s`; after `.5s`, moves x `0→100` over `3s`. Unsupported Jump/Shake effects remain debug metadata. |
| [1009](http://127.0.0.1:5173/?script=1009) — Changli regression | **5:** existing `.3s` entry. Select **Debug branch 2 / optionId 18**, advance to **12**, and hold 15–20s: short original-speed blinks separated by 3–6s of open eyes. Existing placement should match the prior integration. |

While each portrait is visible, edit player preferences: the actor and pending blink pause should persist. Restart `1011/2`, `1001/10` and `1009/12`; each old portrait clears until its next source Enter. Switch scripts with the selector and **Start**, then advance rapidly across expressions and exits. Expect one current portrait per source entry, no duplicate fallback and no resurrection from an earlier load. Work stops here for review.
