# Phase 5 in-memory dialogue backlog

> Historical phase report. [Phase 7](PHASE7_READER_STATE.md) supersedes its single-interface and hidden-branch/state policy; existing timing, reveal, history, and quiz contracts are preserved.

Phase 5 adds a readable playtesting history to the existing English reader. The [Phase 3 timing contract](PHASE3_TIMING.md) and [Phase 4 manual reading contract](PHASE4_READING.md) remain in effect. Work stops after this phase for review.

## Inspection and preservation

No `AGENTS.md` was exposed in the workspace or its ancestors. `SPEC.md`, the Phase 3–4 reports, runner events/navigation/choice histories, formatted-text helpers and the React/manual-reading adapters were inspected before implementation. The broad SPEC includes persistence and history navigation; this phase follows the user's narrower in-memory scope without rewind.

Git status/diff could not run because the managed workspace exposes no usable Git metadata. The 58 existing source/configuration/documentation files were preserved with SHA-256 hashes at `/tmp/solaris-phase5-baseline-ofvw1ali`. `test-results/phase5-preservation.json` and `test-results/phase5.diff` compare this phase against that visible baseline, rather than an unavailable Git HEAD. No existing files were removed. The builder, dependency lockfile, data/assets modules, stage scheduler/reducer/transitions, text parser, ManualReader and Phase 3–4 reports remain unchanged. Existing Phase 3–4 evidence was preserved.

## Recording contract

`src/ui/DialogueBacklog.ts` is an external store owned by `main.tsx`, created before the runner starts. It observes existing runner events and issues no commands or timers. It does not reconstruct older resolved text from technical history.

- Dialogue and `choiceSelected` events now carry their source `visitId`. These are additive event fields; runner commands, navigation, `ChoiceEntry` and timing behavior are unchanged. Source identity matters because event delivery occurs after the command's final snapshot: selecting a choice may immediately enter another visit or complete the script.
- Every readable entry contains `scriptId`, `nodeId`, `runId`, `visitId`, a unique entry ID, kind, resolved speaker name and full immutable `FormattedEnglishText`. Dialogue and selection use separate identities within the same visit. Repeated event delivery, subscriptions, settings changes, stage samples and typewriter ticks cannot create duplicate entries. Revisiting a nid creates a new visit and entry.
- Speaker names use the existing resolver. Full text uses the Phase 4 parser, including safe formatting, Unicode and literal player names. Resolution happens at dialogue entry or choice selection. Profile/catalog edits affect future records without rewriting older speaker/text snapshots. A choice uses its selection-time player name and response label.
- Silent nodes and dialogue whose resolved text is blank after trimming are omitted. Existing readable missing-text/speaker fallbacks remain consistent with the player. A selected visible option with an empty label records the existing `Choice N` fallback.
- Only accepted visible selections become readable choice entries, in chronological order before destination dialogue. Unselected options are absent. Hidden `debugOverride` selections, conditions, option IDs/actions/performances and other technical metadata remain in the existing Debug histories/events. Nothing evaluates hidden conditions or infers a branch.
- Explicit **Start** clears readable history before asynchronous loading. New runner runs from load/restart reset both entries and deduplication. Explicit clear retains already-seen visit identities so the current line cannot be backfilled by a duplicate event. Completion retains entries. Disposal removes subscriptions; late events from another run are rejected.

## History panel and timers

**History (count)** is available before play and after completion. `HistoryPanel.tsx` opens a native modal `<dialog>` with a labelled heading, Close button, explanatory note, focusable scroll region and ordered static entries. It renders complete documents through the existing `RevealedText` component. Entries have no navigation or selection callbacks.

Opening focuses Close; Tab reaches the scroll region. Escape uses the native cancel event to close, and cleanup restores the captured History opener with its scroll position preserved. The native modal traps focus and makes the surrounding page inert. A synchronous open-state guard also blocks global reading shortcuts and advance/choose/restart/debug command callbacks. Underlying reading and choice controls are disabled. Panel key/click events stop bubbling; repeated key activation of its buttons is suppressed.

The panel's lifetime effect does not depend on entries or clock samples. It is memoized, so text/stage rerenders do not reopen it or reset focus/scroll. These subscription/effect cycles do not dispose, restart or command the runner.

**Existing timers continue while History is open.** This includes text reveal, start/option/end operations and visual transitions. A departure requested before opening can complete and append its destination dialogue to the open panel. History does not finish text, settle stage queues, select choices or navigate on its own. The Phase 4 reveal-versus-advance policy resumes when history closes. `DialogDelay`, `ClickShowFull` and `WaitTime` retain their existing metadata treatment.

Entries live only in page memory. Start/Restart clears them; completion retains them; a page reload loses them. No persistence, rewind, auto-play, skip, saves, media, Spine, progression or menu redesign was added.

## Validation and browser limits

Preflight passed the 103 existing tests and Python asset checks. Final focused validation passed 31 backlog/reading/React tests. `npm test` passes **115 tests** plus Python asset-pipeline checks; `npm run build` passes TypeScript and the production bundle. Logs are `test-results/phase5-{preflight,focused-tests,tests,build}.log`.

Ten new backlog tests cover full text during partial reveal, duplicate prevention, same-nid revisits, immutable speaker/name/gender/Unicode/formatting snapshots, silent/blank exclusion, choice fallback/ordering, source visit identity after immediate navigation, explicit clear/start/restart, completion, duplicate/stale event delivery and disposal without disturbing timers. Two new actual React rendering checks cover full formatted history, accessible structure, static selected responses and empty history without event/timer replay. Existing Phase 3–4 fake-clock, input and complete-data route checks still pass.

Real-data regressions verify:

- `1004/1`: completing text does not select the hidden branch. Explicit optionId 11 records one Debug override and exactly five option performances; readable history contains only dialogues 1 and 2.
- `17048/2`: optionId 5 records “Maybe another time.” once, completes without visiting nid 3 and retains two dialogue entries plus the selected response until restart.

Three controlled REA Chromium scenarios against `http://127.0.0.1:5173/` completed **111 declared actions**, with no captured console/page errors or dropped events. Native modal/focus selectors verified Close focus, Tab to the scroll region, Escape restoration and mouse Close restoration. DOM comparisons verified keyboard/click isolation, full Unicode snapshots, profile edits, choices, completion, restart and movie-only empty history. The hidden override's pending queue finished while history stayed open, and its destination added one entry. A ten-entry mobile history remained scrolled to the latest entries through continued text ticks; its screenshot was visually inspected.

Evidence IDs:

- `ev_9c423e9028ec00bcd4d92620e31b700d19b6ecad3931534becffc0d347edbf73`: empty/partial history, Unicode snapshots, Space/Enter, static entry clicks, profile edits and focus restoration (29 actions).
- `ev_5541ce13c28d12f4f26a6d6bb3d6a0c105ee55abef645ac6321a9f4c1106c7a9`: visible choices, completion/restart, unresolved hidden branches and continued option timing (42 actions).
- `ev_dd2feb93bbd55e071bcd733a814492df7d0bcc1b686bd92ff6a6c67210947533`: movie-only empty history, ten visits, mobile keyboard scrolling and continued reveal (40 actions).

Complete records are exported to ignored `test-results/phase5-rea-evidence.json`; checked assertions/limits are in `phase5-browser-evidence.json`. Screenshots are `phase5-history-{controls,desktop,mobile}.png`. These checks used the [reverse-engineer-anything skill](/home/deist/.agents/skills/reverse-engineer-anything/SKILL.md). Every owned browser was terminated.

An initial scroll assertion targeted exactly ten revealed graphemes and timed out; its captured text had reached 25. The corrected assertion waits for at least ten and completed successfully. That incomplete attempt is retained as `ev_1c4f1164ddad184703ce214f19e4043e09fd502594582fe332fa9879b246aa5c` alongside the complete records.

`npm run test:browser:history` was attempted, but the managed shell prevented Chromium from starting (`setsockopt: Operation not permitted`, then `ECONNRESET`). Its failure is retained in `phase5-browser-harness.log` and `phase5-browser-results.json`; the full standalone harness sequence remains unexecuted here. Native REA checks supplied the browser evidence above. They use the development server, with the production build checked separately. Mobile is an emulated 390 × 844 viewport; no physical-device or screen-reader run was performed. Duplicate/raced events and held-key flags are additionally covered by automated tests. No running-game behavior is inferred from these checks.

## Exact playtest steps

1. Run `npm run dev` and open **http://127.0.0.1:5173/**. Open **History** before starting: it is empty, Close receives focus, Tab reaches the scroll region, and Escape restores focus to History. The runner remains idle.
2. Search `x1`, set Player name to `Archive Sol é 👩🏽‍🚀`, choose Male, disable Instant text and set Text speed to 5. Press Start and open History during reveal. It contains the full “Welcome back” line once. Press Tab, Space and Enter in the scroll region, or click its entry: nid stays 1 and no choice/stage event is caused by those inputs. Escape closes it and focuses History.
3. Change the name to `Later Luna` and Gender to Female; enable Instant text. The current line updates. Reopen History: its older name/text remains unchanged. Close with the mouse and check focus returns to History. Press Advance after the brief guard to visit nid 2: one new entry appears. Reopening History or changing settings adds no entry for an existing visit.
4. With Instant text enabled, advance `x1` to nid 9, waiting about 0.2 seconds between accepted inputs. Disable Instant text and advance to nid 10. Open History, Tab to its scroll region and press End or use the wheel. There are ten entries. Wait at least two seconds: text reveal continues behind the panel, nid stays 10 and history stays scrolled. Try a narrow viewport. Escape closes; click Advance to complete partial text, then advance again after the guard.
5. Enable Instant text, select `17048` and press Start: prior history clears and the first line is recorded. Advance to nid 2, open History and verify two dialogue entries with no selected response. Panel Space/Enter must select nothing. Escape, then click **Maybe another time.** (optionId 5). Completion history contains two dialogues and that response once, with no nid 3. Restart replaces this with the new run's first line.
6. Select `1004`, press Start and open History at nid 1. Hidden options remain unresolved; its readable history contains only dialogue. Escape, open **Debug → Hidden branch override**, and select **Debug branch 1 · optionId 11**. Open History promptly: any still-pending option timings continue, then nid 2 appears. Readable history has two dialogues; Debug has one override and five option performances. No hidden response is added to the readable list.
7. Select `1053` and press Start. Its movie-only flow completes with empty readable history. Repeat `npm run test:history` for fixture-based revisits, blank/silent nodes and stale deliveries; run `npm test` and `npm run build` for all regressions. From a terminal that can launch Chromium, run `npm run test:browser:history` to repeat the standalone mouse/keyboard checks.

Stopped after Phase 5 for review.
