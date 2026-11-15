# Route data and reference verification

Activity: **111700001**, Second Coming of Solaris: Unwritten Dreams. Inspected on 2026-11-15. This report separates static shipped-controller observations from live reference-page observations. It does not claim execution of the original game.

## Retained sources

Local original controller inspected without executing it: `/tmp/reader-original-transform/Aki.Game.dll`, SHA-256 `069bcb5b9c3d4d28780be8f51b59e7d52d2a9cbd8eab2c037f2a3be925db2049`, MVID `793dfd03-0f45-4cd2-8afc-a8fedff89320`. The bounded metadata/IL reader is `dotnet /tmp/abby-controller-audit/Facts.dll`; each JSON record retains method tokens, complete decoded IL, source path and identity.

Local data: `WutheringWaves_Data/BinData/SolarSchool`, `BinData/ActivityAction/activityaction.json`, `BinData/ActivityCondition`, and neutral `public/data/maps`. Existing repository provenance identifies game-data revision `49d65625340a32cec6851a12baedc03b5a630b25` (3.8). The original controller inspection establishes its own assembly identity; it is not proof of runtime execution or cryptographic pairing to that game-data revision.

All **three supplied URLs were opened successfully in controlled REA Chromium**:

| Reference | Verified visible content | Evidence |
| --- | --- | --- |
| [Journey](https://encore.moe/story/111700001?lang=en&tab=journey) | 17 journeys, chronological dates, faction splits, progress goals, prior journey links and visible prerequisites | `ev_889b99108714b33785b98fff10d99d0466b76d83366137d8a796b7ba974e397d` |
| [Requests](https://encore.moe/story/111700001?lang=en&tab=requests) | 50 Special Requests, appearance/acceptance dates, required weekdays and weeks, completion counts, all displayed attribute requirements | `ev_0b60d8eae844e60f68a490d7ac796a53117a7e6dac5d88c8c56e94e5440b7190` |
| [Endings](https://encore.moe/story/111700001?lang=en&tab=endings) | 12 endings and the expanded authored year-end graph, including rejoin links and multiple independent school-saving checks | `ev_a9c82832bcc47f613ce2b3ca9195b401245c046b8989fd89ae38dcdce4500af0` |

Full records are `test-results/phase8-reference-{journey,requests,endings}.json`; extracted DOM, accessibility text and PNG screenshots share those prefixes. All declared start/wait steps completed and the intended tabs were selected. Shell curl failed DNS first; browser access subsequently succeeded. External advertising scripts emitted browser errors; these are captured, not Reader errors.

The Requests cards do not display the numerical reward groups in their captured default view. Request rewards are verified against local game tables and dispatcher joins; do not claim visible website verification of those rewards.

The regenerated dataset contains **429 scripts / 8,493 nodes**, 426/426 resolved registered flows, and no dangling script jumps. The final joins checked in `test-results/phase8-dataset-route-audit.json` have no missing reward-group members, condition-group children, quest progress conditions, quest nodes/actions, ending graph links/actions, ending selection flows, or inspected gameplay action targets. The source has 575 ActivityCondition leaves, 460 groups, 1,275 ActivityActions, 1,015 individual rewards, 700 reward groups, 17 tree journeys, 50 Special Requests, and a 74-node graph for 12 endings. These are structural/rule checks; normal Reader route coverage is recorded separately below.

## Calendar and journey order

Native `SolarSchoolUtils..cctor` **0x06038821** creates the calendar anchor **2024-03-15**. `GetDate` **0x06038816** computes anchor + (DayIndex - 1). `SolarSchoolTimeData.Reset` **0x060381A7** sets DayIndex=1, CurrentSlot=1, DisplaySlot=1. `SolarSchoolParam.TotalDays` is **262**. The ordinary calendar therefore ends on 2024-12-01.

Slots are Morning=1, Day=2, Noon=3, Dusk=4, Night=5. Only 2 and 4 are authored action slots. Calendar row action arrays are executed in their own slot order: DawnActions, DayActions, NoonActions, DuskActions, NightActions. ActivityAction type 1 calls the literal `SolarSchoolFlow` parameter; a number overlapping a script ID is not a call.

**Calendar branch precedence differs from hidden dialogue precedence.** `SolarSchoolConfig.FindCalendarDay` **0x06038534** examines all rows for the activity/day. It chooses the **highest Id among matching conditioned rows**. Only if no conditioned row matches does it choose the **highest Id among ConditionGroupId=0 fallback rows**. The method explicitly logs duplicate fallbacks and says only the largest Id takes effect. Do not use array-first match here.

First calendar row, Id1/DayIndex1: condition group25100016, DawnActions=[1001], NoonActions=[1003], DuskActions=[1004], InstanceId1. DayIndex2/Id4: DawnActions=[9501,1005]; 9501 is ActionType6 with literal Id1001. Calendar actions and instances must remain separate objects; InstanceId is not a script ID.

Live Journey chronology agrees with local tree-quest date windows: first lesson03/18 (DayIndex4), first progress goal03/20–04/14 (6..31), anniversary faction goals04/15–05/22, anniversary05/23, preparation05/25–06/30, exams07/01 and07/02, summer faction routes07/07–08/04, second-semester faction routes09/04–11/03, coming-of-age10/12, final exams11/26 and11/27, farewell12/01, final leisure event12/02. The September branches visibly require the corresponding faction level >=2 and the appropriate prior summer journey.

Retained IL: `phase8-calendar-date-methods-il.json`, `phase8-calendar-quest-order-il.json`, `phase8-route-semantics-il.json`.

## Day tasks, location choices, behaviors, and exams

The surrounding task audit resolves the earlier instance-order gap. The authored sequence is:

**initialize exam when present → action100001 in slot1 → action100002 → Instance.EnterActions → GoOut/OpenMapViewAsync → Instance.MapActions → timing4 quest nodes → required location progress → Instance.EndActions → timing3 quest nodes → exam settlement → FinishDay**.

`SolarSchoolInstanceExploreTask.<GoOutAsync>d__12.MoveNext` (`0x06047A4E`) places map actions after the map transition. An instance with no locations skips MapActions and proceeds directly to BeginEnd. Only `SolarSchoolBehaviorAction` consumes an action point; option/dialogue interactions do not consume one merely because they advance a scene. A normal location click attempts timing1 affinity nodes before timing5 first-visit nodes. EndLocation confirms after required location progress and does not replay its ActionIdList. `IsSeparate` uses a one-completion threshold. These operations remain distinct from navigation/history replay. Retained: `phase8-shop-instance-order-il.json`, `phase8-instance-map-actions-il.json`, `phase8-final-reader-{rules,input,location}-il.json`, `phase8-final-free-map-il.json`, `phase8-final-action-point-il.json`.

Behavior availability reads the current highest configured Level whose RequireCount is satisfied and its ShowConditionGroupId. Thus type22 behavior-unlocked conditions can change after authored progress. AutoPlaceBehavior spans provide ordinary schedule defaults by date, priority, and compatible slot; they do not imply a call to a neighboring script number. Weekly buff rewards settle once per week before reset/prefill. Future schedule predictions use the literal calendar-selected instance, with normal days defined as InstanceId0 or1. Retained: `phase8-final-behavior-availability-il.json`, `phase8-final-default-schedule-il.json`, `phase8-final-special-placement-il.json`, `phase8-final-slots-schedule-il.json`, `phase8-final-schedule-instance-il.json`.

BeforeBehavior timing2 events precede the row's FirstAction (at its RequireCount), followed by one randomly chosen PreActionList entry. `SettleBehaviorResult` (`0x060386AC`) records execution/success, applies the selected success/failure attribute changes, then dispatches RewardSuccess/RewardFail. It uses effective attributes, the authored AttrLower/AttrUpper/AttrWeight dimensions, fatigue stages and scoped buffs when calculating outcome; malformed dimensions are disabled with an explicit diagnostic. Type9 buff effects change success rate; type10 bonuses modify attribute/favor/item reward-member values; type11 reduces positive fatigue costs. Special Requests do not receive that ordinary behavior reward bonus. Permanent Special-item bonuses read acquired-item history. Buffs with BehaviorId apply to that behavior's deltas rather than universally adding base stats.

Exam initialization calculates its weighted base score from effective attributes and the authored AttrMax/AttrWeight values. Answer actions add to and clamp that initialized score. Settlement chooses the first inclusive score band, then an inclusive rank within its configured range; result rows themselves grant no reward, while authored quest actions may do so. Native float intermediates and ties-to-even rounding are retained. Event checks use radar-polygon intersection and the configured probability-mapping table rather than independent per-axis minima. Retained: `phase8-mechanics-verified-il.json`, `phase8-behavior-exam-math-il.json`, `phase8-mechanics-radar-exam-il.json`, `phase8-mechanics-order-bonus-il.json`, `phase8-mechanics-exam-settlement-il.json`, `phase8-mechanics-exam-day-il.json`.

## Quest-node and journey progress

There are 147 quest rows: Logic=0 (130), Tree=1 (17), and 335 quest nodes. Native `ESolarSchoolTriggerTiming`:

| Value | Authored trigger |
| --- | --- |
| 0 | Immediate |
| 1 | AtLocationAffinity |
| 2 | BeforeBehavior |
| 3 | AtInstanceEnd |
| 4 | AtInstanceMap |
| 5 | AtLocationFirst |

QuestNodeList contains the construction seeds. Native `QuestData.OnInit` (`0x0603805F`) builds an activity-wide PreNodeId child map (`0x06038060`), then `SingleQuestData.BuildNodes` (`0x06038170`) walks each quest's listed nodes and descendants. The first constructed quest owns an overlapping node, including an entry later listed explicitly by another quest; no active-window reassignment occurs. Source order yields **324 constructed nodes:202 listed and122 implicit descendants**, with no ownership conflicts. Eleven unowned popup/no-op definitions are excluded by the same native rule. Exact joins and IDs are in `phase8-quest-descendant-source-audit.json` and [ROUTE_DISPATCHER_EVIDENCE.md](ROUTE_DISPATCHER_EVIDENCE.md).

UnlockConditionGroupId is evaluated while listening and **latched when the node enters PendingNodeList**. AvailableConditionGroupId is checked at delivery. A later false unlock does not remove pending state. Deactivation clears nonrunning pending nodes and stops listeners; completed progress resets only if the quest's activation precondition is false at deactivation, while expiry alone preserves it. The owner's expanded local map supplies predecessor completion and child listeners. Captures: `phase8-quest-descendant-construction-il.json`, `phase8-quest-pending-latch-il.json`, `phase8-route-semantics-il.json`.

Quest activation `ShouldActivate` **0x06038756**: reject when outside its date window; otherwise keep an already-active quest active, or check its PreConditionGroupId. Zero start/end bounds are open; positive bounds are inclusive. `IsClosedByDate` **0x06038757** checks day < start or day > end. `IsPreConditionMet` **0x06038758** checks the condition group, with 0 true.

A pending node is deliverable only when its parent quest is active and its action is not already running (`IsNodeDeliverable` **0x0603875D**); available-condition and trigger timing/parameter are checked at delivery. Immediate pending nodes are sorted **descending Priority**, comparator **0x06047B0A**. Its comparator returns zero on ties; the source does not supply an additional tie-breaker for that List.Sort. `TryPickNode` searches pending nodes for the requested timing and literal trigger parameter. Timing1 also checks the daily location-trigger ledger.

Node completion occurs in `OnNodeActionFinished` **0x06038760**, after its action completes: remove pending, clear running, MarkCompleted, record timing1's daily location, start subsequent PreNodeId listeners. A condition being reached or its dialogue being opened is not node completion.

Tree-quest reward progress is the sum of the configured `SolarSchoolQuestReward.RewardProgress` for rewarded checks, capped at TargetProgress (`GetRewardProgress` **0x06038162**). A claimed total reward reports the target directly. Local-condition checks retain their progress baseline when listening begins (see dispatcher report).

Total rewards are **claimed explicitly**, not granted just because the progress threshold becomes true. `CanClaimProgressReward` **0x06038166** requires a claimable tree quest, in-date/show-time, unlocked, not already ProgressRewarded, and progress >= TargetProgress. `TryClaimProgressReward` **0x06038065** resolves the positive `RewardItem` group through TryGiveReward, and marks ProgressRewarded only after success. This provides a separate exactly-once claim guard.

`QuestReward.ConditionId` always names an **ActivityCondition leaf**, not a group or a namespace selected by `LocalCondition`. `IsConditionReached` **0x06038090** calls ActivityConditionCenter.CheckCondition and `RegisterConditionListener` **0x06038091** calls RegisterCondition in both cases. `LocalCondition=true` supplies a TryRestoreLocalProgress callback; false supplies null. Earlier research interpreting this boolean as main-vs-activity lookup is contradicted by the original controller. Retained: `phase8-quest-local-progress-il.json`.

Concrete example: tree quest1102, first goal, DayIndex6..31, PreConditionGroup32000001, progress checks[1,2,3,4], TargetProgress100, RewardItem70012, nodes[120000,170013]. Completion follows those checks and authored triggers; merely completing script1005 is insufficient.

## Special Requests (BehaviorType4)

The **50 Requests reference cards are Special behaviors**, separate from the 17 tree journeys and 130 invisible logic quests. Original fields are `AppearDay`, `AcceptDeadline`, `AttrRequire`, `OccupyDayOfWeek`, `FinishValidWeek`, `FinishDeadline`, `FinishCount`, `AcceptAction`, `FailAction`, `FinishAction`, `RewardFinish`, and role binding. State enum None0 / Appeared1 / Accepted2 / Finished3 / Failed4.

Native `OnDayStart` **0x0603879C** refreshes appearance before checking unaccepted deadlines. `OnAppearHit` **0x060387A1** changes only None0 -> Appeared1 and unregisters appearance listening. Appearance notification is not acceptance or a reward.

`GetAcceptFailType` **0x060387B4** checks feature unlocked, config present, state Appeared, acceptance date not past, then every AttrRequire (first unmet requirement determines the failure). `IsAcceptDeadlinePassed` **0x060387A6** uses **day > AcceptDeadline**, with <=0 unbounded. The configured maximum concurrent accepted requests prompts confirmation in the original UI; it is not an additional hard CanAccept prerequisite.

`TryAccept` **0x060387BC** requires CanAccept and a positive calculated finish deadline; sets Accepted2, unregisters appearance, then injects the literal AcceptAction into the current task if nonzero. It does not grant RewardFinish or set Finished.

**Finish deadline calculation** `CalcFinishDeadline` **0x060387C1**:
1. Use explicit FinishDeadline when positive.
2. Otherwise require nonempty OccupyDayOfWeek, weekdays in1..5, positive FinishValidWeek and TotalDays.
3. Start at **Monday of AcceptDeadline's week +7**, not the week of the player's actual acceptance.
4. A valid week requires **every occupied weekday to be a normal schedulable day**, checked by `ScheduleData.IsNormalDayByDayIndex` (`IsValidWeek` **0x060387C2**).
5. Count FinishValidWeek such weeks; deadline is the last counted Monday + max(weekday) -1. Invalid config or insufficient remaining totalDays yields0.

`IsNormalDayByDayIndex` **0x06038107** means precisely **scheduled InstanceId is0 or1**; it does not inspect HasDayAction or the general instance-type field. `GetInstanceIdByDayIndex` **0x06038106** reads GetWeekInstanceId using week offset relative to CurrentMonday and weekday. Future calendar matching must populate that schedule cache consistently. Retained: `phase8-normal-day-il.json` and `phase8-quest-local-progress-il.json`.

`TryMarkFinished` **0x060387AC** requires Accepted2, positive FinishCount, completed behavior count >= FinishCount, then sets Finished3 once and records summary progress. `InjectSpecialFinishSequence` **0x060386AD** orders **literal FinishAction → request-completed confirmation → RewardFinish reward group**. The completion reward therefore follows completion of its authored dialogue and the confirmation, not acceptance, opening the request, or the Finished state mark alone. Retained: `phase8-special-acceptance-il.json`, `phase8-mechanics-order-bonus-il.json`, `phase8-mechanics-verified-il.json`.

Unaccepted requests expire from Appeared1 when day > acceptance deadline (`CheckDeadline` **0x060387A4**). Accepted requests fail at the deadline **during settlement** when day >= finish deadline (`SettleDeadlineFailures` **0x060387A5**): set Failed4, queue failure popup, then literal FailAction. Preserve the settlement trigger so the final eligible day can execute before failure is settled.

Reference example: Words Set the Board, Changli, appears04/13, accept by04/27, Mon/Tue/Wed,2 valid weeks,6 executions, Knowledge15 and Thinking15. The first captured Cartethyia request appears04/14, accept by04/28, Thu/Fri,2 weeks,4 executions, Aesthetics15 and Physique15. Later cards' requirements remain separate parallel checks.

Local example: special BehaviorId1901 (BindRole9), AppearDay93, AcceptDeadline107, Knowledge189/Thinking189, weekdays1/2/3,2 valid weeks,6 executions; RewardFinish9001901 -> individual rewards[900190101,900190102,900190103]. FinishAction1086 -> literal script14217; FailAction1100 ->14231. Behavior1903 uses RewardFinish9001903 and FinishAction1087 ->14218. These action/script mappings are source joins, not numeric succession.

Retained IL: `phase8-special-verified-il.json`, `phase8-special-acceptance-il.json`. Every decoded method can be independently replayed by the bounded IL reader.

## All 11 formerly unresolved hidden nodes

Original source-order selection is now verified: the first eligible option wins. The first ten prerequisites are current ItemId quantity≥1 (type10). The last reads the activity's ending gallery (type30). All use their fallback in a known first playthrough with no prior gallery; all use the conditioned option after their supported prerequisite is established. A new game's cycle reset is separate from its retained gallery achievements. Missing historical state in an arbitrary imported checkpoint remains unknown rather than silently choosing the fallback.

| Hidden script / node | Required state | Authored grant script / node / action | Conditioned / fallback option |
| --- | --- | --- | --- |
| 1004 / 1 | Special item10 | 4015 / 7 / 3510 | 11 / 12 |
| 1008 / 21 | Special item7 | 4017 / 9 / 3507 | 14 / 15 |
| 1008 / 53 | Special item3 | 4021 / 4 / 3503 | 17 / 18 |
| 1009 / 5 | Special item8 | 4019 / 2 / 3508 | 17 / 18 |
| 1010 / 5 | Special item6 | 4008 / 3 / 3506 | 27 / 28 |
| 1010 / 25 | Special item2 | 4023 / 7 / 3502 | 18 / 19 |
| 1011 / 29 | Special item4 | 4006 / 6 / 3504 | 7 / 8 |
| 1014 / 16 | Special item5 | 4010 / 3 / 3505 | 7 / 8 |
| 1014 / 26 | Special item9 | 4012 / 3 / 3509 | 10 / 11 |
| 1034 / 43 | Special item1 | 4003 / 5 / 3501 | 37 / 38 |
| 3010 / 35 | Gallery ending4 unlocked | Completion of true-ending flow3030 | 2 / 3 |

Special items currently owned at NextCycle are inherited before new-cycle quest initialization; neither acquired-but-spent items nor common items carry. Inheritance fires no received-item event. This is the authored path to the item-conditioned introductions on later cycles, and is distinct from the independent fresh-start reset. Conditioned introduction performances can unlock a role, grant30, upgrade, grant50, and upgrade again; favor gains and tier changes remain separate operations. PlotOptionId and PlotKeyId are read records, not implied AVG writes.

Every row's condition, grant namespace, fresh result, authored-grant result, next-cycle result and missing-baseline result is retained in `test-results/phase8-dataset-route-audit.json`. The earlier ledger `phase7-hidden-branches.json` is historical and is superseded by this audit and the original selection/inheritance CIL in [ROUTE_DISPATCHER_EVIDENCE.md](ROUTE_DISPATCHER_EVIDENCE.md).

## Ending graph and explicit ending choice

The 74-node ending graph has **start48**. Native action nodes follow NextId; condition nodes follow TrueNextId/FalseNextId; types3 and4 are terminals (End / NextCycle). Traversal is graph order, not sorting all true ending conditions. EndingSnapshot captures attributes/favor/factions/exams after the preceding day-end tasks and failure actions finish, before EnterEndingDay changes the presentation date or the first graph action runs. See the dispatcher report for the exact original entry sequence.

Part of the authored sequence:48 ->1 ->99 ->49 ->62; branch62/63/64 decides faction introduction; afterward3 checks Student Council,50 switches time,6 checks Club Association,51 switches time,9 checks piano score,11 scene,52 switches time,80 checks money,82 checks popularity,12 checks any school-saving condition. **Both money and popularity checks can trigger in order**:80 true ->81 (script3107) ->82;82 true ->83 (script3108) ->12. A global first-true ending picker would wrongly omit one.

Career/companion/true selection uses ActivityActionType11 EndingType2/3/1 respectively. `FilterAvailableEndings` **0x06038814** filters the requested type and condition-group truth; candidates are sorted **ascending Sort, then ascending Id**, comparator **0x06047B14**, with stable-sort helper. `OnEndingSelected` **0x06037EE7** recomputes eligible candidates before accepting the user's selected ID, then plays its FlowId. `CompleteEnding` **0x06037EEB** calls SendReachEnding only after the selected ending scene finishes and then marks its action done. Selection/reveal alone is not achievement.

The source-supported true-ending choice sequence is **3011/node20/option3 → node43/action10013 (`key13=true`)**, then **3011/node76/option6 → node77/action10014 (`key14=true`)**, then **3011/node77/option9 → node78/action10015 (`key15=true`)**. Option3's group29000036 requires playthroughCount≥2. Graph20 reads group29000021, an AND of those three literal AVG flags, then follows47/action3003 for the true ending or22 →23 toward career/companion routes. These are explicit action writes, not PlotOptionId-derived flags.

The outer prerequisite's replacement-text metadata does not change that truth. In a first cycle Reader uses the literal `TalkOptionUnmetReplaceText_1` text while the choice is unavailable; subsequent cycles use the normal response. Likewise, **16001/node4/options5,6,7** hide when their respective groups39002001/39002002/39002003 are unmet. The verified VisualNovel wrapper leaves **1006/node12/option2's PreOption / PreOptions:[1]** metadata ungated. It simply continues to node13. All **76 authored outer prerequisites** now resolve in known fresh and next-cycle states; nullable presentation fields are validated separately and other unknown structures retain Developer diagnostics. Original parser/factory tokens and captures are in the dispatcher report.

School-saved flag **key60** is separate: **3012/node22/end-phase action10027** writes it. Career group29000004 combines it with all ten listed friend tiers≥4; teacher group29000014 combines it with Feeling≥320. Graph80 and82 provide the independent money/popularity regressions; graph46 checks the selected career ending before optional companion selection.

Visible ending thresholds agree with local groups: all friends Trusted plus school saved for special career; Changli/Cartethyia Trusted for companions; money2,000,000; popularity50,000; teacher Feeling320 plus school saved; academic Knowledge850/Thinking600; conductor Aesthetics850/Physique600; investment Thinking500; mountaineer Physique500. Eligibility uses controller condition comparisons, not prose's looser “over” wording.

**Date discrepancy:** Encore's year-end heading and local ending-flow Comments say12/30. Literal native action data3022..3026 uses Month12/Day2,3027..3029 uses Day3,3031 uses Day4. The DayIndex anchor and TotalDays corroborate **12/02–12/04**. Execute literal parameters; do not substitute comments' dates.

Retained IL: `phase8-route-semantics-il.json`, `phase8-quest-ending-priority-il.json`, `phase8-ending-sort-il.json`. Retained graph/table joins are local source-backed.

## Reproducible Reader checks for community testers

Use Reader **New Playthrough** with the default saved seed, play normally, and save at **script1011 / node8** on day3. Its normal introductory route includes restaurant script1029; reaching the checkpoint through play preserves Chisa's introduction rather than inventing a favor baseline.

| Check | Script / node / option and authored action | Expected result |
| --- | --- | --- |
| Immediate fork A | 1011 / 8 / option2 | Visits9, rejoins11; Chisa0 favor points. |
| Immediate fork B | Restore same checkpoint; 1011 / 8 / option3 | Visits10, executes20000224, rejoins11; Chisa5. The resolved reward is group20000229 → individual20000282. |
| Carry both states forward | Common social behavior6010 exactly once on day9; 1034 / 27 / option26; skip optional normal-location rewards | Chisa20 for A and25 for B. Option25 in1034 would add favor and defeat this controlled comparison. |
| Later authored gain | Day212 birthday instance9 / location1087, actions8027/8028; 8024 / 13 / option10, then8025 / 5 / option2 → node6/action20000224 | Chisa25 for A and30 for B. The8024 choice is dialogue-only;8025 grants the same verified+5 effect. |
| Later decision reads the fork | Day213 normal location1009; quest node112141 / group26100028 | Only B has a full tier1 favor bar and unlocks action5107 / script6001, which upgrades Chisa to tier2 and resets points0. A remains tier1/25. |
| Real received items | 1010 / 15 / action103090;1010 / 37 / action106042;1009 / 22 / action103081 | Receive items49,30,40 respectively at their authored actions. |
| Real request reward | Accept Special Request1101 on day30; execute1101 on days46,47,48,53,54,55 | Six executions finish on deadline55; script13102 finishes, then confirmation, then group9001101 grants individual900110101 Knowledge+8 and900110102 Thinking+8. |

The immediate A/B, stale-choice rejection, History/checkpoint reward safety and fresh reset are formal normal Reader regressions in `tests/playthrough.test.ts`; their retained report is `test-results/phase8-normal-playthrough-tests.json`. The complete later-decision, request/item-reward and stocked-shop replays are in `tests/route-playthrough.test.ts`, with results in `test-results/phase8-real-route-tests.json`. Earlier exploratory probes remain as `phase8-later-state-probe.json`, `phase8-later-decision-probe.json`, and `phase8-real-request-probe.json`. These exercise the reconstructed Reader through its normal public controller and record state/actions; they are not original-game runtime captures. Optional rewards or extra social interactions can legitimately make both sides eligible sooner, so the shared route constraints above matter.

The completed three-year regression in `tests/ending-playthrough.test.ts` uses **seed3 and normal public Reader inputs, with no Developer overrides**. Its retained results are `test-results/phase8-ending-playthrough-tests.json`:

| School year | Reader inputs | Played scenes | Achieved endings | Authored terminal |
| --- | --- | --- | --- | --- |
| 1 | 14,900 | 161 | 12 | NextCycle |
| 2 | 17,596 | 275 | 12, then2 | NextCycle |
| 3 | 12,253 | 177 | 4 | End |

Across **44,749 inputs and 613 scenes**, the second year reaches tier 4 for all ten required friends and grants all ten Special mementos once through their listed farewell scripts. The third year inherits those items before initialization and automatically selects all ten conditioned introductory hidden choices. Its three explicit choices `3011/20/3`, `3011/76/6`, `3011/77/9` write `key13`/`key14`/`key15`; group29000021 is true and graph20 follows node47/action3003 to script3030. The earlier years read that group as false and follow node22. All completed ending scenes become gallery achievements after playback.

Final verification passes **324/324 tests**, the Python asset preparation checks, TypeScript checking and the production build. The retained logs are `test-results/phase8-final-tests.log` and `test-results/phase8-final-build.log`. The focused outer-condition/Reader regression passes 53 tests in `phase8-choice-regression-tests.log`, and the regenerated hidden/outer audit resolves 11/11 fresh hidden branches and 76/76 authored prerequisites with no unknown in known fresh or next-cycle state.

During the third year, **3010/35** still chooses fallback3 before the true ending has been achieved. Evaluating that same authored node against the actual completed state selects option2, resolving the eleventh conditioned route. This is a post-achievement evaluator check; the terminal End does not replay the earlier scene or offer NextCycle. Starting an independent new playthrough resets attributes, items, behavior/request progress, exams and choices to their source defaults while retaining the gallery separately. The second-year policy chooses7038/3/9 for both factions, uses shop2 gifts and role options301–310, and visits affinity locations at the favor caps; the resulting50 gifts and48 purchases use authored funds without cashier/rest substitutions.

## Bounded unknowns for implementation diagnostics

All 575 authored SolarSchool condition leaves, 460 groups, and 76 outer option prerequisites have established semantics and a definite result in a known fresh playthrough; all 11 hidden prerequisites and their precedence are resolved. No authored condition is still classified as unknown solely because its rule was not inspected. A partial imported checkpoint can still lack a required inventory, favor, date, location, history or progress baseline; such absence must remain explicit in Developer. Unsupported outer condition structures or a missing definition also remain explicit rather than using another same-number namespace.

The regenerated dataset audit incorporates descendant ownership, pending unlocks and live LocationId-list evaluation: **88/487** true/false leaves and **65/395** groups, with no unknown in the known fresh state. Its node112141 regression retains pending eligibility after a tier upgrade makes the unlock condition false. Graduation quest4260's authored descendants are included in construction, supplying262001→262002/action4111→script4001→262003/action41003 before262010/action41006. Full normal-play validation is recorded separately from these structural/evaluator probes.

Quest priority **ties** have no additional authored tie-breaker in the inspected native List.Sort comparator. Reader retains source enumeration for those ties and records `quest-priority-tie`; that is a documented Reader policy, not proof of native sort stability. Reader's saved seed/trigger-key RNG likewise supplies reproducible checkpoints rather than the original RNG sequence. Native original-game playthroughs, account/server acknowledgement and opaque prefab presentation details were not observed.

Source presentation gaps remain: **35 missing English keys**, **3 related unregistered scripts**, and background **800001** absent from its build-table validation. All registered flows still resolve with no dangling script jumps. The Requests reference verified dates/prerequisites/counts, while numerical reward joins came from local data. The Encore12/30 heading versus literal ending12/02–12/04 discrepancy is retained above.
