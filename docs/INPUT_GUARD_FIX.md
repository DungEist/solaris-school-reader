**Reading input guard regression — fixed; stopped for review.**

Completing partial text now keeps the current dialogue and releases the existing 200 ms input guard. A later deliberate input follows the normal runner path once. Rapid clicks, restart, script switch and History do not leave a permanent reading lock.

The cause was a lost timer wake in `ManualReader`. Its guard uses a monotonic deadline, but the old timeout callback cleared its handle and published only once. If it arrived slightly before that deadline, the published `inputReady` stayed false. Completing text also cancels the reveal timer, leaving no callback to publish readiness afterward. `PlayerView` correctly derives its disabled controls from that snapshot, so text/button inputs remained blocked even though time had passed. The controlled browser reproduction had History closed, a ready runner, fully revealed text, zero pending operations and zero active visual tracks.

A related race existed in `ScriptRunner.scheduleFrame`: readiness was sampled for the snapshot, then the clock was sampled again to decide whether to schedule its release wake. Crossing the deadline between those samples could publish false readiness and omit the only remaining wake.

The production changes are limited to two files:

- `src/ui/ManualReader.ts`: schedule the remaining time to the original guard deadline, and ensure every published temporary lock retains a wake. An early wake re-arms the remaining interval. Timer handles and cancellation epochs prevent old callbacks from releasing a newer guard; restart and script loading reset the run's guard, and disposal cancels it.
- `src/engine/ScriptRunner.ts`: schedule the frame/guard wake from the same `snapshot.clockMs` sample used for published readiness and presentation. The callback still samples the current clock, emits no stage events, and retains existing cancellation checks.

The 200 ms guards, visit tokens, control eligibility, hidden override path, History focus isolation, stage scheduler, stage transitions and backlog recording remain intact. There is no forced enabling of Advance or added timeout window. Reveal completion sends no runner command. Choices and pending departure phases still gate normal advancement.

Six regressions were added across `tests/reading.test.ts` and `tests/ui.test.ts`, using `TimerPrecisionClock` in `tests/FakeClock.ts`. They cover early guard delivery, partial reveal → completion → guard expiry → advance, repeated inputs and superseded callbacks, restart/script switch during a guard, a runner deadline crossed between samples, genuine choice/end-phase blocking, and the rendered React Advance state. Five regressions failed against the saved pre-fix code; the additional blocking-state check preserves existing behavior. The development-only `tests/input-guard.html` entry renders the real App and source data with deliberately early reading timers. It is absent from the production entry/bundle.

The browser checks used native Chromium mouse and keyboard actions through the [reverse-engineer-anything skill](/home/deist/.agents/skills/reverse-engineer-anything/SKILL.md). Three completed post-fix scenarios contain 86 declared actions:

| Check | Concrete result |
| --- | --- |
| Pre-fix controlled early wake | Clicking partial `1001/1` completed its text, but readiness remained false after the 1.8-second recovery wait. Advance/text were disabled; no navigation occurred. The expected recovery assertion timed out. |
| Post-fix text/button/keyboard | Both the normal page and early-timer fixture released their guards. Completing text and waiting changed no runner events, node or History count. Subsequent deliberate inputs visited nodes once: normal route 1–4 and fixture route 1–5. Space completed text; Enter advanced after release. |
| Rapid Advance | Triple clicks completed the current partial text once. The button recovered, and a later click advanced once. Dialogue visits, navigation and History counts matched exactly. |
| Restart/script switch | Restart during a guard entered run 2 at `1001/1` with History (1). Switching during another guard entered run 3 at `17048/1`. New guards released and both runs remained readable. Cleared-callback races are also covered by unit tests. |
| History | A guard expired while History remained open. Space/Enter in its scroll region changed no runner events. Escape restored focus to History and reading resumed. Existing timers continue while the panel is open. |
| `1004/1` hidden choices | Completing text and pressing Enter left zero choices selected, Advance disabled and the branch unresolved, including after its visual tracks ended. Triple clicking explicit optionId 11 selected once, delivered exactly five option performances and reached node 2. Readable History held two dialogues and no hidden response. |
| `17048/2` FinishTalk | Triple clicking optionId 5 selected once and completed without node 3. History retained two dialogues plus “Maybe another time.” once. |

Browser evidence IDs are `ev_4180ae98ba49f4c156cc2a2c713a30e69d65b76340490803dd4d34313934687f` (expected pre-fix failure), `ev_5225c6404c66914e75f5439ee26673a07f65b7ad24c38c9908ee3822b62c81ba` (early-wake reading/History), `ev_c882f160f6c2e815e9a6570a28b5287f78d8e563972e936a413b930ed2fdf93b` (restart/switch/FinishTalk), and `ev_97664e172138e53db1abfe1505907cb011b3436509a565e2ea23d9ec7a184fa5` (normal page/hidden choices). Full captures are retained in ignored `test-results/input-lock-browser-evidence.json`; checked event/DOM comparisons are in `input-lock-verified-summary.json`. The before/after screenshots were inspected. Every owned browser was terminated and no capture dropped events. The before and first post-fix fixture captures recorded a favicon 404; there were no page errors. The lifecycle and normal post-fix captures had no error-level console events.

`npm run test:reading` passed 35 tests. `npm test` passed 121 tests plus Python asset preparation checks. `npm run build` passed TypeScript and the production bundle. Logs are `test-results/input-lock-{before-tests,reading-tests,tests,build}.log`.

Verification limits: ordinary-clock pre-fix browser attempts recovered, so reproducing the intermittent failure required controlled early timer delivery through the actual App. Post-fix checks used Chromium 156, headless, on the Vite development server at 1280 × 720; the production build was validated separately. No other-browser, physical-device or screen-reader run was performed. The related runner sampling race is covered by an injectable clock regression.

Native Git inspection was attempted first, but this managed workspace exposes an empty read-only `.git`; `AGENTS.md` is also absent from the workspace and its ancestors. The existing SPEC and Phase 3–5 reports/code were inspected. Comparisons against `/tmp/solaris-input-lock-baseline-qwkiknhp` preserve all pre-existing files, with only the two production edits above, test additions and this report. `test-results/input-lock.diff` and `input-lock-preservation.json` record that comparison; they cannot reconstruct an unavailable Git HEAD. No new phase was started.

Exact playtest steps:

1. Run `npm run dev` and open `http://127.0.0.1:5173/`. Leave Instant text off, set Text speed to 5, search `1001`, and press Start.
2. While node 1 is revealing, click the dialogue text. Its full text appears; node 1 and History (1) remain. Wait for the existing 200 ms guard to release, then click Advance: node 2 and History (2) appear once.
3. Triple click Advance during node 2's reveal. It completes only that line. After the guard, click Advance once to reach node 3 and History (3). Use focused dialogue Space to complete node 3, then Advance Enter after release to reach node 4 once.
4. Complete a partial line and immediately Restart. Complete the restarted line, wait for release and advance. Prepare `17048` in the script selector while `1001` is still running, then complete or advance its current line and immediately press Start. The new script starts with fresh History and accepts reveal/advance normally. At node 2, complete text and select “Maybe another time.” (optionId 5): completion retains three readable entries and no node 3.
5. Open History immediately after completing text. Tab to its scroll region and press Space/Enter; dialogue stays put. Escape restores focus to History; click Advance after closing and guard release. Text/stage timers may continue behind the panel.
6. Start `1004`, complete node 1's text and wait past the guard. Advance remains disabled and Enter selects nothing. In Debug, choose “Debug branch 1 · optionId 11”; verify one recorded override, five option performances, node 2 and two dialogue entries in History.
7. Repeat steps 1–5 at `http://127.0.0.1:5173/tests/input-guard.html` to exercise the deliberately early timer fixture. Run `npm run test:reading`, `npm test` and `npm run build` for the automated regressions.
