# SolarSchool dispatcher and branch evidence

This audit reads the original managed controller without loading or executing the game. The retained artifact is `/tmp/reader-original-transform/Aki.Game.dll`, SHA-256 `069bcb5b9c3d4d28780be8f51b59e7d52d2a9cbd8eab2c037f2a3be925db2049`, MVID `793dfd03-0f45-4cd2-8afc-a8fedff89320`, 54,225,408 bytes. Its previously verified container is the installed Resource/3.8.9 `pakchunk18-WindowsNoEditor_P.pak`; prior extraction verified payload SHA-1 `418e8d4a5351f7b3b7696c1a43711784ee6d1e2e`.

REA recognized this managed PE and verified its identity (prior metadata parent `ev_712f9334eea29d014fc5efbbb8dfefc7e0c9c7e5d7809ace28dd1a5827267a23`). A fresh members attempt, parent `ev_699060e6ea265395f426a9874f55c56377b5012359caaf6b94d045a330fa1006`, again stopped at the 64 MiB representation limit; it does not supply complete CIL or establish member absence. Complete selected CIL below comes from the already available `System.Reflection.Metadata` / `PEReader` inspector, whose source is retained in `test-results/reader-rendering/original-controller-facts-inspector.cs`. All tokens are build-local and bound to the artifact identity above. Raw captures are local `test-results/phase8-*-il.json`; they retain complete selected method bodies and exception regions. This is static shipped-artifact evidence, not observed original-game execution.

## The 1011 / 8 / option 3 regression

The original lookup sequence is **ActivityAction ID → ActionParams.SolarSchoolRewardId → SolarSchoolRewards group → ordered RewardIds → SolarSchoolReward members → reward-type dispatcher**.

| Lookup | Resolved row |
| --- | --- |
| ActivityAction `20000224` | `ActionType:2`, `SolarSchoolRewardId:"20000229"` |
| Reward group `20000229` | `RewardIds:[20000282]` |
| Individual reward `20000282` | `RewardType:1`, `TargetId:11`, `Value:5` |
| Executed consequence | Favor +5 for role 11 **Chisa**, subject to that role's unlocked/frozen/cap state |

Neither similarly numbered row substitutes for this chain. Group **20000224** refers to individual **20000278**, attribute target 5 +1. Individual **20000224** grants role 12 favor +12. Individual **20000229** grants attribute target 2 +1. All are different effects. There is no fallback from a missing group to an individual reward with the same numeric ID.

`SolarSchoolRewardAction.OnParse` (`0x06037F36`) reads the parameter rather than the action's own ID. `OnStart` (`0x06037F37`) calls `SolarSchoolRewardCenter.TryGiveReward` (`0x0603877D`). `TryGetGroupRewards` (`0x06038788`) calls `SolarSchoolConfig.GetRewards` (`0x06038541`), reads the group's `GetRewardIdsArray`, then calls `GetReward` (`0x06038543`) for each member in source order. Missing/empty groups or missing members fail; they do not resolve another namespace. `TryGiveReward` (`0x06038781`) validates every member before applying members in order. See `phase8-dispatcher-actions-il.json`, `phase8-reward-center-il.json`, and `phase8-reward-lookup-il.json`.

## Rewards, attributes, inventory, and favor

`ESolarSchoolRewardType` and `SolarSchoolRewardCenter.Apply` (`0x06038790`) establish type **0 = PlayerAttr**, **1 = RoleFavor**, **2 = Item**, **4 = Buff**. The entire local reward table contains only these four types. Type 0 adds to the player's base attribute through `SetAttr`; type 1 calls `AddFavor`; type 2 calls `AddItem`; type 4 calls `AddBuff`. It does not infer quest unlocks or AVG writes from reward IDs.

`SolarSchoolPlayerData.InitAttr` (`0x06038007`) reads each attribute's `InitValue`. `ClampAttr` (`0x0603800D`) applies its `MinValue` / `MaxValue`. The local initial values are 20 for attributes 1–5 and 0 for popularity, fatigue, and currency. Attributes 1–5 have minimum **1**, not 0. Names and caps come from the table, not the presentation.

`SolarSchoolInventoryData.GetItemCount` (`0x06037FD9`) returns 0 for an absent item. `AddItem` (`0x06037FDD`) clamps current quantity plus delta to `[0, supplied stack cap]`; zero removes the map entry. Positive first acquisition records the item ID independently of current ownership. New known playthroughs can therefore have definite zero quantities. Imported/checkpoint state whose baseline was never established must remain unknown. Captures: `phase8-friend-inventory-il.json`.

Favor points and tiers are separate authored operations:

- `SolarSchoolFriendData.InitRoles` (`0x06037FB5`) creates `SolarSchoolRoleData` rows whose constructor (`0x0603809E`) leaves unlocked=false, favor level=0, and points=0. A direct scene jump is not evidence that the characters have already been met.
- Type **9**, `SolarSchoolFavorLevelAction.OnStart` (`0x06037EF8`), first calls `UnlockRole`, then `TryLevelUpFavor`. The first tier's zero threshold makes an initial introduction reach tier 1.
- `SolarSchoolRoleData.GetLevelFavorCap` (`0x060380BD`) reads **the next tier's** `UpgradeFavorValue`. For the standard 4-tier rows, tier 1 requires 30, tier 2 requires 50, and tier 3 requires 100; tier 0 reads tier 1's threshold 0. A maxed role has cap 0.
- `AddFavor` (`0x060380AC`, friend wrapper `0x06037FBC`) requires an unlocked role, blocks positive gains if the next tier's `PreUnlockConditionId` fails, and clamps points to `[0, cap]`. It never upgrades a tier by itself.
- `TryLevelUpFavor` (`0x060386C9`) requires current points to be full. `LevelUp` (`0x060380B3`) checks the next tier precondition, increments the level, and resets points to **0**, without carrying overflow. `AutoLevelUpFavor` (`0x060386CA`) subsequently traverses additional already-full tiers; this ordinarily covers zero-threshold tiers.
- The successful level-up grants each newly attained tier's `UnlockRewardId` via `GiveFavorLevelUnlockRewards` and injects its own `TryInjectFavorPopup` confirmation. Point changes enqueue a separate reward tip only for the actual delta. Caps/frozen gains therefore must not show a fabricated gain or level-up.

Captures: `phase8-favor-model-il.json`, `phase8-favor-levels-il.json`, `phase8-initial-roles-attrs-il.json`, `phase8-friend-inventory-il.json`.

## Consumables, gifts, shops, and inherited items

Common items require `ItemType=0`, `CanUse`, and at least one owned copy. Using an item consumes one copy, **sums** its attribute effects before applying each attribute's clamp, then applies its buffs. Acquired-item history survives consumption. Applying each effect with its own clamp would produce the wrong result when positive and negative effects share an attribute.

Gifts require `ItemType=1` and an unlocked, unfrozen, nonfull recipient. `SolarSchoolItem.FavorRoleList` chooses **HighLikeVal=20** versus **NormalLikeVal=10**. The separate RoleFavor display row does not determine the grant. Gift use adds/clamps favor, consumes one item, and increments gift-received progress; it does not perform a tier upgrade.

Shop generation chooses one weighted refresh group and samples at most `GroupMaxCount` goods using partial Fisher–Yates; a nonpositive maximum means all goods. It applies each good's ShowCondition **after sampling**, then sorts visible goods by Id. Inventory stock and purchase counts persist for that shop's current refresh cycle. Refresh intervals round up to whole weeks, and use an exact refresh-row lookup. The first partial week is days 1–3; Monday/day 4 begins week 2. A 28-day refresh changes at day **25**. Condition type 25 reads current-cycle counts, optionally filtered by unique GoodsIds, and subtracts its captured numeric baseline for local progress. Purchase preflight checks stock, limits, effective currency, and the complete resulting stack quantity. Pricing truncates at both authored stages; Discount=0 means no discount, and the authored discounted rows retain a minimum price of 1 after buff discounts.

Captures: `phase8-items-gifts-shop-il.json`, `phase8-items-stock-context-il.json`, `phase8-shop-refresh-visible-il.json`.

An independent new game starts with empty inventory and freshly reset acquired history. An authored **NextCycle** has a different initialization path:

1. `StartNextCycleAsync.MoveNext` (`0x06047B00`) calls `CollectInheritItems` (`0x0603865F`) before reset.
2. Collection enumerates current inventory, keeps only **Special / ItemType=2**, and copies each `(itemId,currentCount)`. Past acquisition of an item no longer owned does not make it inheritable.
3. `InitGameInternal` (`0x0603865C`) resets attributes, favor, AVG, map, quests, inventory, shops, scratch, and raffle state. It applies inherited items before quest initialization.
4. `InheritItemsFromLastCycle` (`0x06038660`) calls `AddInheritedItem` (`0x06037FDC`) and then rebuilds Special-item bonuses. Nonpositive quantities are skipped; positive quantities are directly recorded and marked acquired. This path has **no reward dispatch or received-item event**.

This inheritance makes the ten Special-item introductory branches reachable on later authored cycles. Their prerequisites and exact grant sites are in [ROUTE_DATA_EVIDENCE.md](ROUTE_DATA_EVIDENCE.md). Captures: `phase8-final-next-cycle-il.json`, `phase8-final-inheritance-snapshot-il.json`, `phase8-final-inherit-application-il.json`, `phase8-final-inherited-items-location-default-il.json`.

## Affairs, scratch tickets, and raffle

All seven authored type-5 actions, **64003–64009**, use `ActionParams.IdList="[3]"` through `"[9]"`. `SolarSchoolAffairsGameplay.OnExParse` (`0x06038285`) enumerates parameter **values**, trims brackets, splits comma-separated tokens, and appends successfully parsed integers in source order. It does not read a scalar Id parameter. `OnChoiceSelected` (`0x0603828D`) treats the option's Reward as a reward-group ID and grants it immediately; `AdvanceOrFinish` (`0x06038290`) advances to the next affair or finishes. Native `EnterWaitChoice` (`0x0603828A`) logs and skips a missing affair definition or empty option group. Neither gap occurs in the authored action references: raw and exported affairs IDs are **1,3,4,5,6,7,8,9**, and affair 9 has options 91–93 with groups 83091–83093. Eight rows do not imply that Id9 is missing. Capture: `phase8-final-affairs-lottery-il.json`.

Scratch round 1 has a finite **7×7** reward pool, with configured copy counts **1/7/5/5/5/5/10/11 = 49**. Its preferred cost is individual reward **50000**, one item-48 ticket consumed; otherwise individual **50001** costs 3,800 currency. A paid click chooses a reveal pattern, marks newly revealed cells, and stores pending reward IDs. It grants those rewards only at `OnRevealAnimFinished` (`0x0603850A`), then clears the pending list. Pity chooses the guaranteed reveal when Counter≥6; otherwise the bonus requires an integer draw 0–99 below 10 and RevCounter<1. NineGrid order is center, left, right, top, bottom, upper-left, lower-left, upper-right, lower-right. Previously revealed cells are deduplicated, and the full pattern costs one payment.

Raffle **12001** prefers one item-48 ticket; otherwise it costs **9,000 currency**. Award groups 1–8 contain **1/1/1/1/3/4/5/6 = 22** draws. Here RewardId names an **item**, not a reward group, and grants one copy. Each group's configured weight remains flat until its supply is exhausted. The first two draws exclude S; NoSCount≥5 restricts the next draw to S / Rank0; an empty filtered pool falls back to All. The inspected local gameplay path does not depend on a server draw result. Captures: `phase8-games-core-il.json`, `phase8-games-reveal-selection-il.json`, `phase8-games-settlement-order-il.json`.

Reader random draws are deterministic from the saved seed and trigger key, so restoring a checkpoint reproduces its draw. This is an explicit Reader policy; it does not reproduce the original runtime's RNG sequence.

Type **28** is `SolarSchoolItemGetPopupAction`, a presentation action. `OnStart` (`0x06037F0E`) resolves the item and invokes ShowTipsPopup, without adding inventory or calling the reward center. It must not grant a second copy when an earlier reward action already delivered the item. Capture: `phase8-final-extra-actions-il.json`.

## AVG flags, prior choices, and hidden precedence

`SolarSchoolAvgParamData.GetParam` (`0x06037F8B`) uses `TrueKeys.Contains`; `Reset` (`0x06037F8D`) clears that set. An absent AVG key is **false** in a known fresh playthrough. `SolarSchoolAvgParamAction.OnParse` (`0x06037ECD`) splits `Params` by `|`, splits each assignment by `=`, trims names/values, and parses boolean values. `OnStart` (`0x06037ECE`) applies the literal assignments through `SetParam`.

`PlotOptionId` and `PlotKeyId` record **read history**, not AVG variables. `VisualNovelPlayer.ConfirmChoice` (`0x06025213`) records the option's PlotOptionId in `VisualNovelReadRecord`, then invokes `DialogueScript.SelectOption`; `RecordPlotKey` (`0x06025205`) records PlotKeyId in that same read record. `DialogueScript.SelectOption` (`0x0602FCDA`) appends the selected item/option to choice history. No implicit `key<PlotOptionId>=true` is supported by these methods. Later read-mark/skip-selected checks use the separate read record (`HasSelectedOption`, `0x06025210`).

The previous fallback-precedence unknown is resolved. In `VisualNovelPlayer.<ShowChoicesAsync>d__29.MoveNext` (`0x06043F89`), a source **OptionInteractionType of 0** calls `SelectFirstAvailableOption(..., skipSelected:false)`. `SelectFirstAvailableOption` (`0x0602520F`) iterates source order, skips Locked candidates, confirms the first eligible candidate, and returns immediately. A true conditioned first option therefore outranks its unconditional fallback. An earlier unknown prerequisite must still block a conservative reconstructed selection; an unknown after an already-true first candidate cannot change that decision.

Ordinary choices use the same eligibility evaluation. `CreateChoiceData` (`0x0602520A`) removes source-hidden options, removes failed conditions when `HideWhenConditionUnmet` is set, otherwise creates Locked state 2 for unmet conditions. Selected state 1 is a read marker and remains selectable. Unselected state is 0. A missing option condition is true (`IsConditionMet`, `0x0602520B`).

Captures: `phase8-choice-precedence-il.json`, `phase8-hidden-choices-il.json`, `phase8-choice-read-record-il.json`, `phase8-dialogue-choice-il.json`.

## Quest descendants, ownership, and pending state

QuestNodeList seeds construction; it is not the complete node list. `SolarSchoolQuestData.OnInit` (`0x0603805F`) first builds an activity-wide child map through `BuildChildMap` (`0x06038060`), appending every node with nonzero PreNodeId under that predecessor in configuration order. It then iterates `GetQuestListByActivityId` (`0x0603854C`) and calls each `SolarSchoolSingleQuestData.BuildNodes` (`0x06038170`). That method queues the listed nodes, creates each node under the current quest, and queues its children. A local NodeMap suppresses repeated visits; a shared global NodeIndex gives an overlapping node to the **first constructed quest**. A later ownership conflict logs and skips the node without expanding its children. Explicit head status and the currently active date window do not override that owner.

`RebuildNodeListeners` (`0x06038171`) iterates the owner's expanded NodeMap. It skips completed/pending nodes and requires PreNodeId=0 or a completed predecessor in that same local map; a missing local predecessor is false. `OnNodeActionFinished` (`0x06038760`) finds the completed node in the global index, reads its QuestId, then calls that owner's `StartNextNodeListeners` (`0x06038175`) for matching PreNodeId children. `IsNodeDeliverable` (`0x0603875D`) requires a constructed global node, a nonrunning action, and that owner's active state. Descendants therefore inherit the owner's quest activation and date window. Captures: `phase8-quest-descendant-construction-il.json`, `phase8-quest-enumeration-il.json`, `phase8-route-semantics-il.json`.

Node unlock and delivery availability are separate. `TryStartListening` (`0x0603807B`) invokes its hit callback immediately for a zero/true UnlockConditionGroupId, otherwise registers that group. `OnConditionReached` (`0x0603807C`) clears its condition handle; `OnNodeHit` (`0x06038177`) stops listening and adds the ID to PendingNodeList through `AddPendingNode` (`0x06038068`), which deduplicates IDs. Once pending, **unlock truth is latched**. Delivery checks `AvailableConditionGroupId` through `CheckAvailable` (`0x06038765`); it does not reevaluate unlock.

Real mutable cases include node **112141**: its unlock group26100028 requires Chisa11 tier1/full30, which becomes false after a tier upgrade, while available group26100059 only requires no item10 and Instance1. Node100201 unlocks at location1004 and has no availability group. Node280007 unlocks May15/slot3; its availability group repeats that date/slot condition, so it may remain pending while delivery is blocked. Captures: `phase8-quest-pending-latch-il.json`, `phase8-quest-unlock-transitions-source-audit.json`.

`ShouldActivate` (`0x06038756`) rejects outside an owner's inclusive positive StartDayIndex/EndDayIndex bounds, with zero unbounded. Inside the window, an already-active quest remains active even when its activation precondition changes. On deactivation, `Deactivate` (`0x0603875A`) stops listeners and clears nonrunning pending nodes (`ClearPendingNodes`, `0x06038174`). It resets completed-node/reward progress **only if the activation precondition is false then**; date expiry alone preserves completed progress. `CheckQuestActivation` (`0x06038755`) repeats changes to a fixed point, capped at 32 passes.

The activity has **202 uniquely listed nodes plus 122 implicit descendants = 324 constructed nodes**, with no ownership conflicts or cross-owner predecessors in this dataset. Eleven definitions are unowned:120003,120005,120006,120009,120012,120013,120014,171001–171004. The first seven are unreferenced quest/confirmation popup nodes; the final four dispatch group81043, a currency delta0. None supplies the ten hidden-branch mementos or galleryending4, so they do not reopen those resolved prerequisites. Native construction does not invent owners for them. Retained join/order audit: `phase8-quest-descendant-source-audit.json`.

Graduation quest **4260** lists262001/262004/262007/262010, but also owns262002/262003,262005/262006,262008/262009. In the first chain,262001→262002/action4111→script4001→262003/action41003 sets key35;262010/action41006 can then set completion key36. Enumerating only the listed heads drops the farewell scene and its required state. Reader construction now includes these authored descendants.

## Location unlock truth

Location unlock has different semantics from quest-node unlock. `SolarSchoolLocationData.get_IsUnlocked` (`0x06037FE3`) resolves its row on every read: missing row=false; ConditionGroupId0=true; otherwise current `ActivityConditionCenter.CheckGroup` truth. `OnUnlockConditionReached` (`0x06037FE7`) only clears its listener handle and emits a map notification; it stores no permanent unlocked flag. `InitLocations` (`0x06037FF3`) constructs all activity locations, while current-instance filtering belongs to map collection/visibility. Daily clearing removes roles/options. `SolarSchoolMapUnlockAction.OnStart` (`0x06037F13`) validates configured IDs and opens the map presentation; it does not override the location's condition. Captures: `phase8-location-unlock-latch-il.json`, `phase8-location-unlock-lifetime-il.json`, `phase8-final-extra-actions-il.json`.

Condition type12 reads a **LocationId integer list** (`OnInitialize`, `0x06037E3A`), counts live IsLocationUnlocked results (`GetCurrent`, `0x06037E3B`), and requires the entire list length (`GetTarget`, `0x06037E3C`), without a Count override. Leaf13000005 requires all1001–1011. This is independent of whether those locations belong to the current instance. Capture: `phase8-location-condition-list-il.json`.

## Selected condition and ending semantics

`SolarSchoolVisualNovelConfigCenter.IsOptionConditionMet` (`0x0603906B`) delegates the option's SolarSchool ConditionGroupId to `ActivityConditionCenter.CheckGroup`; it does not compare table IDs as flags. Selected complete condition CIL is in `phase8-condition-semantics-il.json`.

Outer option parsing is verified independently of those groups. `VisualNovelOption..ctor` (`0x060251F6`) casts the source PreCondition to **ITalkOptionSystemCondition** and stores it as Condition. It separately copies nullable **HideWhenUnmet**, **HideConditionTextWhenUnmet**, and **TidReplaceTextWhenUnmet** into presentation properties. These fields do not add predicates. `CreateChoiceData` (`0x0602520A`) hides an unmet choice when configured; `GetOptionTextKey` (`0x0602520D`) uses a nonempty replacement key when unmet; `GetOptionConditionText` (`0x0602520E`) respects the hide-condition-text flag. Reader uses these source fields while Developer retains original choice text and complete conditions.

The factory chain closes the authored **1006/node12/option2** exception: `DialogueItem.CreateOptions` (`0x0602FCC2`) includes each non-null source option, `VisualNovelItem.CreateOptions` (`0x060251E7`) wraps each through `VisualNovelOption.Create` (`0x060251F7`), and that factory only calls the constructor above. Its **PreOption / PreOptions:[1]** cannot pass the SystemCondition cast, leaving native Condition null. `VisualNovelPlayer.IsConditionMet` (`0x0602520B`) returns true for null. There is no earlier choice in script1006 and no native prior-option gate on this path; Reader keeps the metadata and allows the dialogue-only option to continue to node13. Other unsupported structures remain unknown. Captures: `phase8-choice-metadata-parser-il.json`, `phase8-choice-item-parser-il.json`, `phase8-choice-options-construction-il.json`, `phase8-choice-option-factory-il.json`, and `phase8-choice-precedence-il.json`.

This outer parsing matters for the true route: **3011/20/3** includes replacement key `TalkOptionUnmetReplaceText_1` beside its group29000036. Its prerequisite is still exactly playthroughCount≥2. **16001/4/options5–7** carry the two visibility booleans. Exhaustive coverage now includes all **76 authored outer prerequisites**, in addition to the 575 leaves/460 groups; the retained fresh/next-cycle/imported probes are in `phase8-hidden-branches.json`. The data builder collects replacement text keys from preserved PreCondition metadata.

| ActivityCondition type | Verified evaluation |
| --- | --- |
| 1 | Attribute `Attr` resolves through the attribute table, then `Min ≤ current ≤ Max` (missing Min/Max default to signed-int bounds). |
| 2 | Sum completed or OnlySuccess behavior counts over the configured BehaviorId list, clamped to signed-int maximum; compare with Count. Local progress subtracts the listening baseline and floors at 0. |
| 3 | `RoleId` is an integer list; count roles with favor tier in inclusive `[Min,Max]`; compare with Count (default list length). |
| 4 | Inclusive ExamId score range; known fresh missing scores are 0. Ending checks use captured exam values. |
| 8 / 9 | Literal Special Request state / number of Finished Special Requests. |
| 6 | Inclusive start/end month/day range, including wrap-around intervals. |
| 7 | Date reached: `IncludeSelf=true` means `current≥target`; false means `current>target`. |
| 10 | ItemId current quantity ≥ Count (default 1). Absent known inventory is 0. |
| 11 / 12 / 13 | Playthrough count range / all configured LocationId-list locations currently unlocked / current weekday membership. |
| 14 | Current location membership, with the configured date window and optional native TimeSlots filter. Fresh map location is 0 after MapData.Clear (`0x06037FF6`); absent imported location remains unknown. |
| 15 | Literal AVG Key equals expected boolean Value (default true). |
| 16 | Current InstanceId membership. |
| 17 | Any selected-ending ID matches any configured EndingIds entry. Selection is distinct from an account achievement. |
| 19 | Current favor tier + 1 equals the configured FavorLevel, and current points are full. |
| 20 / 21 | Configured fatigue-stage membership / current time-slot membership. |
| 22 | BehaviorId is an integer **list**; count currently unlocked behaviors, compare with Count (default list length). Unlock reads the active behavior level's ShowCondition, not historical completion alone. |
| 23 | Exact influence Level if present, otherwise inclusive Min/Max range. |
| 24 | Attribute Count. For local progress, current is `max(raw attribute − listening baseline,0)`; global progress reads the current raw attribute. |
| 25 | Current-refresh-cycle shop purchase count, optional unique GoodsIds filter, and numeric local baseline subtraction. |
| 26 | Sum gift-received counts over the configured RoleId list; local progress subtracts its listening baseline. |
| 27 | Reward progress/count for the specified quest. |
| 28 | Count completed quest nodes from the QuestNodeId integer list; Count defaults to list length. |
| 29 | Inclusive current ItemId quantity range; missing Min=0 and Max=signed-int maximum. |
| 30 | `SolarSchoolActivityData.IsEndingUnlocked(EndingId)` reads the activity/gallery achievement, not merely the current chosen-ending list. |

`SolarSchoolEndingFlowGraph.GetNextNodeId` (`0x0603824F`) follows type 1 `NextId`, type 2 `TrueNextId`/`FalseNextId`, and terminates at types 3/4. This is ordered graph traversal, not a scan of all satisfied ending rows. `GetConditionAttr` (`0x06038649`) reads frozen `EndingSnapshot` values once that snapshot exists, otherwise current player attributes (base plus bonuses, clamped). Ending presentation rewards must not retroactively change that snapshot. `SolarSchoolEndingAction.CompleteEnding` (`0x06037EEB`) calls `SendReachEnding` only after the ending playback completes. Server acknowledgement/account persistence are separate from a local Reader model. See `phase8-reward-center-il.json`, `phase8-dispatcher-actions-il.json`, `phase8-buff-favor-rewards-il.json`; calendar/request/ending trigger auditing is recorded separately in the route report.

Snapshot timing is also resolved. `SolarSchoolEndingState.OnEnterState` (`0x06038244`) calls **ResetEndingRuntime → CaptureEndingSnapshot → EnterEndingDay → initialize/start graph → AdvanceFlow**. The snapshot therefore follows completion of the preceding day's queued tasks and authored actions, including deadline-failure actions, and precedes presentation date changes and the first graph action. Capture: `phase8-final-inheritance-snapshot-il.json`.

The exhaustive selected-condition CIL capture, `phase8-all-condition-semantics-il.json`, retains all 29 SolarSchool condition class implementations for future parameter/default inspection. Buff reward/config/model joins are in `phase8-buff-favor-rewards-il.json`, `phase8-buff-attributes-il.json`, and `phase8-condition-buff-details-il.json`. BehaviorId scopes must be retained: the local attribute buffs are scoped to specified behaviors and do not grant global base stats merely when acquired.

The regenerated source/evaluator audit is `test-results/phase8-dataset-route-audit.json`: **575/575** authored leaves and **460/460** groups evaluate with no unknown in the known fresh state (**88/487** true/false leaves; **65/395** groups). This includes live LocationId-list semantics and current descendant/pending construction. Node112141's retained regression proves that its pending state remains deliverable after an upgrade makes its unlock group false, while its separate available group remains true. Condition **13000053**, type22, specifically counts unlocks over `4002|4004|4006|4008|4010|4012|4016|4018|4022` and requires 2; treating BehaviorId as a scalar would leave this journey goal unresolved. All 11 hidden nodes have established prerequisite namespaces and precedence. These probes establish rule coverage, not a claim that every route is reachable from the same initial state or has been manually played.

Normal public-controller validation is retained separately in `phase8-ending-playthrough-tests.json`: three successive school years cover 44,749 inputs/613 scenes and achieve endings 12, then 12/2, then 4. The second year obtains all ten farewell mementos once; the third inherits them and takes all ten conditioned introductions without a Developer override. The actual script3011 true-route choices set all three AVG flags and traverse graph20→47→script3030. The achieved gallery state subsequently satisfies `3010/35/option2` in an evaluator check; the authored End terminal does not replay script3010. Exact policies and community tester IDs are in [ROUTE_DATA_EVIDENCE.md](ROUTE_DATA_EVIDENCE.md).

## Remaining evidence boundaries

These CIL bodies establish the dispatch/selection/state rules above. Exact original-game timing, account server responses, probabilistic management rolls, and opaque native prefab properties were not observed. Missing definitions, unsupported structures, unavailable imported baselines, and unmet prerequisites whose supporting state is absent must stay explicit in Developer diagnostics. A normal fresh Reader playthrough has source initialization; an arbitrary developer scene jump cannot reconstruct its previous journey by guessing.
