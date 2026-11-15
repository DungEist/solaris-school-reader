# Places on the Reader stage

This report covers the initial Places feature. [Progression choices on the Reader stage](READER_DECISIONS.md) extends it to Go out, other journey actions and interactions, eligible Finish exploring, and subsequent school years.

Exploration's destination step now keeps the normal Reader stage visible and displays Places on the right using the existing dialogue-choice layout and artwork. The same `JourneyButton` renders both these choices and School year's Places list. Names, visit counts, availability, and `journey.select` come from the existing journey options. The stage holds no separate location progress or selection logic.

The journey exposes a derived `selectingLocation` flag when an exploration map has started and reaches planning after its queued opening scene. Choices stay hidden during dialogue, pending confirmations, native panels, and destination playback. School year remains accessible through the Handbook menu with its existing Places and Finish exploring controls.

The fresh Chromium run started at `/?script=1001` and used public Reader mouse controls throughout the opening and Go out. Actual runner IDs were inspected passively; the address bar continued to show `?script=1001`.

| Step | Verified result |
| --- | --- |
| 03/16 Morning → School year → Explore → Go out | Street script `1006` plays before Places appears. |
| `1006/completed` | Right-side stage choices show **Central Square 0/1** and **School Store 0/1**, with no planning panel open. |
| Select `location:1015` on the stage | Opens `1008/1`; scene count increases once and completed flow read count is 1. |
| Return after `1008` completes and its tier confirmations close | Central Square becomes hidden under its authored availability; **School Store 0/1** remains available on the stage. |
| Menu → School year | Shows the same remaining Places option/count/availability and the existing **Finish exploring** control. Closing it restores the stage choices. |

Central Square's saved visit count becomes 1; its authored visibility condition then removes it from the existing Places list. The stage follows that list. It also reads live progress/target values for destinations that remain visible after a visit.

Opening responses for this capture are `1003/1/12`, `1003/6/15`, `1004/11/2`, and `1004/16/6`. Go out uses `explore:2`; choose option 2 at `1006/12`, then Central Square `location:1015`. The captured square responses are `1008/22/2`, `1008/44/6`, and `1008/71/10`.

Local captures:

- [Street completed with Places](../test-results/reader-places/captures/street-completed-places.jpg)
- [Selected destination at 1008/1](../test-results/reader-places/captures/destination-opened-once.jpg)
- [Returned destination list](../test-results/reader-places/captures/returned-places.jpg)
- [School year after return](../test-results/reader-places/captures/school-year-after-return.jpg)

The [compact result](../test-results/reader-places/summary.json) records source options, rendered labels/counts, layout assertions, scene counts, and capture paths. The [complete browser result](../test-results/reader-places/result.json) and [event trace](../test-results/reader-places/trace.json) also preserve the existing relationship timing, actor handoffs, one-time street Feeling reward, History, and checkpoint checks. REA `ev_2394bada3b0fe0a6272f6f7a6484ab38a5ead72f32a2f1e11da3c4a1b1444188` exited with code 0 with verified cleanup of its owned process group; its compact manifest is [rea.json](../test-results/reader-places/rea.json). The initial probe failure before the route reached Go out is retained separately under `reader-places-before-card-probe`.

Validation passes 44 focused tests and 329 full tests plus Python asset checks, typecheck, and production build. The real-route React check also verifies repeated renders preserve state, panel/stage options match, a second activation cannot open the active destination again, and return availability updates. Logs are [focused tests](../test-results/reader-places-tests.log), [full tests](../test-results/reader-places-full-tests.log), and [build](../test-results/reader-places-build.log). Replay with `node tools/phase8-boundary-browser-check.mjs --places` against the production build.
