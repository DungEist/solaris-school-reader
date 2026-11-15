Reader portrait brightness now refreshes from the current dialogue speaker before each line, narration, or centered-text visit executes its authored stage performances. A later explicit `Highlight`, `Darken`, or `None` cue can override that focus for the rest of the visit. A following text visit refreshes it again. Lines with no stage actions follow the same path. Silent `NoText` visits preserve focus while applying their own explicit cues.

The prior renderer read only the persistent `CharacterState.effect`. At `1008/63`, an earlier Darken could therefore keep Cartethyia dim even when she was speaking. The shared `StageTransitions` path now owns the current speaker and the explicit overrides. `CharacterState` still retains every authored effect, expression, position, and visibility flag. Speaker focus uses resource talker identity, so the entered Shorekeeper `1398` can speak through the named speaker `701282`.

The source ordering is established by the shipped `Aki.Game.dll` from the existing local 3.8.9 extraction. SHA-256 is `069bcb5b9c3d4d28780be8f51b59e7d52d2a9cbd8eab2c037f2a3be925db2049`; MVID is `793dfd03-0f45-4cd2-8afc-a8fedff89320`. [The local source report](../test-results/reader-speaker-lighting/original-speaker-lighting-evidence.json) retains the complete selected method bodies and their exception regions.

| Original method | Observed behavior |
| --- | --- |
| `VisualNovelTextAction.ExecuteCoreAsync` state machine, `0x06044006` | Sets the speaker at `IL_00D3`; refreshes speaking state at `IL_00E3`; creates and executes start performances at `IL_0121` and `IL_015E`; starts voice later at `IL_0229`. |
| `VisualNovelPlayer.RefreshCharacterSpeakingState`, `0x0602522E` | Compares each character's nonzero `AvgTalkerId` with `CurrentAvgTalkerId`, then calls `SetSpeaking`. |
| `VisualNovelSpineCharacter.SetSpeaking`, `0x06025277` | Sets `Highlight` when speaking and `Darken` otherwise. It overwrites an earlier differing effect even when the speaking flag has not changed. |
| `VisualNovelSpineCharacter.ResolveColor`, `0x060252AB` | Explicit Darken selects dim color; explicit Highlight selects speaking color; None uses the speaking flag. |
| Character Enter / Move state machines, `0x06043FE1` / `0x06043FEA` | Enter prepares speaking state before applying RoleConfig; Move applies its RoleConfig VisualEffect before moving. Explicit cues in both families retain priority. |
| `VisualNovelActionCenter.Create`, `0x06025058` | Creates a separate NoText action for silent items; line, narration, and center-text items use TextAction. |

The source color transition is 200 ms. Native Darken is `FColor(128,128,128,255)`, while Highlight is white. The Reader retains its existing calibrated RGB multiplier `.58`; native Unreal/LGUI color conversion and the original game's exact framebuffer output are outside the managed evidence. Brightness changes only RGB. Portrait opacity, avatar visibility, authored Spine animations, movement, and voice playback keep their independent clocks.

Checkpoint capture stores the current speaker and the explicit overrides. Restore reinstates them before projecting the stage, without executing source starts or replaying a color transition. Fast-forward settles visual tracks while preserving these decisions; starting or leaving a scene clears the lighting model.

The six focused regressions cover the real `1008/61–66` sequence, the `1006` speaker alias, voiced and unvoiced no-action lines, a delayed Darken and a Move Highlight, NoText cues, an in-flight opacity fade, and checkpoint restore at narration `1008/65`. They run with the existing Reader visual and Rover tests:

```sh
node --experimental-strip-types --test --experimental-test-isolation=none \
  tests/reader-speaker-lighting.test.ts tests/reader-visuals.test.ts tests/rover-avatars.test.ts
```

[The production browser check](../tools/reader-speaker-lighting-check.mjs) follows an uninterrupted New playthrough through the opening, Go out, the street, and Central Square. All advances and choices use normal Reader controls with Voice volume `0`. It checks the RGB and alpha submitted by the actual Spine renderer, reads opaque framebuffer pixels, and saves local screenshots. The second stage is `1004/3–6`, with Chisa and Abby visible together. Narration at `1004/5` explicitly highlights Abby and darkens Chisa; line 6 refreshes focus to Chisa. `1006/9–10` separately checks the resource talker alias.

At Go out, the check verifies that the outgoing canvas objects are disconnected. Street and Central Square narration each retain their own authored hidden Rover entry, with zero portrait opacity and dim RGB, before their visible characters arrive. The `1008/61–66` check saves at narration 65, restores after 66, and verifies the explicit Highlight without replayed stage events or color transitions. Advancing again refreshes Ciaccona's focus at 66. [The browser result](../test-results/reader-speaker-lighting/production-browser-result.json) contains measurements and capture paths.

The [source preservation audit](../test-results/reader-speaker-lighting/script-scan-resumed.json) compares all 429 indexed scripts and 8,493 nodes, including actor targets, lighting rows, and option performances. Structural route coverage is recorded separately from the normal playback measurements.

REA verified the original artifact identity, but its selected metadata inspection exceeded the 64 MiB representation budget. The selected bodies above came from the existing bounded `System.Reflection.Metadata` / `PEReader` inspector without executing the game. The source report retains both REA evidence IDs and that limitation. Original-game runtime playback was not performed for this task.
