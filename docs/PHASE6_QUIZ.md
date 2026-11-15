# Phase 6 embedded SolarSchool quizzes

> Historical phase report. [Phase 7](PHASE7_READER_STATE.md) supersedes its single-interface and hidden-branch/state policy; existing timing, reveal, history, and quiz contracts are preserved.

Phase 6 supports the 16 exported exam questions embedded in six SolarSchool scripts. Questions show their English title, prompt, illustration and answers; selection uses the source correctness flag, and manual **Continue** resumes the existing script path. The recovered implementation passes focused tests, the full local suite and the production build. Work stops after Phase 6 for review.

## Interrupted-session audit

The working tree, saved test results, Phase 6 source inventories and raw data were inspected before edits. No `AGENTS.md` was exposed in the workspace or its ancestors. The workspace's `.git` directory is empty/read-only, so native `git status` and a diff against HEAD are unavailable. `git diff --no-index` against the saved pre-Phase-6 baseline supplies the review diff.

The saved baseline at `/tmp/solaris-phase6-baseline-ocmqxyia` contains 517 file hashes. At recovery, 29 of those files had changed, seven files had been added, and none were missing. The completed work already included:

- `build_data.py` exports complete exam models, attaches them to source performances, registers English keys and illustration usage, and reports unresolved joins/answers.
- `Quiz.ts` and `QuizValidation.ts` provide immutable state, stable answer IDs, explicit correctness validation and unresolved results. `ScriptRunner` pauses for quizzes without discarding the visit or pending navigation.
- `QuizView`, the reader adapter and Debug render answers/results, block conflicting inputs, and expose raw metadata and an explicit debug result override.
- The asset resolver, repository and local asset pipeline support the `IconExam` directory and reuse six files for 16 questions.
- Fixture, raw-data, six-script integration, React render and Python asset tests were present. Previous logs reported 29 focused tests, 140 full-suite tests and a successful build.

That work was retained. Recovery added this review, updated the README and browser title to Phase 6, clarified the quiz control hint and made the unresolved result message explicit. It also documented the quiz outputs in the data builder's module description. The engine, quiz reducer/validator, tests, dependencies and generated quiz data were retained without implementation changes. Fresh verification is recorded below.

`test-results/phase6-recovery-inventory.json` lists the interrupted-session changes. `phase6-recovery-existing.diff` records the existing delta against the saved baseline. The recovery snapshot and initial file hashes are at `/tmp/solaris-phase6-recovery-xa_l0r_g`; no separate `phase6-recovery.diff` was saved. The follow-up review's `phase6-current-existing.diff` records the full current delta against the pre-Phase-6 baseline. Previous Phase 3–6 evidence and logs were retained.

## Raw source contract

The source is `WutheringWaves_Data`, revision `49d65625340a32cec6851a12baedc03b5a630b25`. These files were read directly:

| Source | Verified fields and role |
| --- | --- |
| `BinData/flowState/flowstate.json` | JSON in `Actions`; `ShowTalk.Params.TalkItems`; start/end `ActivityAction` performances with `ActivityActionConfig.Type: SolarSchool` and `SolarSchoolActionId` |
| `BinData/ActivityAction/activityactionclienttype.json` | Type 8, `TypeName: 第二索拉考试选项`, `StopUltraFastForward: true` |
| `BinData/ActivityAction/activityaction.json` | Matching action ID, `ActionType: 8`, and the single `ActionParams` entry `{Key: Id, Value: <question ID string>}` |
| `BinData/SolarSchool/solarschoolexamevent.json` | 16 question rows: `Id`, `ChoiceGroupId`, `Title`, `Desc`, `Image`, `AddScore` |
| `BinData/SolarSchool/solarschoolexamchoice.json` | 48 answer rows: `Id`, `GroupId`, `TextKey`, explicit boolean `IsCorrect` |
| `BinData/SolarSchool/solarschoolparam.json` | `ExamResultHoldDuration.IntValue: 1500`; its comment explicitly specifies milliseconds. Hero/Heroine correct/fail Spine ID lists are retained as result-related configuration. |

There is no separate question TalkItem type in these flows. Scanning all 429 SolarSchool flowstates found 16 matching performances: 12 on `VisualNovelNoTextItem` start phases, two on `VisualNovelNarration` end phases and two on `VisualNovelTalk` end phases. All have `StartTime: 0` and no ordinary `Options` at the trigger node. Silent quiz nodes must wait for input instead of being skipped automatically.

The join uses the action's question ID, then `question.ChoiceGroupId → answer.GroupId`. Question and answer table order is preserved, including question IDs 3 and 6 near the end of the question table. Answers use their own stable IDs, independently of dialogue option indexes and AVG option IDs. Each current question has three answers and one explicit correct flag. All title, prompt and answer keys resolve to nonblank English.

For question 1, `Title: SolarSchool_Examtitle_1` resolves to “Mock Exam: Rehearsal for the Finish Line”; `Desc: SolarSchool_Examevent_1` resolves to:

> Facts can be tested against evidence, while opinions express (__).

Its answers, in source order, are:

| Answer ID | English text | `IsCorrect` |
| --- | --- | --- |
| 1 | A person's judgments, feelings, or stance | `true` |
| 2 | Objective facts | `false` |
| 3 | Eternal, unchanging truths | `false` |

The illustration reference is `/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconExam/T_IconSolarSchoolExam2001.T_IconSolarSchoolExam2001`. It resolves only through a matching validated local entry under `UIResources/UiActivity/Image/Activity38/SolarSchool/IconExam/`. The six shared files retain their exact names and case. Missing mappings and image failures show a labelled illustration fallback.

The source question/answer tables contain no textual feedback field or answer-specific navigation field. **Correct.** and **Incorrect.** are reader labels derived from the explicit boolean. Unrelated success/failure text candidates in the earlier inventory were not used as quiz feedback. Source score, hold duration, action/type rows, result parameters, question/answer rows and original performances remain available in generated data and Debug.

`test-results/phase6-recovery-source-audit.json` records raw rows, source hashes, the example and trigger inventory. The generated `public/data/build-report.json` reports 16 questions and no unresolved actions or answer flags. No original-game execution is inferred from these local files.

## Interaction and navigation

The runner opens a quiz when its stage performance is delivered. It retains the current visit, source phase, stage state and any requested departure. Selection records one answer/result without navigating. **Continue** is available only after a result and resumes the retained path once pending operations allow it. Normal Advance and dialogue choices cannot bypass a quiz.

| Script | Questions in source playback order (`question / nid / phase`) |
| --- | --- |
| `7025` | `1 / 7 / end`, `2 / 0 / start`, `3 / 8 / start` |
| `7028` | `4 / 6 / end`, `5 / 0 / start`, `6 / 7 / start` |
| `7030` | `13 / 7 / end`, `14 / 0 / start` |
| `7033` | `15 / 0 / start`, `16 / 9 / start` |
| `7042` | `7 / 46 / end`, `8 / 0 / start`, `9 / 47 / start` |
| `14200` | `10 / 0 / start`, `11 / 6 / start`, `12 / 7 / start` |

Sequential continuation follows the talk block's source order, including transitions to nid 0. Correct and incorrect answers follow the same path because the answer rows supply no branch targets. A quiz in a selected departure retains that departure, including `FinishTalk`; it does not replace it with sequential navigation.

Quiz tokens include run, visit and instance IDs. Duplicate selections, repeated Continue, stale tokens and premature Continue are rejected. Multiple delivered quizzes keep source order and distinct instances. Restart, script switch and disposal clear active/queued quizzes and reject old callbacks.

Stage operations, transitions and existing dialogue reveal clocks continue during a quiz. The full quiz question/answers render immediately through the existing English formatting helpers. History blocks quiz commands while open. Quiz events stay in Debug; dialogue and ordinary selected responses retain the Phase 5 readable-history contract.

If an answer lacks an explicit boolean, grading enters `phase: unresolved`, with no result or Continue. The player labels the unresolved result and links to **Debug → Quiz result override**. An explicit test override records `resultSource: debug-override` and can be applied once. Text, ID order and labels never determine a guessed result.

## Scope and verification limits

Manual Continue is the reader interaction policy. `ExamResultHoldDuration` is preserved without adding an automatic timer or minimum wait. `AddScore` does not update exam/event progression. Random result Spine selection and original-game animations remain unimplemented; their raw configuration is preserved. Other SolarSchool activity actions, hidden conditions, AVG flags and event state retain their existing debug/metadata behavior.

This recovery used normal local commands and no external evidence capture, REA server calls or browser automation. A direct request to the existing development URL was rejected with `Operation not permitted` by the shell's loopback restriction. No Vite process was visible in this shell. Recovery does not claim a fresh browser, HTTP-delivery, focus or layout check.

Older browser/server artifacts remain historical evidence. In particular, `phase6-browser-main.json` records a response-budget error and `phase6-browser-lifecycle.json` records an invalid request; other saved complete captures also exist. Their presence was audited without resuming the old response chain or retrying captures.

## Fresh local verification

All final local commands passed after the recovery code/label edits:

| Check | Result | Record under `test-results/` |
| --- | --- | --- |
| `npm run test:quiz` | 29 passed; no failures/skips | `phase6-recovery-quiz-tests.log` |
| `npm test` | 140 passed; Python asset checks passed | `phase6-recovery-tests.log` |
| `npm run build` | TypeScript check and Vite production build passed | `phase6-recovery-build.log` |
| Cached assets | All 142 unique files passed SHA-256, full Pillow WebP decode and dimension checks | `phase6-recovery-assets.json` |

Focused tests cover source joins/order, explicit correctness, unresolved overrides, input guards, stale/duplicate input, silent/start/end lifecycle, queued quizzes, retained `FinishTalk`, independent clocks, missing/broken assets and actual React rendering. All six real scripts complete correct and incorrect routes in timed and instant modes: 24 completed routes with identical navigation and persistent stage state to playback without quiz pauses. The full suite preserves the existing 429-script navigation/stage coverage and `1004`/`17048` regressions.

The asset cache contains 43 background files, 93 CG files and six quiz illustration files. All 136 earlier media files match the pre-Phase-6 hashes; shared quiz references create no duplicate files. The asset source revision is `53692bed10f6b82cdcff0a36b72cc01cc329852c`. Missing background `800001` remains recorded separately.

## Follow-up local audit, 2026-11-13

The working tree, saved diffs, test results and this review were inspected again before any edits. The current implementation already satisfies the Phase 6 source contract and local interaction checks; no production code, dependencies, generated data or tests needed changes. This pass only corrected and extended the review and saved fresh local verification records. No old response chain or external capture was resumed.

`phase6-current-inventory.json` records file hashes and changes against both the pre-Phase-6 baseline and the prior recovery's initial hashes. Excluding Python bytecode caches, the tree has 31 changed files, eight added files and no missing files against the pre-Phase-6 baseline. The added files are the seven original quiz files and this review. `phase6-current-existing.diff` supplies a fresh `git diff --no-index` review because HEAD remains unavailable.

The independent raw audit reread all 429 generated SolarSchool flowstates, the exam/action/type/result tables, and their generated joins. It confirmed all 16 performances, 48 explicit answer flags, English text, exact illustration references and source navigation. Raw TalkItems, performances, question/answer rows, result parameters and source SHA-256 hashes are retained in `phase6-current-source-audit.json`. The existing unresolved-result/debug override remains covered by fixture and React tests; no source feedback text, score progression or animation behavior was inferred.

| Fresh check | Result | Record under `test-results/` |
| --- | --- | --- |
| `npm run test:quiz` | 29 passed; no failures/skips | `phase6-current-quiz-tests.log` |
| `npm test` | 140 passed; Python asset checks passed | `phase6-current-tests.log` |
| `npm run build` | TypeScript and Vite production build passed | `phase6-current-build.log` |
| Cached assets | 142 validated files; all 136 earlier media hashes preserved | `phase6-current-assets.json` |

A normal local request to `http://127.0.0.1:5173/` returned curl error 7 (connection refused), and the process listing showed no Vite server. That differs from the earlier recovery's loopback-policy rejection. No replacement server or browser automation was started. Live layout, focus and HTTP delivery review remain manual checks on the existing development server when it is available. Work remains stopped after Phase 6.

## Manual review on the existing development server

These manual steps are provided for review; they were not rerun during recovery:

1. Open `http://127.0.0.1:5173/?script=7025`, enable Instant text, and Start. Advance through the opening dialogue with a brief pause between inputs. Nid 7's end performance opens question 1 with the prompt and answers above.
2. Select an answer. Exactly one button is selected and all answers become disabled. The result reflects that answer's `IsCorrect`; the nid stays 7. Advance and page-level Space/Enter do not continue the quiz.
3. Wait beyond 1.5 seconds: the result stays visible. Open History, inspect earlier dialogue, and close it. Continue reaches question 2 at silent nid 0, then question 3 at nid 8. Source correct answer IDs are 1, 5 and 9; incorrect answers follow the same navigation after Continue.
4. Use keyboard activation on answer/Continue buttons, repeat clicks, and try a narrow viewport. Restart during a question/result; the old selection and quiz records clear. Switch scripts during a quiz and verify old callbacks cannot affect the new run.
5. Review Debug → Quiz interactions for raw question/answer/action/result metadata and continuation. Missing correctness is exercised by the local fixture tests; current real answers all have explicit flags. `npm run test:quiz` repeats those checks without a browser.

Stopped after Phase 6 for review.
