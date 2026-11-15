Abby's introductory movement uses script `1001`, stage identity `1316`, and expression talker `700005`. `10001` is absent from this dataset. The English dialogue verifies the sequence:

- Node 8: “Right, this should be the place from the message. But... nobody's here.”
- Node 9: “Excuse me? Your Uncle Abby's been waiting for thirty minutes already.”
- Node 10: “Hey, over here! Quit gawking. I'm right here—look down!”

The supplied recording, `/home/deist/Videos/Screencasts/Screencast From 2026-11-13 19-57-12.mp4`, shows these lines and Abby rising around 7.5–8 seconds as node 9 changes to node 10. It starts with Abby already visible during node 8. It provides evidence for movement direction, but does not show the full initial entry or establish the game's canvas/pivot calibration.

The root cause was `StageCoordinates.ts` subtracting source Y from CSS `bottom`. Increasing source Y therefore lowered both CSS portraits and Spine portraits. The corrected shared formula adds Y. No source data, timing, character calibration or animation implementation changed.

The complete transform is:

1. `StageScheduler` delivers the authored Enter/Move operations at their source delays. `StageState` preserves the raw `[x,y,scale]` targets. `StageTransitions` interpolates those raw coordinates using the authored duration; immediate presentation uses the same targets. No axis conversion occurs in scheduling or interpolation.
2. `StageCoordinates` maps to `left = 50 + 100*x/W`, `bottom = floor + 100*y/H`, retaining source scale. Default frame: `W=2560`, `H=1440`, floor `5%`. Stage X increases rightward and stage Y increases upward.
3. CSS placeholders and static portraits apply `left` and `bottom` inside the relative stage, then `translateX(-50%) scale(sourceScale)` about their bottom-center pivot. Their existing default floor remains `5%`; placeholder baseline calibration is separate from the assembled Abby portrait.
4. `PortraitCalibration` and `ChangliCalibration` compute `s = H * heightFraction / referenceHeight * sourceScale`. The stage reference point is `A = [W/2 + x, H*floor/100 + y]`. Skeleton translation is `T = A - s*localAnchor`. A Spine-local point `p` thus lands at `A + s*(p - localAnchor)`. Stage offsets stay outside the scale; negative local anchor values do not imply negative stage Y is upward. Source `portraitTransform` metadata remains separate and unused for placement.
5. Abby retains reference expression `700212`, local anchor `[-9.346443601606552, -1690.0095214843745]`, reference height `3302.838623046874`, height fraction `.34`, and floor `31%`. Chisa and Changli retain their own measured anchors, heights and floors. Expressions never refit those anchors.
6. `ChangliSpineActor.render` applies `T` to skeleton X/Y and `s` to both skeleton scales, then applies existing local animation tracks. The shared scene fills the stage canvas and uses Spine's upward-positive orthographic camera centered at `[W/2,H/2]`, with `zoom = max(W/canvasWidth,H/canvasHeight)`. Canvas top-origin pixel Y is `canvasHeight/2 - (worldY-H/2)/zoom`, so increasing world Y moves upward. There is no additional CSS flip on the canvas. Stage clipping, dialogue placement and canvas layout are unchanged.

For Abby's retained calibration, the corrected reference-anchor positions are:

| Operation | Source position | Start delay | Duration | World anchor Y | CSS-equivalent bottom using Abby's frame |
| --- | --- | --- | --- | --- | --- |
| Node 8 Enter | `[0,-1200,1]` | `0s` | immediate | `-753.6` | `-52.3333%` |
| Node 8 Move | `[0,-500,1]` | `.1s` | `2s` | `-53.6` | `-3.7222%` |
| Node 9 Move | `[0,-400,1]` | `0s` | `.2s` | `46.4` | `3.2222%` |
| Node 10 Move | `[0,0,1]` | `0s` | `.3s` | `446.4` | `31%` |

The reference anchor is deliberately allowed offstage. Under the retained provisional calibration, the initial entry is below the stage; the recording cannot validate that full entry. The old conversion instead placed these anchors at `1646.4 → 946.4 → 846.4 → 446.4`, reversing the rise. The corrected conversion preserves the final zero-Y placement and every zero-Y character's existing placement.

Focused regressions cover both Y signs, offstage coordinates, CSS static and animated placement, the supplied Spine camera's projection, scale-independent translation, fixed character pivots across expressions, Abby's delay and exact tween samples/destinations, immediate arrival, exit/re-entry, horizontal re-entry movement, restart/switch cancellation during delays and active tweens, and rapid advance with stale stage callbacks. Existing real Changli `1009`/`3007` and Chisa `1011` scenes, blink tests, all portrait adapter checks, and scheduler tests pass. Validation: 98 relevant tests, standalone typecheck, and one production build pass. Commands:

```sh
node --experimental-strip-types --test --experimental-test-isolation=none tests/stage.test.ts tests/timing.test.ts tests/timed-real-data.test.ts tests/school-portraits.test.ts tests/changli.test.ts tests/changli-real-data.test.ts tests/changli-blink.test.ts tests/all-school-portraits.test.ts tests/ui.test.ts
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

The recording was inspected directly, including its first frame and frames spanning the rise. Browser playback comparison could not run in the managed environment: Vite preview failed with `listen EPERM` on `127.0.0.1:4183`; Chromium failed at launch with `setsockopt: Operation not permitted`. The tests use real Spine geometry/camera math with GPU drawing omitted, plus actual React markup. Rendered appearance, exact game-relative size/placement and pixel agreement remain visually unverified.

Manual playtest from a normal terminal:

```sh
cd /home/deist/Downloads/2ndsol
npm run dev
```

1. Open `http://127.0.0.1:5173/debug?script=1001`, enable **Instant text**, press **Start**, and leave **Timing and transitions → Instant transitions** unchecked. Use Debug's `nid` to identify each checkpoint. Use Advance only after it becomes enabled.
2. Advance to node 8 and hold for at least `2.1s`. The raw position begins at `[0,-1200,1]`, holds for `.1s`, then rises to `[0,-500,1]` over `2s`. X and scale stay fixed. Inspect this complete entry separately from the recording, which starts later.
3. Advance to node 9 and wait at least `.2s`: Abby rises from `-500` to `-400`. Confirm the “Your Uncle Abby's been waiting…” dialogue. Advance to node 10 and wait at least `.3s`: Abby rises from `-400` to `0`. Compare this low-to-high change and the “Hey, over here!” line with the recording around 7.5–8 seconds. Absolute canvas/pivot matching remains provisional.
4. Restart with **Instant transitions** checked and revisit nodes 8, 9 and 10. Their immediate destinations must match the animated destinations. Turn it off before subsequent motion checks.
5. Continue to node 15, then Advance: Abby fades out over `.25s`. At node 20 she re-enters at `[0,0,1]` over `.25s`; after `.5s` she moves right to `[100,0,1]` over `3s`. Check that her Y, size and reference anchor stay consistent and only one current portrait is visible.
6. Restart during node 8's delay/movement and node 10's movement. Repeat by selecting `1009` and pressing **Start** during those movements. Wait three seconds; no old Abby movement or portrait should return. Revisit `1001` and advance as quickly as enabled through nodes 8–11: destinations settle in order and no prior motion resumes.
7. Open `/debug?script=1011`: Chisa enters at node 2; at node 8 choose the first response (optionId `2`); check node 24's scale `1→1.15` over `.7s`, node 26's replacement entry, and node 27's X `0→-560` over `.7s`. Open `/debug?script=1009`: check Changli's node 5 entry and choose Debug branch 2 (optionId `18`) to reach node 12. Check her existing placement, scale and entry lifecycle. For vertical movement, open `/debug?script=3007`, reach node 4 and select optionId `2`; node 5 should dip `0→-16` and return to `0` on the same actor.

Scope is limited to the shared Y conversion, its regression tests and coordinate documentation. UI layout, branches, blink cadence, authored timings, calibration constants, assets, exit/entry scheduling and unrelated engine behavior are unchanged. Reader UI redesign and Photocraft work remain deferred.
