# Progression choices on the Reader stage

Normal Reader displays the current journey decision on the right of the gameplay stage. The stage and School year use the same live options, labels, visit/quantity counts, costs, eligibility results, and selection handlers. The UI adds no date, script, route, location, or school-year rules.

| Decision | Reader control |
| --- | --- |
| Go out / festival entry | A single stage choice with the current instance's label |
| Destinations | Stage choices with authored visit counts and current availability |
| Destination and character actions | Stage choices, including existing owner labels |
| Manual activities | Stage choices with the same eligibility as School year |
| Request acceptance, journey rewards, item use | Stage choices from current progress and inventory |
| Gifts, shops, prize draws, school affairs | Stage choices with existing costs, quantities, and descriptions |
| Event and ending decisions | Stage choices in source order; required decisions retain their required input |
| Scratch ticket | Existing on-stage reveal board; receiving prizes and returning use the stage choice list |
| Scheduled activity / next part of the day | Existing continuation handler and scheduled label |
| Finish exploring | Stage continuation when eligible; selects the authored ending location |
| Another school year | Continue to a new cycle at the authored NextCycle terminal |

No ordinary progression step requires School year. Menu → School year still reviews attributes, friendships, inventory, requests, and journeys, and retains its existing action and continuation controls. Dialogue choices, quizzes, letters, relationship confirmations, and request completion/expiry confirmations keep their existing controls and timing.

`currentJourneyDecision` projects the current input boundary from `JourneySnapshot`. `ReaderJourneyChoices` reuses `JourneyButton` and delegates continuation to the existing `continue`, `dismissInteraction`, and `startNextCycle` methods. Journey choices disappear during scene playback, pending confirmations, and native panels. Busy and stale inputs are checked against the live journey. Rendering dispatches no reward or scene. Compact stage interactions show the latest delivered receipt first so a purchase stays visible ahead of earlier gains; its event and expiry time are unchanged.

The production Chromium verification starts fresh at `/?script=1001` and uses public Reader mouse controls throughout. The address bar keeps that query; IDs below come from passive runner inspection. School year was first opened for review after the progression checks.

| Checkpoint and input | Verified result |
| --- | --- |
| 03/16 Morning, completed `1004` → `explore:2` | Go out is on stage; street `1006` plays before destinations appear |
| Completed `1006` → `location:1015` | Central Square 0/1 and School Store 0/1 appear; `1008/1` opens once |
| Completed `1008` → `location:1016` | Return list contains School Store 0/1; `1010/1` opens once |
| Completed `1010` | 03/16 finishes automatically, preserving authored timing; `1006`, `1008`, and `1010` each have one read |
| 03/17 → `explore:3` | Different choices: Family Restaurant 0/1 (`location:1029`) and Teaching Building 0/1 (`location:1030`) |
| Completed `1011` after the restaurant visit | Return list updates to Teaching Building 0/1 |
| 03/19 Dusk, completed `1019` | Regular destination, character, activity, and continuation decisions are on stage |
| 03/27 Day, completed `2003` → `location:1010` → `locationOption:401` | Destination actions open the shop on stage |
| `shop:3:18` | Small Cardiotonic received once; 1,000 School Badges charged once; the received item stays in view |
| 04/13 Day, completed `13100` | Request acceptance is available on stage |
| 05/23, completed `1046`, instance 6 | Eligible Finish exploring uses existing continuation and the authored Auditorium end location (`1076`) |
| After the outing, 05/25 Day, completed `7004` | The next decisions return on stage; School year has never mounted during progression |

Opening responses are `1003/1/12`, `1003/6/15`, `1004/11/2`, and `1004/16/6`. Street uses `1006/12/2`; Central Square uses `1008/22/2`, `1008/44/6`, and `1008/71/10`. The complete selected-input list is in the browser result. The opening checks also verify Abby/Chisa confirmation timing, actor handoffs, the street's Feeling +1 exactly once, and unchanged state after reopening History.

The full suite passes 335 tests plus Python asset checks. The existing three successive-year routes verify that every ordinary journey input boundary projects all live options, while native confirmations remain separate. They cover 44,749 inputs and 613 scenes, including later-year instance 14's `explore:14`, `location:1155`, and `location:1156`. Focused model/React checks cover every planning and interaction option type, scratch settlement, unavailable actions, eligible continuation, and NextCycle. Typecheck and production build pass.

Local evidence:

- [Compact browser result](../test-results/reader-decisions/summary.json), [complete result](../test-results/reader-decisions/result.json), [event trace](../test-results/reader-decisions/trace.json), and [REA manifest](../test-results/reader-decisions/rea.json)
- [Go out](../test-results/reader-decisions/captures/morning-go-out.jpg), [street destinations](../test-results/reader-decisions/captures/street-completed-places.jpg), [returned choices](../test-results/reader-decisions/captures/returned-central-square.jpg), and [03/17 destinations](../test-results/reader-decisions/captures/03-17-different-destinations.jpg)
- [Later activities](../test-results/reader-decisions/captures/later-date-activities.jpg), [destination actions](../test-results/reader-decisions/captures/actions-at-school-store.jpg), and [visible purchase receipt](../test-results/reader-decisions/captures/on-stage-purchase-receipt.jpg)
- [Eligible Finish exploring](../test-results/reader-decisions/captures/eligible-finish-exploring.jpg), [next decisions](../test-results/reader-decisions/captures/after-explicit-exploration-finish.jpg), and [School year review](../test-results/reader-decisions/captures/school-year-review.jpg)
- [Earlier receipt layout](../test-results/reader-decisions-before-receipt/shop-receipt.jpg), [successive-year coverage](../test-results/reader-decision-cycles.json), [focused checks](../test-results/reader-decisions-focused-tests.log), [full suite](../test-results/reader-decisions-tests.log), and [build](../test-results/reader-decisions-build.log)

Browser coverage samples the normal route through day 72. Complete three-year coverage uses public engine controllers and the same decision projection. Source-condition limits remain in [route evidence](ROUTE_DATA_EVIDENCE.md); this UI change adds no unknown prerequisite or panel requirement.
