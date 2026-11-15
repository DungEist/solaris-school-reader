# Phase 4 manual reading contract

> Historical phase report. [Phase 7](PHASE7_READER_STATE.md) supersedes its single-interface and hidden-branch/state policy; existing timing, reveal, history, and quiz contracts are preserved.

Phase 4 adds grapheme-based text reveal and manual controls to the existing English player. The schema 2 runner, stage scheduler, logical stage reducer, transitions, navigation, selected option performances and hidden-branch policy retain the [Phase 3 contract](PHASE3_TIMING.md). Development stops after Phase 4 for review.

## Initial inspection and preservation

The visible source started with full plain-text dialogue and the completed Phase 3 timing adapter. No Phase 4 reveal controller was present. No `AGENTS.md` was exposed in this workspace or its ancestors. `SPEC.md`, the timing contract and current runner/rendering code were inspected before implementation.

Native Git status/diff could not run: the managed workspace exposes an empty, read-only `.git` directory, and the worktree attachment list is empty. The 52 existing source/configuration/documentation files were copied with SHA-256 hashes to `/tmp/solaris-phase4-baseline-j2kq7qlp` before edits. A comparison against that baseline confirms no existing files were removed; every `src/engine/` file, the builder, dependency lockfile, assets/data code and Phase 3 timing document remain unchanged. `test-results/phase4.diff` records this turn's changes against the visible baseline; it cannot reconstruct a diff against an unavailable Git HEAD.

## Source evidence and unresolved fields

Source: `WutheringWaves_Data/BinData/flowState/flowstate.json`, branch `3.8`, revision recorded by Phase 3 as `49d65625340a32cec6851a12baedc03b5a630b25`. All 429 SolarSchool flows and 8,493 talk items were inspected, then compared with the neutral export. The builder already preserves the fields below in `node.raw`; no rebuild or schema change is needed. The ignored audit is `test-results/phase4-text-source.json`.

| Field | Source observation | Phase 4 treatment |
| --- | --- | --- |
| `DialogDelay` | Present on 771 nodes; 46 are zero; values range from 0 to 2.55. `1004/1` has 0.25. | Preserve as metadata. The tables establish neither units nor whether this delays dialogue appearance, text reveal, input, or another operation. It controls none of those behaviors here. |
| `ClickShowFull` | True on 8,246 nodes, false on 5, absent on 242. False occurs at `3016/36`, `3004/20`, `9011/54`, `9001/29` and `9001/49`, including ordinary talk/narration. | Preserve as metadata. Its name suggests click completion, but false/missing behavior and interaction with other timers have not been observed. The requested manual policy applies to all nodes, including false/missing values. |
| `WaitTime` | Present on 2,717 nodes, mostly zero. Some false `ClickShowFull` nodes also specify waits. | Retain the existing Phase 3 metadata policy. No waits or automatic advancement are introduced. |
| `TextAnimSpeed = 25` | SPEC lists a setting without defining units or a runtime formula. | Use a reader default of 25 graphemes per second. This is an explicit reader convention. |

No running-game comparison was performed. Source-field names do not establish game behavior, so they do not override the requested two-input reading policy.

## Text and reveal lifecycle

`FormattedEnglishText.ts` resolves gender branches and player-name tokens before revealing anything. Player names remain literal text, including angle brackets, entity-like strings, emoji and token-like strings. The parser constructs safe text runs in full; React renders their supported formatting through normal elements. It never inserts source HTML or reveals source tags incrementally.

Supported formatting is bold (`b`), italic (`i`), underline (`u`), strike-through (`s`), hex color (`color`) and line breaks (`br`). Common named entities and numeric Unicode entities decode once. Other wrappers, including the source `ano` annotations, retain their content without interpreting annotation/font/size semantics or arbitrary attributes. Unterminated source tags are omitted. Existing speaker-name/plain-text helpers retain their Phase 1–3 behavior.

`Intl.Segmenter` supplies grapheme boundaries over the complete resolved text. Combining sequences, skin-tone/ZWJ emoji, flags, punctuation, CRLF and clusters spanning formatting boundaries appear together. Formatting remains valid at every prefix. If a browser lacks `Intl.Segmenter`, the whole line is one reveal unit, avoiding broken Unicode.

`ManualReader.ts` owns an immutable reading snapshot, text timer, input guard and cancellation epochs outside React. Its state is separate from `RunnerSnapshot` and logical/stage state. It observes runner snapshots; text callbacks only publish reading state and never issue runner commands.

- Each run/visit/text identity starts a fresh reveal. Revisiting the same nid still creates a new reveal. Empty text is already complete; silent nodes retain their existing runner behavior.
- Timers sample elapsed monotonic time, so late callbacks catch up without extending the reveal. Every grapheme, including punctuation and whitespace, uses the configured interval; no source-derived pauses are guessed.
- Profile changes preserve the revealed grapheme count; an already-completed line stays complete. Changing speed retains progress and starts the remaining cadence at the new speed. Identical context/settings updates and subscription/rerender cycles retain the existing timer and progress.
- **Instant text** finishes the current line and makes future lines fully visible. Turning it off leaves the current line visible and affects new visits. The UI offers 5–100 graphemes/s; the controller accepts 1–200 for headless callers. Settings stay in page memory across restart/script switch; reloading restores 25 and instant text off.
- Departure retains full readable text while option/end phases run. Restart, load/script switch, new visits and disposal invalidate old callbacks. Cleared callbacks also check epochs, covering callbacks already queued by a clock.
- The entry point owns both reader and runner lifetimes, including unload/HMR. StrictMode subscription cleanup disposes neither. Disposing the reading layer alone leaves the stage scheduler active; disposing the runner cancels the observing reader too.

## Manual input

Advance, Space/Enter outside interactive/editable controls, and clicking or keyboard-activating the dialogue text area all use the same reading command.

1. If text is partial, the input completes only that text. It sends no runner command, changes no logical dialogue/stage state, settles no pending operations and selects no branch. Stage timers continue independently.
2. A separate accepted input after completion calls the existing `runner.advance()` path for ordinary dialogue. Choices continue to wait for selection. The reading layer uses a 200 ms guard across reveal/navigation inputs; the existing runner guard remains intact.
3. Visible choices are rendered in full and disabled until dialogue reveal and the input guard finish. Selection invokes `runner.choose()` once with the captured run/visit token. Choice clicks do not bubble into text advancement.
4. Hidden options still produce no ordinary choice buttons. Completing text never evaluates conditions or resolves an unknown branch. The existing explicit debug override remains available, including during reveal, and uses `runner.overrideHiddenChoice()` once.

Global shortcuts ignore inputs, selects, textareas, inherited editable content, buttons, links, summaries and common interactive ARIA roles. Composition, modifier combinations, already-handled events and held-key repeats are ignored. Focused Advance/text controls handle their own keys and suppress native/bubbling duplicates; choice/debug buttons suppress repeated activation. Stale callbacks carry visit tokens and cannot act on a later visit.

## Validation and limits

Before edits, all 87 existing tests and the Python asset checks passed. Final validation passes 103 tests plus those Python checks and `npm run build`. New coverage includes reveal-versus-advance, retained pending/active stage operations, grapheme/formatting boundaries, literal tokens, instant/speed changes, choice gating, rapid input, same-nid revisits, profile/subscription stability and deliberately raced cleared callbacks on restart/switch/departure/disposal. Actual React rendering checks verify valid formatted prefixes and no timer/event replay.

Real-data reading regressions verify that completing `1004/1` text keeps the hidden branch unresolved, then optionId 11 schedules exactly five performances once; `17048/2` optionId 5 records once and finishes without displaying nid 3. The existing full-data suite still covers all 429 scripts, 8,493 reachable nodes and 419 choice edges across 848 completed routes. The Phase 3 timed/interrupted/instant comparisons still pass.

Three controlled REA Chromium scenarios against the existing `http://127.0.0.1:5173/` Vite server completed all 55 declared actions. They exercised native mouse reveal, global and focused Space/Enter, triple clicks, input/select focus, speed changes, instant text, restart, Unicode profile rerenders, script switch and hidden override. DOM captures show unchanged stage/applied counts during text completion, zero hidden selections until explicit override, and five option events plus one selection afterward. Console/page-error capture in the hidden/control scenarios reports no errors or dropped events. The initial FinishTalk scenario retained action/locator outcomes only.

Evidence IDs:

- `ev_4a8c49da8f59807cb542e071eaad8499261e113f9086d33124d8e5db5abdecbe`: mouse/keyboard reading and real FinishTalk.
- `ev_c82218e1151483b4e8cbe8a7d856c28bef4bf7a1c0327b8be72da29ddb2b4982`: hidden reading, triple click, name-input Enter and explicit override.
- `ev_a5157e2ab5b3ba4d9d274f9f8e460933e0b8ed344ea63a78e9699e0eac672352`: global shortcuts, select focus, speed/instant settings, focused Advance, restart/switch and mobile controls.

The complete records are exported to ignored `test-results/phase4-rea-evidence.json`; a scoped summary and inspected screenshots are `phase4-browser-evidence.json` and `phase4-reading-{desktop,mobile}.png`. These scenarios used the [reverse-engineer-anything skill](/home/deist/.agents/skills/reverse-engineer-anything/SKILL.md). Each owned browser was terminated successfully. Screenshots capture particular scroll positions and reveal frames, rather than every layout/state.

`npm run test:browser:reading` was attempted, but the managed shell's socket restrictions prevented Chromium from starting (`setsockopt: Operation not permitted`, then CDP `ECONNRESET`). Its failure is retained in `test-results/phase4-browser-results.json`. Native REA checks supplied the browser evidence above. Held-key flags, editable/interactive routing and deliberately raced callbacks are additionally covered by unit/fake-clock tests; the standalone harness's complete mouse/key sequence remains unexecuted here. No HTTP wire-content or running-game timing claims follow from these checks.

## Exact playtest steps

1. Run `npm run dev`, open `http://127.0.0.1:5173/`, turn **Instant text** off and set **Text speed** to 5. Select script `17048`, press **Start**, and click the dialogue text while it is partial. The full first line appears; debug nid remains 1 and stage/event counts do not change because of the click. After the brief input guard, press Space outside controls to enter nid 2.
2. At `17048/2`, press Enter outside controls to complete its text. Its four choices become usable after the guard; Advance stays disabled at a completed choice node. Click **Maybe another time.** (optionId 5). The script completes, records one choice and never shows nid 3. Restart and try the Advance button or a focused dialogue area's Space/Enter; each input reveals or advances once. Rapid clicks/held keys must not consume a second input.
3. Select `1004`, press Start, then Advance while nid 1 is revealing. It completes the line and remains at the hidden choice with zero ordinary choice buttons/selections. Type a name or press Enter in a name/select control; that must not advance. Open **Debug → Hidden branch override**, select **Debug branch 1 · optionId 11**, and wait 0.2 seconds for its five performances. The reader enters nid 2 with one recorded override.
4. During any new line, change text speed, player name and gender. Progress should not restart; resolved text updates without extra stage events. Enable Instant text to finish the line, restart to see instant text from entry, then disable it and restart again to see a fresh reveal. Switch scripts during reveal and check that the new text remains stable. On a narrow viewport, the settings and dialogue controls should remain usable.

Repeat automated checks with `npm run test:reading`, `npm test`, `npm run build`, and, from a terminal that can start Chromium, `npm run test:browser:reading`. The full `npm run test:browser` also runs the existing stage/asset checks with instant text enabled.

No auto-play, skip, backlog, saves, audio/video, Spine, story progression or menu redesign was added.
