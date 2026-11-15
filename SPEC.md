# SPEC — Solaris School Reader

Đặc tả hệ thống cho trình đọc visual novel riêng của dự án *Second Coming of Solaris: Unwritten Dreams* (SolarSchool), dựa trên codebase `DungEist/VNreader`. Tài liệu này dành cho Claude Code triển khai.

> Trạng thái: bản nháp v0.4 (schema 2) (đã giải mã điều kiện và đồ thị ending; xem phụ lục A). Các mục đánh dấu **[CHƯA XÁC MINH]** là điều chưa kiểm tra được trong dữ liệu. Không được suy đoán, phải điều tra hoặc hỏi chủ dự án (xem mục 12).

---

## 1. Mục tiêu và phạm vi

**Mục tiêu:** đọc/chơi lại toàn bộ cốt truyện của sự kiện, đúng thứ tự và đúng logic rẽ nhánh, bằng giao diện riêng (không còn dấu vết PGR).

**Phân tầng phạm vi** (mỗi tầng chạy độc lập được, làm theo thứ tự):

| Tầng | Nội dung | Ưu tiên |
|---|---|---|
| T1 — Script Reader | Chọn kịch bản, đọc thoại, lựa chọn rẽ nhánh trong kịch bản, history, save, auto/skip | Bắt buộc |
| T2 — Story Graph | Sắp xếp kịch bản theo thứ tự chơi thật, ending graph, mở khóa theo điều kiện, Gallery ending | Bắt buộc |
| T3 — Simulation | Lịch 262 ngày, hành động theo khung giờ, chỉ số, độ thân thiết, thi cử, quest | Tùy chọn, làm sau |

Ngoài phạm vi: cửa hàng, vé cào, diễn đàn dưới dạng minigame, phần thưởng/vật phẩm thật. Nếu cần thì chỉ đọc nội dung (xem 4.6).

## 2. Nguyên tắc kiến trúc

1. **Ba lớp tách biệt:** (a) Dữ liệu trung lập, (b) Asset resolver, (c) UI/runtime. UI không bao giờ đọc dữ liệu thô của game.
2. **Không hardcode PGR:** bỏ `pgr_assets`, `pgr_audio`, `voiceFolderMap`, `wiki_db.json`, `huaxu.app` proxy, Type số kiểu PGR (101…601).
3. **Thiếu asset không được làm hỏng đọc truyện:** mọi asset đều có placeholder mặc định (4.4, 6).
4. **Dữ liệu là bất biến lúc chạy**, trạng thái người chơi chỉ nằm trong `PlayState` (5.3).
5. **Ngôn ngữ tách khỏi cấu trúc:** cấu trúc kịch bản chứa khóa văn bản (`textKey`), chữ nằm ở bảng locale riêng, để đổi ngôn ngữ không phải sinh lại kịch bản.

## 3. Nguồn dữ liệu

Nguồn: clone `Arikatsu/WutheringWaves_Data` (GameVer 3.8.0, ResVer 3.8.6). Chỉ đọc, không sửa.

| Mục đích | File |
|---|---|
| Kịch bản VN (thoại, nhân vật vào/ra, lựa chọn, nhảy) | `BinData/flowState/flowstate.json`, lọc `StateKey` chứa `索拉学院` (429 mục) |
| Đăng ký kịch bản (ID → kịch bản) | `BinData/SolarSchool/solarschoolflow.json` (426 dòng) |
| Chữ | `Textmaps/<lang>/multi_text/MultiText.json` (`Id` → `Content`) |
| Người nói | `Speaker_<WhoId>_Name` trong MultiText |
| Ending | `solarschoolending.json` (12), `solarschoolendingflow.json` (74 node), `solarschoolendingsummary.json` |
| Quest / kích hoạt | `solarschoolquest.json` (147), `solarschoolquestnode.json` (335) |
| Lịch | `solarschoolcalendar.json` (285 dòng), `solarschooltimeslot.json` (5), `solarschooldateperiod.json` (8) |
| Hành động | `solarschoolbehavior.json` (124), `solarschoolbehaviorcategory.json` |
| Địa điểm, nhân vật | `solarschoollocation.json` (196), `solarschoolrole.json` (14), `solarschoolrolespine.json`, `solarschoolroletalk.json` |
| Chỉ số, tham số | `solarschoolattr.json` (8), `solarschoolparam.json` (35) |
| Thi cử | `solarschoolexam*.json`, `solarschooleventcheck*.json` |
| Điều kiện | `BinData/condition/condition.json`, `conditiongroup.json`, `conditiontype.json` |
| Nền | `BinData/AvgBackground/avgbackground.json` (38 mục: `Id`, `Description`, `DayPicPath`, `NightPicPath`) |
| Thư, diễn đàn | `solarschoolletter*.json`, `solarschoolforum*.json` |
| Gallery | `solarschoolgallery.json` (68) |

### Quy tắc đã xác minh

- **Khóa kịch bản:** `StateKey = "{FlowListName}_{FlowId}_{StateId}"`. Cả 426 dòng của `solarschoolflow.json` khớp 1-1 với `flowstate.json` (426/426). 3 mục không có dòng đăng ký: `…后日谈_1_1`, `…短信_1_1`, `…考试_1_17` (build gán ID `x1…x3`, `registered:false`).
- **`solarschoolflow.Id` là "ActionId" của nhiều bảng khác:** `solarschoolendingflow.ActionId`, `solarschoolending.FlowId` (cả 12 ending đều hợp lệ), `solarschoolquestnode.ActionId`.
- **ActionId không thuộc flow = hành động hệ thống** (đã giải mã nhờ cột `Comments` của `solarschoolendingflow`, xem 4.5). Với `solarschooloptions.ActionId` (ví dụ `5611`) và đa số `ActivityAction` thì **[CHƯA XÁC MINH]**.
- **Định danh nhân vật có hai tầng:** `WhoId` (trong kịch bản) là *người nói*; hình nhân vật lấy từ **ID biểu cảm** (`Expression`) → `AvgSolarSchoolRoleAnimation` (233 mục, có `AvgTalkerId`) → `AvgTalkerConfig` (61 mục, có Spine). Nhiều `WhoId` (ví dụ `999`, `1316`) **không** có trong `AvgTalkerConfig`, nên không được tra sprite bằng `WhoId`.
- **Nền / CG:** `Enter/…` không mang nền; nền đổi qua `VisualNovelBackgroundConfig.BackgroundId` (→ `AvgBackground`, 38 mục, có bản ngày/đêm) và CG qua `CgConfig.ImageId` (→ `AvgCg`, 72 mục, có biến thể nam `PicPathMaleVariant`).
- **Một số ID tham chiếu không có trong bảng:** nền `800001` (không có trong `AvgBackground`), speaker `83` (không có tên). Phải xử lý như asset thiếu, không được làm hỏng đọc truyện.
- **Điều kiện nằm ở `BinData/ActivityCondition/*`, không phải `condition/*`** (đã xác minh): `activityconditiongroup.json` (460 nhóm, `Logic` 0 = AND, 1 = OR; 34 nhóm là OR, xem 4.7) → `activitycondition.json` (575 điều kiện, `Type` số) → `activityconditionclienttype.json` (29 loại, tên tiếng Trung `第二索拉…`). Mọi `ConditionId`/`ConditionGroupId` của các bảng SolarSchool đều resolve được (410/410); riêng `solarschoolgallery.UnlockCondition`, `solarschoolquestreward.LocalCondition` và `solarschoolscratchticketco.Min/MaxCondition` trỏ vào bảng `condition/*` chính. Một số ID trùng nhau giữa nhóm và điều kiện (56 ID); phần tử trong nhóm luôn là *điều kiện*, không có nhóm lồng nhau.
- **Tham số cân bằng:** `TotalDays = 262`, `TiredThreshold = 30`, `SickThreshold = 80`, `NormalLikeVal = 10`, `HighLikeVal = 20`, `VisualNovelFastForwardRate = 260`, `VisualNovelUltraFastForwardRate = 10000`.
- **Ngôn ngữ:** `en` có 292.885 mục có chữ, `ja` có 292.818, `vi` hoàn toàn rỗng.

## 4. Mô hình dữ liệu trung lập

Đây là định dạng **thực tế do `build_data.py` xuất ra** (đã chạy, đã validate). Thư mục xuất `data/`, mọi file JSON UTF-8:

```
data/
  manifest.json
  scripts.index.json            [{id, stateKey, group, nodes, registered}]
  scripts/<id>.json             429 file (id = solarschoolflow.Id, hoặc x1..x3)
  locales/<lang>.json           textKey -> string, chỉ các khóa được tham chiếu (8.805 khóa; en ~1,0 MB, ja ~1,5 MB)
  speakers.json                 WhoId -> {nameKey, talkerId, nameZh}
  maps/                         flow-registry, story-graph, endings, conditions, condition-types, quest-nodes, calendar, behaviors,
                                locations, roles, attrs, backgrounds, cgs, expressions, talkers, audio
  assets.manifest.json          id logic -> đường dẫn UE (không có file nhị phân)
  assets.usage.json             {scriptId: {bg, cg, talker, expr, audio, fx, voice}}
  build-report.json
```

### 4.1 `manifest.json`

```json
{ "schema": 2, "activityId": 111700001, "titleKey": "Activity_111700001_Title",
  "source": { "gameVersion": "3.8.0", "resVersion": "3.8.6", "changelist": 9383927 },
  "defaultLocale": "en", "locales": ["en", "ja"],
  "scripts": "scripts.index.json", "endings": "maps/endings.json",
  "story": "maps/story-graph.json", "assets": "assets.manifest.json", "report": "build-report.json" }
```

### 4.2 `scripts/<id>.json`

```json
{ "id": "1001", "stateKey": "剧情_3.8索拉学院_开局_2_1", "group": "开局",
  "needSave": true, "registered": true,
  "config": { "initialBackground": 700016, "initialAudio": ["play_avg_music_3_8_slience"], "subtype": "SolarSchool" },
  "flowActions": [ /* configure | talk | movie | unsupported; xem B.3 */ ],
  "nodes": [ /* Node[] */ ] }
```

`id` luôn là **chuỗi**. Thứ tự file/`scripts.index.json`: theo `solarschoolflow.Id` tăng dần, các script chưa đăng ký ở cuối.

**Node** (mỗi `TalkItem` gốc → 1 node, `nid` = `TalkItem.Id` gốc, duy nhất trong một script):

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `nid` | number | |
| `kind` | `line` \| `narration` \| `centerText` \| `silent` \| `option` | từ `Type` gốc, bảng dưới |
| `style` | string | `Type` gốc nguyên văn (`VisualNovelTalk`, …) |
| `speakerId` | string \| null | `WhoId` dạng chuỗi, `null` = người dẫn truyện; tra `speakers.json` |
| `textKey` | string \| null | khóa trong `locales/<lang>.json` |
| `stage` | StageOp[] | chạy theo phase start/end và thời gian t (mục dưới) |
| `voice` | string \| string[] (tùy chọn) | tên cue Wwise, từ `PlayVoice` / `TalkAkEvent` |
| `options` | Option[] (tùy chọn) | lựa chọn (có trong 189 node) |
| `next` | `{type:"seq"}` \| `{type:"jump",to}` \| `{type:"end"}` | node có `options` thì quyết định bởi option |
| `actions` | object[] (tùy chọn) | action của node ngoài `JumpTalk`/`FinishTalk`, giữ nguyên |
| `raw` | object (tùy chọn) | `WaitTime`, `DialogDelay`, `Interjection`, `PlotKeyId`, `PlotLineKey`, `PlotLineId`, `OptionGroup`, `OptionInteractionType`, `CameraMotion`, `Style`, `ClickShowFull`, `Actor*`, `FlowTemplateList`, `TextId`, `Name` |

Ánh xạ `kind`: `VisualNovelTalk`, `Talk` → `line`; `VisualNovelNarration` → `narration`; `VisualNovelCenterText` → `centerText`; `VisualNovelNoTextItem` → `silent`; `VisualNovelOption` → `option`. Phân bố thực tế: `line` 5.361, `narration` 2.922, `centerText` 123, `silent` 85, `option` 2.

**Option (schema 2):** `{ "textKey", "to", "next", "optionId", "actions"? }`. `next` là nguồn quyết định duy nhất, cùng union `seq | jump | end` như node. `to` chỉ giữ để tương thích công cụ kiểm tra cũ; engine schema 2 không được dựa riêng vào nó.
- `FinishTalk` → `next:{type:"end"}`; `JumpTalk` → `next:{type:"jump",to:TalkId}`; không có lệnh điều hướng → `next:{type:"seq"}`. `to:null` **không** đồng nghĩa `seq`: script `17048`, node `2`, option `5` phải kết thúc ShowTalk. Nếu nhiều lệnh điều hướng trong cùng option, build ghi `optionControlConflicts`; không nghiệm thu bản build có conflict. Builder ưu tiên `end` để không chạy xuyên qua lệnh kết thúc.
- `optionId` = `PlotOptionId` = **số hiệu cờ AVG** (`BitFlag` trong `solarschoolavgparam.json`, khóa `key<N>`). Bằng chứng: cả 46 `optionId` khác rỗng đều là BitFlag hợp lệ (1–71), và các cờ này chỉ được *đọc* trong điều kiện (loại 15 `AVG变量`), không có bảng nào ghi chúng. Runtime phải ghi `avgVars[N] = true` khi người chơi chọn option đó. **[GIẢ THUYẾT mạnh, chưa kiểm chứng trong game]**; `PlotKeyId` (trong `raw`, 49 giá trị, cũng đều là BitFlag hợp lệ) có thể là cơ chế khác (cờ "điểm cốt truyện" khi node được phát) **[CHƯA XÁC MINH]**, T1 chỉ lưu lại.
- `actions` = các action của option ngoài `JumpTalk` và `FinishTalk` (giữ nguyên); hai lệnh điều hướng đã được chuẩn hóa vào `next`, không thực thi lại.

**StageOp** (từ `StartPerformances` + `EndPerformances` + `VisualNovelBackgroundConfig` + `CgConfig`). Trường chung: `t` (StartTime, giây), `phase:"end"` (chỉ xuất hiện với EndPerformances), `op`.

| `op` | Trường | Nguồn |
|---|---|---|
| `enter` / `exit` / `move` / `modify` | `who`, `expr`, `hidePortrait`, `hideAvatar`, `effect`, `pos:[x,y,scale]`, `dur`, `fadeIn`, `fadeOut` | `Enter`/`Exit`/`Move`/`ModifyRole` |
| `audio` | `cue` | `SendAudioEvent` |
| `portraitFx` | `who`, `fx`, `amp` | `PortraitEffect` (vd `Jump`/`Medium`) |
| `screenFx` / `stopScreenFx` | `fx`, `fxType`, `path` | `PlayScreenEffect`/`StopScreenEffect` (`Persistent`) |
| `cgMove` | `from`, `to` (`[x,y,scale]`), `dur`, `ease` | `CgMove` |
| `blackIn` / `blackOut` | `fade`, `screen` (`Black`…) | `EnterBlackScreen`/`LeaveBlackScreen` |
| `roleIntro` | `introId`, `dur` | `RoleIntroduction` |
| `activityAction` | `kind`, `actionId` | `ActivityAction` (`SolarSchoolActionId`) |
| `bg` | `id`, `mode` | `VisualNovelBackgroundConfig` (`Type:"Load"`, `BackgroundId`) |
| `cg` | `id`, `mode` | `CgConfig` (`Type:"LoadImage"`, `ImageId`) |
| `unknown` | `type`, `raw` | op chưa biết (hiện **0**) |

`expr` là ID biểu cảm (ví dụ `700131`), không phải tên file: sprite = `expressions.json[expr]` → `AvgTalkerId` → `talkers.json`.

**Chân dung nhân vật là Spine** (`SolarSchoolSpineAtlas`/`SolarSchoolSpineSkeletonData` trong `AvgTalkerConfig`, animation theo `BodyAnimation`/`EyeAnimation`/`MouthAnimation`/`BlinkAnimation`), không phải ảnh tĩnh. Hệ quả cho asset resolver và PlayerView: hỗ trợ placeholder tĩnh trước, Spine (nếu có asset) là tùy chọn sau.

**`ActivityAction`:** 284 ID khác nhau (510 lần dùng). 27 ID trong đó trùng với `solarschoolflow.Id` (nhiều khả năng là *gọi flow lồng nhau*); phần còn lại thuộc loại action khác (thưởng, thư, quest…) **[CHƯA XÁC MINH]**. Phát triển: T1 chỉ ghi log, không thực thi.

### 4.3 `locales/<lang>.json` và `speakers.json`

- `locales/<lang>.json`: bảng phẳng `textKey → string`, **chỉ** khóa được dữ liệu tham chiếu: khóa thoại, khóa lựa chọn, khóa tên người nói (`Speaker_<WhoId>_Name`) và mọi chuỗi trong các bảng map khớp một khóa văn bản (ending, quest, location, role, roletalk, rolespine, attr, behaviorcategory, timeslot). Khóa không có chữ bị bỏ qua (53 khóa ở `en`, 54 ở `ja`; xem `build-report.json`).
- Tùy chọn `--fallback <lang>`: điền chữ của ngôn ngữ dự phòng khi khóa rỗng ở ngôn ngữ khác.
- `speakers.json`: `{ "<WhoId>": { "nameKey": "Speaker_<WhoId>_Name" | null, "talkerId": number | null, "nameZh": string } }`. 69 speaker; speaker `83` không có `nameKey`.
- Chuỗi có placeholder: `{PlayerName}` và `{Male=...;Female=...}`, cộng tag giống HTML. Parser có test riêng.

### 4.4 `assets.manifest.json`, `assets.usage.json`, `maps/audio.json`

`assets.manifest.json` chỉ chứa ID và đường dẫn UE (`/Game/Aki/...`), **không có file nhị phân**, và chỉ gồm asset mà dữ liệu thực sự dùng:

```json
{ "backgrounds":  { "700021": { "label": "家", "day": "/Game/…", "night": "/Game/…" } },
  "cgs":          { "700012": { "label": "…", "path": "/Game/…", "pathMale": "/Game/…" } },
  "talkers":      { "850001": { "name": "…", "spineAtlas": "…", "spineSkeleton": "…" } },
  "expressions":  { "700131": { "talkerId": 850001, "label": "…", "body": "…", "eye": "…", "mouth": "…" } },
  "audio":        { "play_avg_music_3_8_solarschool_25": { "kind": ["bgm"] } },
  "fx":           { "UiItem_FxLoop_PurpleHuaban": "/Game/…" } }
```

- `assets.usage.json`: `{ "<scriptId>": { "bg":[], "cg":[], "talker":[], "expr":[], "audio":[], "fx":[], "voice":[] } }`, dùng để lập bảng kê asset cần thiết theo từng script.
- `maps/audio.json`: `{ cue: { "kind": [...], "usedBy": [scriptId | "rolespine" | "roletalk" | "location" | "endingsummary"] } }`. `kind` ∈ `bgm` (cue chứa `music`, và `AudioResource` của ending summary), `amb` (cue bắt đầu bằng `play_amb`, và `Abient` của location), `sfx`, `voice` (`PlayVoice`/`TalkAkEvent`, `AudioId` của rolespine/roletalk).
- Cue lấy từ `AudioEvent` bằng cách bỏ tiền tố đường dẫn và hậu tố sau dấu chấm (`…/play_x.play_x` → `play_x`).

### 4.5 `maps/endings.json` và `maps/story-graph.json`

**`endings.json`:** 12 hàng từ `solarschoolending.json` (`Id`, `ConditionId`, `FlowId`, `EndingType`, `Desc` (khóa chữ tên ending), `Star`, `Sort`, `IconMale`, `IconFemale`, `IconQuality`, `Comments`), cộng hai trường do build thêm: `kindName`, `conditionExpr`.

`EndingType` đã giải mã: **1 = ending độc quyền** (không điều kiện, flow nhóm `结尾`), **2 = ending chính/nghề nghiệp** (flow nhóm `职业结局`, trừ ending 1 cũng loại 2), **3 = ending bạn đồng hành** (flow nhóm `结尾`). Điều này khớp với hành động hệ thống 3001 (chọn ending nghề nghiệp) và 3002 (chọn ending tình cảm).

| # | Loại | FlowId | Tên (en) | Điều kiện (dịch từ `conditionExpr`) |
|---|---|---|---|---|
| 1 | 2 | 3029 | Special Ending: Toward Tomorrow | độ thân thiết ≥ 4 với 10 nhân vật (RoleId 1,2,4–11) **và** `key60` |
| 2 | 3 | 3017 | Companion Ending: The Warmth of Fireworks | độ thân thiết Changli (RoleId 1) ≥ 4 |
| 3 | 3 | 3018 | Companion Ending: A Journey of Freedom | độ thân thiết Cartethyia (RoleId 2) ≥ 4 |
| 4 | 1 | 3030 | Exclusive Ending: The "Real" World | không có (đạt qua nhánh true end, `key13` **và** `key14` **và** `key15`) |
| 5 | 2 | 3028 | Hidden Ending: The Great {PlayerName} | giữ vật phẩm 67 ("Letter of Intent to Acquire the School") |
| 6 | 2 | 3027 | Hidden Ending: School Idol | giữ vật phẩm 73 ("Reputation Certificate") |
| 7 | 2 | 3026 | Ending: The People's Teacher | thuộc tính 5 (Feeling) ≥ 320 **và** `key60` |
| 8 | 2 | 3022 | Ending: Academic Titan | thuộc tính 1 (Knowledge) ≥ 850 **và** 2 (Thinking) ≥ 600 |
| 9 | 2 | 3024 | Ending: Laureate Conductor | thuộc tính 3 (Aesthetics) ≥ 850 **và** 4 (Physique) ≥ 600 |
| 10 | 2 | 3023 | Ending: Investment Warrior | thuộc tính 2 (Thinking) ≥ 500 |
| 11 | 2 | 3025 | Ending: Ace Mountaineer | thuộc tính 4 (Physique) ≥ 500 |
| 12 | 2 | 3019 | Ending: Me and Abby | không có (chọn qua ending, `EndingIds=12`) |

**Lưu ý chưa khớp:** `FlowId` 3022–3029 của các ending nghề nghiệp trùng với các flow được phát *vô điều kiện* trên trục thời gian (node 15, 17, 48–53 của đồ thị, comment "12月30/31号…"). Quan hệ giữa hai cách dùng này **[CHƯA XÁC MINH]**; đừng giả định "chọn ending X ⇒ phát `FlowId` X" cho tới khi kiểm chứng. Flow 3030 (64 node, ending độc quyền) cũng không có node nào trỏ tới trong đồ thị, nhiều khả năng do hành động hệ thống 3003 phát.

**`story-graph.json`:**

```json
{ "startNode": 48, "nodeTypes": { "...": "..." },
  "nodes": [ { "id": 24, "type": 1, "flowId": 3001, "systemAction": true,
               "conditionId": null, "next": 46, "true": null, "false": null,
               "isStart": false, "comment": "职业结局选择并播放所选结局剧情" } ] }
```

Loại node (đã giải mã từ `Comments`):

| `type` | Số node | Ý nghĩa |
|---|---|---|
| 1 | 50 | Phát flow `flowId` (tra `maps/flow-registry.json`) **hoặc hành động hệ thống** khi `systemAction:true` |
| 2 | 22 | Rẽ nhánh theo `conditionId` → `true` / `false` |
| 3 | 1 | Kết thúc luồng ending (`结局流程结束`) |
| 4 | 1 | Điểm cuối: **bắt đầu lượt chơi mới** (`结局-开启下一周目`) |

**12 hành động hệ thống** (node loại 1 có `flowId` không thuộc `flow-registry`) — runtime phải cài từng handler:

| Node | `flowId` | Comment gốc (ý nghĩa) |
|---|---|---|
| 24 | 3001 | 职业结局选择并播放所选结局剧情 (chọn và phát ending nghề nghiệp) |
| 26 | 3002 | 情感结局选择并播放所选结局剧情 (chọn và phát ending tình cảm) |
| 27 | 3041 | 播放周目总结 (phát tổng kết lượt chơi) |
| 42 | 3038 | 梅塔结局8-保住学校，职业结局，有情感结局 |
| 47 | 3003 | 真结局，直接结束游戏（不进下一周目）(true ending, kết thúc hẳn) |
| 60 | 3039 | 结局-提示进入下一周目 (nhắc vào lượt chơi kế) |
| 77 | 9006 | 道别信没情感结局 (thư tạm biệt, không có ending tình cảm) |
| 78 | 9007 | 道别信有情感结局 (thư tạm biệt, có ending tình cảm) |
| 81 | 3044 | 大富翁 (danh hiệu "đại gia") |
| 83 | 3045 | 人气王 (danh hiệu "vua nổi tiếng") |
| 84 | 3043 | 发毕业册 (phát kỷ yếu) |
| 99 | 3042 | 触发存档提示 (nhắc lưu game) |

**Đồ thị ending đã giải mã** (74 node; `startNode = 48`; điều kiện rút gọn từ `conditionExpr`):

1. **Trục thời gian ngày 30–31/12:** 48 → 1 (`结尾` 3004, sự kiện học viện) → 99 (hệ thống: nhắc lưu) → 49 → 62 → … → 50 → 6 → … → 51 → 9 → … → 52 → 80 → … → 12 → … → 15 → 16 → 17 → 18 → 53 → 19 → 20 → …
2. **Phe:** node 62–66 xét cấp phe (`InfluenceId` 1 = Student Council, 2 = Club Association) để chọn phát bảng điểm hội học sinh/câu lạc bộ (flow 3105/3106), node 3/6 xét cấp 3 để chọn nhánh "thành công/không thành công" của từng hội (3006–3009).
3. **Giữ trường:** node 12/28/71/72 dùng cùng một điều kiện OR "trường được giữ": giữ vật phẩm 67 **hoặc** 73 **hoặc** phe 1 cấp 3 **hoặc** phe 2 cấp 3.
4. **True end:** node 20 = `key13 AND key14 AND key15` → true ⇒ 47 (hành động hệ thống 3003, kết thúc hẳn); false ⇒ 22 → 23 (tiễn ở ga) → 70 (thư).
5. **Thư tạm biệt và ending tình cảm:** node 70/71/72 chọn một trong 4 thư (flow 9001–9004, nhóm `长离个人线`) theo (có ending tình cảm, trường được giữ); sau đó 24 (hệ thống 3001 chọn ending nghề nghiệp) → 46 (đã chọn ending 1?) → 25 (có ending tình cảm = độ thân thiết Changli **hoặc** Cartethyia ≥ 4?) → 79 → 26 (hệ thống 3002) → 78/77 (thư tạm biệt 9007/9006) → 84 (kỷ yếu 3043) → 27 (tổng kết lượt chơi 3041).
6. **8 biến thể "Meta" (梅塔差分):** node 28–42 phân theo (trường được giữ) × (đã chọn ending 12 "Me and Abby") × (có ending tình cảm) → flow 3021, 3032–3038, mọi nhánh về 60 → 61 (bắt đầu lượt mới).
7. **Danh hiệu:** node 80–83: vật phẩm 67 ⇒ hệ thống 3044 ("đại gia"); vật phẩm 73 ⇒ 3045 ("vua nổi tiếng").

`maps/flow-registry.json`: `{ "<solarschoolflow.Id>": { "stateKey", "group", "needSave", "bitFlag" } }`.

### 4.6 Các map T3 (đã được xuất, chưa dùng ở T1/T2)

- `maps/calendar.json`: `{calendar (285 ngày), timeSlots (5), datePeriods (8)}`. Mỗi ngày có 5 danh sách hành động theo khung giờ (`DawnActions`, `DayActions`, `NoonActions`, `DuskActions`, `NightActions`).
- `maps/quest-nodes.json`: `{quests (147), nodes (335)}`; node: `{PreNodeId, UnlockConditionGroupId, ActionId→flow, TriggerTiming, TriggerParam, Priority}`. `TriggerTiming` có giá trị 0–5 (273 node là 0), ý nghĩa **[CHƯA XÁC MINH]**.
- `maps/behaviors.json`: `{behaviors (124), categories}`; `BehaviorType` ∈ {2,3,4}.
- `maps/locations.json` (196, mỗi địa điểm có `BackgroundId`, ambience `Abient`), `maps/roles.json` (`roles` 14, `talks`, `spines`), `maps/attrs.json` (`attrs`, `params`, `avgFlags` 71 cờ).
- `maps/backgrounds.json`, `cgs.json`, `expressions.json`, `talkers.json`: bảng tham chiếu đầy đủ (không chỉ phần được dùng).

### 4.7 Điều kiện (`maps/conditions.json`, `maps/condition-types.json`)

`maps/conditions.json`: `{ "refs": {"<bảng>.<trường>": [id…]}, "conditions": { "<id>": Expr } }`; **410 ID được tham chiếu, 410 resolve** (không có ID thiếu). Mỗi `Expr` là cây:

```json
{ "id": 29000015, "src": "activity", "node": "group", "logic": "and",
  "items": [ { "id": 19000018, "src": "activity", "node": "cond", "type": 1, "typeName": "第二索拉属性区间",
               "gloss": "attribute in range", "params": { "Attr": "1", "Min": "850" } } ],
  "expr": "(第二索拉属性区间(Attr=1,Min=850) AND …)" }
```

- `node`: `group` (`logic`: `and`|`or`, `items` luôn là điều kiện) | `cond` (lá) | `missing`.
- `src`: `activity` (`ActivityCondition/*`, đa số) hoặc `main` (`condition/*`; lá có `type` là chuỗi như `SolarSchoolFlowRead`, `SolarSchoolEndingUnlocked`, `SolarSchoolBehaviorIdCount`, `CheckLevel`, kèm `need`).
- Tham số luôn là chuỗi (`"Min":"4"`); `Min`/`Max` là cận bao gồm, thiếu cận nào thì không giới hạn phía đó (suy từ `Max=0` + `Min=1` trong node 62–63; **[CHƯA XÁC MINH]** cho `Count`/`Need`).
- `expr` là chuỗi đọc được dùng để debug, không dùng để đánh giá.
- `maps/condition-types.json`: bảng 29 loại `第二索拉…` kèm tên khóa tham số được suy từ dữ liệu. Cột "dùng" cho biết loại có xuất hiện trong ID được tham chiếu:

| Type | Tên (zh) | Nghĩa (gloss, do build thêm) | Tham số | Dùng |
|---|---|---|---|---|
| 1 | 第二索拉属性区间 | attribute in range | Attr, Max, Min | ✓ |
| 2 | 第二索拉行为次数 | behavior count | BehaviorId, Count, OnlySuccess | ✓ |
| 3 | 第二索拉好感等级 | role favor level | Count, Max, Min, RoleId | ✓ |
| 4 | 第二索拉考试分数 | exam score | ExamId, Max, Min | ✓ |
| 5 | 第二索拉角色已解锁 | role unlocked | — |  |
| 6 | 第二索拉日期区间 | date in range | EndDay, EndMonth, StartDay, StartMonth | ✓ |
| 7 | 第二索拉日期已到达 | date reached | Day, IncludeSelf, Month | ✓ |
| 8 | 第二索拉特批状态 | special-request state | BehaviorId, State | ✓ |
| 9 | 第二索拉已完成特批数 | special requests completed | Count | ✓ |
| 10 | 第二索拉持有道具 | holds item | Count, ItemId | ✓ |
| 11 | 第二索拉周目数 | playthrough count | Max, Min | ✓ |
| 12 | 第二索拉地点已解锁 | location unlocked | LocationId | ✓ |
| 13 | 第二索拉当前星期 | current weekday | Weekdays | ✓ |
| 14 | 第二索拉当前所处地点 | current location | EndDay, EndMonth, LocationIds, StartDay, StartMonth | ✓ |
| 15 | 第二索拉AVG变量 | AVG variable | Key, Value | ✓ |
| 16 | 第二索拉当日副本 | today's instance | InstanceIds | ✓ |
| 17 | 第二索拉已选择结局 | ending chosen | EndingIds | ✓ |
| 19 | 第二索拉角色当前等级好感已满 | role current-level favor full | FavorLevel, RoleId | ✓ |
| 20 | 第二索拉疲劳状态 | fatigue state | Stages | ✓ |
| 21 | 第二索拉当前时段 | current time slot | TimeSlots | ✓ |
| 22 | 第二索拉行为已解锁 | behavior unlocked | BehaviorId, Count | ✓ |
| 23 | 第二索拉阵营等级 | faction level | InfluenceId, Level, Max, Min | ✓ |
| 24 | 第二索拉属性数量 | attribute count | Attr, Count | ✓ |
| 25 | 第二索拉商店购买数量 | shop purchase count | — |  |
| 26 | 第二索拉角色送礼次数 | role gift count | — |  |
| 27 | 第二索拉任务奖励领取 | quest reward claimed | Count, QuestId | ✓ |
| 28 | 第二索拉任务节点完成 | quest node completed | Count, QuestNodeId | ✓ |
| 29 | 第二索拉道具数量区间 | item count in range | ItemId, Max, Min | ✓ |
| 30 | 第二索拉结局已达成 | ending achieved | — |  |

**Nhóm có `Logic = 1` (OR)** là cơ chế "một trong các điều kiện", ví dụ điều kiện "giữ được trường" (4.5 mục 3). Ngữ nghĩa `Logic = 0` (AND) xác nhận qua các ending nhiều điều kiện (ending 1, 7, 8, 9).

**Giải nghĩa tham số thường gặp (đã đối chiếu bảng):**

| Khóa | Bảng tra |
|---|---|
| `RoleId` | `solarschoolrole`: 1 Changli, 2 Cartethyia, 3 Shorekeeper, 4 Roccia, 5 Galbrena, 6 Verina, 7 Buling, 8 Ciaccona, 9 Xiangli Yao, 10 Phoebe, 11 Chisa, 12 Abby |
| `InfluenceId` (loại 23) | `solarschoolinfluence`: 1 Student Council, 2 Club Association, 3 Liaison Center |
| `Attr` (loại 1, 24) | `solarschoolattr`: 1 Knowledge, 2 Thinking, 3 Aesthetics, 4 Physique, 5 Feeling, 6 Popularity, 7 Fatigue, 8 School Badges |
| `Key` (loại 15) | `solarschoolavgparam`: `key1…key71` ↔ `BitFlag` 1–71 |
| `ItemId` (loại 10, 29) | `solarschoolitem` (74 vật phẩm); trong đồ thị ending: 67, 73, 69 ("Handwritten Piano Score", mở nhánh Shorekeeper lượt 2) |

**Cờ AVG:** 71 cờ `key1…key71`. 15 cờ không bao giờ được ghi bởi option hay `PlotKeyId` trong kịch bản: `46, 51, 57, 58, 60, 62–71`, tức do logic game ngoài kịch bản ghi **[CHƯA XÁC MINH]**. Trong đó `key60` quan trọng vì mở khóa ending 1 và 7. Các cờ `key13/14/15` (true end) đều được ghi bởi option trong nhiều kịch bản (nhóm Cartethyia, Changli, Mở đầu, Câu lạc bộ, Kết thúc…).

## 5. Logic runtime

### 5.1 Chạy một kịch bản

Một `ScriptRunner` thuần (không React) với máy trạng thái:

```
load(scriptId) → dispatch flowActions theo thứ tự; talk → cursor = nid đầu của block
stepTalk():
  vào node: áp dụng stage phase start; khi rời node: stage phase end (qua StageEngine)
  nếu có chữ → emit Line(speaker, text, voice) và chờ người chơi
  nếu có options → emit Choice(options) và chờ chọn
  next: seq → nid tiếp trong block | jump → nid đích | end → kết thúc block ShowTalk
  hết block → dispatcher chạy flowAction kế; hết flowActions → emit Finished
```

- Nhảy theo `nid`, không theo chỉ số mảng. Option dùng `option.next`: `end` kết thúc ShowTalk hiện tại, `jump` đi tới nid, `seq` đi tiếp node; luôn lưu lựa chọn trước khi điều hướng. Không dùng `node.next` thay cho `option.next`. Nạp script phải dựng map `nid → index` và kiểm tra mọi `to` tồn tại. Đích không tồn tại thì ghi log và rơi xuống node kế.
- `ScriptRunner` không biết gì về DOM, âm thanh hay React. Nó chỉ phát sự kiện (`line`, `choice`, `stage`, `finished`).
- Phải có chế độ **headless** để test tự động chạy hết mọi nhánh.

### 5.2 Đồ thị truyện và mở khóa (T2)

- `StoryGraphRunner` duyệt `story-graph.json`: node loại 1 có `systemAction:false` → chạy `ScriptRunner` rồi sang `next`; node loại 1 có `systemAction:true` → gọi `SystemActionHandler[flowId]` (bảng 12 hành động ở 4.5; chưa có handler thì dừng và báo rõ, không bỏ qua im lặng); node loại 3 → kết thúc ending; node loại 4 → bắt đầu lượt mới (reset `PlayState` theo quy tắc lượt chơi); node loại 2 → `ConditionEvaluator(conditionId, playState)` → `true`/`false`.
- `ConditionEvaluator(conditionId, playState) → boolean` đánh giá cây `Expr` của `maps/conditions.json` (AND/OR đệ quy). Phải cài đủ các loại đang dùng (cột "dùng" ở 4.7, 25 loại activity + 4 loại main). Mỗi loại là một hàm thuần trên `PlayState`; loại chưa cài trả về `unsupported(type)` và **chế độ debug phải hỏi người dùng true/false hoặc dùng giá trị cấu hình**, tuyệt đối không âm thầm mặc định `true`.
- Ở T2 (chưa có mô phỏng) `PlayState` không có thuộc tính/vật phẩm/độ thân thiết thật, nên các loại cần số liệu mô phỏng (1, 2, 3, 4, 10, 23, 24, 29…) lấy từ **hồ sơ giả lập** do người dùng chỉnh trong màn Debug (thuộc tính 1–8, độ thân thiết từng nhân vật, cấp phe, vật phẩm, cờ AVG). Hai ending không điều kiện (4, 12) không cần hồ sơ.
- Các loại hệ thống/lượt chơi (loại 11 số lượt chơi, 17 ending đã chọn, 30 ending đã đạt) đọc từ `PlayState.endingsChosen/endingsAchieved/playthrough`.
- Thư viện kịch bản (sách đọc lại): có 2 cách xem — (a) theo nhóm (`group`), (b) theo thứ tự chơi (khi graph đủ).

### 5.3 `PlayState` và lưu trữ

```ts
type PlayState = {
  version: 1,
  locale: string, playerName: string, gender: 'male'|'female',
  flowsRead: string[],              // scriptId đã đọc (điều kiện SolarSchoolFlowRead)
  avgVars: Record<number, boolean>, // cờ AVG key<N> (N = BitFlag); option.optionId ghi cờ (4.2)
  endingsChosen: number[], endingsAchieved: number[], playthrough: number,
  profile: { attrs: Record<number, number>, favor: Record<number, number>, influence: Record<number, number>,
             items: Record<number, number> },   // T2: hồ sơ giả lập; T3: kết quả mô phỏng
  endingsUnlocked: number[],
  choices: { scriptId:string, nid:number, option:number }[],  // lịch sử chọn
  flags: Record<string, number|boolean>,                       // T3, xem solarschoolavgparam
  current: { scriptId?:string, nid?:number, graphNode?:number }
}
```

- Lưu vào `localStorage` có khóa version; có xuất/nhập file JSON.
- Save trong một kịch bản: `{scriptId, nid}` + `PlayState`; khôi phục bằng cách chạy lại từ node đầu ở chế độ nhanh đến `nid` (tái dựng stage), giống `reconstructStateAtStep` của VNreader nhưng dùng `nid`.
- `solarschoolavgparam.json` (71 mục: `Key`→`BitFlag`) là các cờ mà kịch bản đặt/đọc. **[CHƯA XÁC MINH]** cách kịch bản thực sự ghi cờ (có thể qua `ActivityAction`). Giai đoạn T1 để trống.

## 6. Asset resolver

Giao diện:

```ts
resolve(kind: 'bg'|'portrait'|'audio'|'fx', id: string, ctx?): AssetRef
// AssetRef = { url?: string, placeholder: PlaceholderSpec }
```

- Cấu hình bằng một file `asset-map.json` do người dùng cung cấp: `id → url`, và một `baseUrl`. Không có thì dùng placeholder.
- **Placeholder mặc định:** nền = màu đặc theo hash ID kèm nhãn `Description`; nhân vật = hình khối kèm tên và số biểu cảm; audio = im lặng (nhưng vẫn hiện tên cue ở debug overlay); fx = bỏ qua có log.
- Không lấy asset từ nguồn bên ngoài tự động. Việc cung cấp file (nếu có) là của chủ dự án.
- Debug overlay (bật bằng phím): hiện `scriptId`, `nid`, `textKey`, asset thiếu của node hiện tại.

## 7. Pipeline sinh dữ liệu (`tools/build_data.py`)

`build_data.py` đã được cài và chạy; nó thay thế `extract_solarschool_vn.py` và `solaris_to_vnreader.py` (hai bản nháp cũ chỉ để tham khảo).

```
python build_data.py <WutheringWaves_Data> <out_dir> [--locales en,ja] [--fallback en] [--no-validate]
```

Nguyên tắc: **idempotent**, chỉ đọc nguồn, mọi thao tác không nhận ra được ghi nhận thay vì làm lỗi (`unknown` op + đếm trong báo cáo).

**Validate (mặc định bật), kết quả lần chạy hiện tại (en,ja):**

| Kiểm tra | Kết quả |
|---|---|
| Số script / node | 429 / 8.493 |
| Lệnh nhảy trỏ tới `nid` không tồn tại | 0 |
| `solarschoolflow` resolve được sang `flowstate` | 426/426 |
| Node có chữ nhưng thiếu `textKey` | 0 |
| Op sân khấu không nhận ra | 0 |
| Ending có `FlowId` không hợp lệ | 0 (cả 12) |
| Node đồ thị là hành động hệ thống | 12 (4.5) |
| ID asset không có trong bảng tham chiếu | nền `800001` (1); CG, biểu cảm, talker: 0 |
| Khóa chữ thiếu | `en` 53, `ja` 54 (mẫu: `AVG_HAOGANDU2_3_29`, `Flow_226700001_2179`, `Flow_318000000_2422`…) |
| Speaker không có tên | `83` |
| Script chưa đăng ký | 3 (`后日谈_1_1`, `短信_1_1`, `考试_1_17`) |
| Số speaker / số khóa chữ dùng | 69 / 8.805 |
| Điều kiện tham chiếu / resolve được | 410 / 410 (không có ID thiếu) |

**`build-report.json`** gồm: `scripts`, `nodes`, `unregisteredScripts`, `textKeysUsed`, `missingTextKeys`, `missingTextKeySamples`, `unknownStageOps`, `kinds`, `speakers`, `conditions` (`resolved`, `referenced`, `missing`, `ambiguousIds`, `typesInUse`), `speakersWithoutName`, `activityActionIds` (`distinct`, `total`, `alsoFlowIds`, `note`) và `validation` (`danglingJumps`, `danglingJumpCount`, `nodesWithoutTextKey`, `nodesWithoutTextKeyCount`, `assetIdsMissingFromTables`, `flowRegistryResolved`, `endingFlowSystemActions`, `endingsWithBadFlow`).

**Điều kiện CI:** `danglingJumpCount == 0`, `flowRegistryResolved` đủ, `nodesWithoutTextKeyCount == 0`, `endingsWithBadFlow == []`, `unknownStageOps` rỗng, `conditions.missing` rỗng. Schema 2 còn yêu cầu `optionControlConflicts == []`; hành động cấp flow chưa hỗ trợ và thiếu bộ Spine SolarSchool phải được xem xét rõ trong nghiệm thu. Các mục còn lại (khóa thiếu, asset thiếu, script chưa đăng ký) là cảnh báo, và số lượng thay đổi so với bảng trên phải được xem xét.

**Dung lượng thực tế:** toàn bộ `data/` ≈ 7,9 MB (451 file) cho `en,ja`.

## 8. Giao diện

Yêu cầu chung: dark theme, responsive (desktop + mobile), hỗ trợ bàn phím (Space/Enter tiến, A auto, S skip, H history, Esc menu), có i18n cho giao diện.

| Màn hình | Nội dung |
|---|---|
| Title | Tiếp tục, Chương/Thư viện, Cài đặt, Gallery |
| Library | Danh sách script theo nhóm (`group`), tìm kiếm, đánh dấu đã đọc |
| Player | Nền, tối đa 3 slot nhân vật (làm mờ người không nói), hộp thoại, tên người nói, lựa chọn, auto/skip/history/save/load, hộp thoại narration và center-text riêng |
| History | Lịch sử thoại và lựa chọn, bấm để nhảy lại nếu đã được đọc |
| Gallery/Endings | 12 ending, trạng thái mở khóa, replay |
| Settings | Locale chữ, tốc độ chữ (`TextAnimSpeed = 25`), tốc độ skip, âm lượng 3 kênh (bgm/sfx/voice), tên người chơi, giới tính |
| Debug | Overlay (mục 6), chọn script bất kỳ, giải quyết điều kiện thủ công |

Thiết kế hình ảnh: **không** dùng nhận diện PGR. Chủ đề lấy từ bối cảnh học đường (xem 12 để chốt phong cách).

## 9. Chuyển từ VNreader

| Giữ (tham khảo logic) | Viết lại | Bỏ |
|---|---|---|
| Typing effect, auto/skip, history, bookmark, `richTextParser` | `VnPlayer.jsx` 1.692 dòng → tách thành `ScriptRunner` + `StageEngine` + `PlayerView` | `check_*.js`, `scrape_*.js`, `parse_*.js` ở thư mục gốc (script debug tạm), `wiki_db.json`, proxy `huaxu.app`, `audio_map.json`/`video_map.json` kiểu PGR, `LoreCodex` |

Lý do viết lại thay vì sửa: `VnPlayer` trộn parse `Params` chuỗi, tải asset PGR, state UI và logic nhảy trong một component; bản mới cần chạy headless và test được.

## 10. Phi chức năng

- **Hiệu năng:** nạp script theo yêu cầu (lazy), mỗi script < 1 MB; không nạp cả `MultiText` (~32 MB mỗi ngôn ngữ) ở client.
- **Kiểm thử:** (a) unit test `ScriptRunner` bằng headless, duyệt mọi nhánh của mọi script và khẳng định đến được `end`; (b) test parser placeholder; (c) snapshot cho `build-data`; (d) test `ConditionEvaluator` với điều kiện đã biết.
- **Công nghệ:** giữ React + Vite (đã có); TypeScript được khuyến nghị cho `data/` types và `ScriptRunner`.
- **Pháp lý:** dữ liệu và asset thuộc bản quyền Kuro Games. `data/` sinh ra và mọi asset **không được commit** vào repo công khai (đưa vào `.gitignore`), repo chỉ chứa code và pipeline. README phải ghi rõ đây là dự án phi thương mại, không liên kết với Kuro Games.

## 11. Cột mốc và tiêu chí nghiệm thu

| Mốc | Nghiệm thu |
|---|---|
| M1 — Data | **Đã đạt trên bản clone hiện tại:** `build_data.py` pass điều kiện CI ở mục 7 (429 script, 8.493 node, 426/426 flow). Cần chạy lại khi nguồn cập nhật |
| M2 — Runner | Headless duyệt hết nhánh cả 429 script không lỗi; mọi `to` hợp lệ |
| M3 — Player T1 | Đọc được một script bất kỳ với placeholder; lựa chọn rẽ nhánh đúng; save/load đúng `nid`; locale đổi được |
| M4 — Story Graph T2 | Duyệt `story-graph` từ node `IsStart` đến cả 12 ending ở chế độ debug; điều kiện chưa biết hỏi được |
| M5 — UI hoàn chỉnh | Đủ màn hình mục 8, mobile + desktop, phím tắt |
| M6 — Simulation T3 (tùy chọn) | Lịch/hành động/chỉ số chạy được tối thiểu một tuần |

## 12. Câu hỏi mở

**Đã giải quyết:**
- ~~`NodeType` 3 và 4 của đồ thị; ActionId hệ thống của đồ thị ending~~ (v0.2, mục 4.5).
- ~~Tra sprite theo `WhoId`~~: sprite đi qua biểu cảm → `AvgTalkerId` → Spine (v0.2, 4.2).
- ~~Điều kiện `29xxxxxx`, `25xxxxxx`, `22xxxxxx` ở đâu~~: nằm ở `ActivityCondition/*` (v0.3, 4.7); 410/410 resolve.
- ~~`EndingType`~~: 1 độc quyền, 2 chính/nghề nghiệp, 3 bạn đồng hành (v0.3, 4.5).
- ~~`optionId` là gì~~ (giả thuyết mạnh): số hiệu cờ AVG (v0.3, 4.2).

**Còn mở (cần chủ dự án quyết hoặc điều tra thêm):**
1. **Phạm vi:** dừng ở T2 hay làm cả T3 (mô phỏng)? Mặc định: T1–T2 bắt buộc, T3 sau. Lưu ý các điều kiện ending cần số liệu mô phỏng (thuộc tính, độ thân thiết, vật phẩm, cấp phe); ở T2 dùng hồ sơ giả lập (5.2).
2. **Thứ tự chơi thật** của các script giữa năm (`calendar` + `questnode` + `behavior`) chưa phân tích. Chấp nhận thư viện theo nhóm ở T1?
3. **12 hành động hệ thống:** logic chi tiết (đặc biệt 3001/3002 chọn ending, 3003 true end có phát flow 3030 không) chưa kiểm chứng; quan hệ giữa `FlowId` 3022–3029 trên trục thời gian và `FlowId` của ending nghề nghiệp chưa rõ (4.5).
4. **Cờ AVG:** `PlotKeyId` có phải cờ "điểm cốt truyện" không; 15 cờ không được ghi trong kịch bản (`key60`…) do đâu ghi.
5. **`ActivityAction`:** 257/284 ID không phải flow (ví dụ `5912`, `1107–1116`, `3501–3512`, `5901–5903`) thuộc bảng nào, ảnh hưởng gì tới truyện; `TriggerTiming` (0–5) chưa rõ; ngữ nghĩa `Relation` của `condition/conditiongroup` chính (giá trị 0, 1, 10) chưa kiểm chứng.
6. **Ngôn ngữ:** hỗ trợ ngoài `en`/`ja` không? Bản `vi` trong repo rỗng, nên tiếng Việt cần dịch riêng nếu muốn.
7. **Asset:** dùng placeholder mãi, hay có nguồn asset hợp pháp nạp qua `asset-map.json`? Có cần hỗ trợ Spine không?
8. **Phong cách giao diện:** theo bối cảnh học đường Solaris (đề xuất) hay tối giản trung tính?
9. **Giới tính nhân vật chính:** icon ending (`IconMale`/`IconFemale`), CG (`PicPathMaleVariant`) và chuỗi `{Male=..;Female=..}` phân theo giới tính. Cho người chơi chọn hay cố định?

## Phụ lục A — Thay đổi

**v0.3 (so với v0.2):**
- Giải mã điều kiện: `ActivityCondition/*` (4.7), thêm `maps/conditions.json`, `maps/condition-types.json`, `conditionExpr` cho `endings.json` và `story-graph.json`; 410/410 điều kiện resolve.
- 4.5: bảng 12 ending (tên, loại, điều kiện), `EndingType` đã giải mã, đồ thị ending mô tả theo 7 khối, các điểm chưa khớp.
- 4.2: `optionId` = số hiệu cờ AVG (giả thuyết mạnh); 5.2: `ConditionEvaluator` và hồ sơ giả lập; `PlayState` thêm `avgVars`, `endings*`, `playthrough`, `profile`.
- Mục 7 và 12 cập nhật.

**v0.2 (so với v0.1):**
- 4.x viết lại theo định dạng thực tế do `build_data.py` xuất (trường `style`, `speakerId` dạng chuỗi, op sân khấu cụ thể, `raw`, `actions`).
- Thêm: `to:null` của option, chân dung Spine, `ActivityAction`, 12 hành động hệ thống, ý nghĩa node 3/4, phân loại cue âm thanh.
- Mục 7: CLI, bảng kết quả validate, cấu trúc `build-report.json`, điều kiện CI.


## Phụ lục B — v0.4: mapping SolarSchool, option control flow và video

### B.1 Định danh sự kiện và mapping nhân vật

Dữ liệu tiếng Anh xác nhận `Activity_111700001_Title` = **Second Coming of Solaris: Unwritten Dreams**; `Activity_109700001_Title` = **Second Coming of Solaris: Collab Season** (ảnh tham chiếu người dùng). Hai sự kiện khác nhau. Tiếp tục lọc script `索拉学院` và dùng activity `111700001`.

Manifest schema 2 thêm `activityId` và `titleKey`; khóa tên sự kiện được xuất vào locale, tăng số khóa dùng lên 8.805. Engine cần kiểm tra schema; không dùng engine schema 1 đọc schema 2 mà bỏ qua trường mới.

`assets.manifest.talkers[id]` giữ tên trường đầu ra `spineAtlas`/`spineSkeleton`, nhưng giá trị phải lấy từ `SolarSchoolSpineAtlas`/`SolarSchoolSpineSkeletonData`. Thêm `spineSource:"SolarSchool"`, `portraitTexture`, `portraitTransform`, `headIconTransform`, `defaultExpressionId`. Không tự fallback sang Spine chung: với 850001, Spine chung trỏ tới Activity33/CatapultStory. Thiếu bộ SolarSchool thì dùng placeholder và báo `talkersWithoutSolarSchoolSpine`. Cả 13 talker hiện dùng có đủ hai đường dẫn SolarSchool; đây chưa phải xác nhận có file binary.

### B.2 Hợp đồng engine cho FinishTalk

1. Hiển thị lựa chọn và chờ chọn; ghi lịch sử lựa chọn một lần.
2. Thực thi side effect được hỗ trợ một lần; xử lý stage kết thúc node đúng phase.
3. Dùng `option.next`, không rơi xuống `node.next` sau khi người dùng đã chọn.
4. `end` kết thúc **ShowTalk hiện tại**. Flow dispatcher chạy action kế tiếp trong `flowActions`; chỉ phát script-finished sau khi hết flow. Không chạy node kế trong cùng ShowTalk.
5. Với `seq`, đi node tiếp trong danh sách nid của ShowTalk; với `jump`, tìm đúng nid trong block. Đích ngoài block/chưa hỗ trợ phải báo rõ thay vì đọc nhầm block khác.
6. Dữ liệu schema 1 cần adapter kiểm tra `actions.FinishTalk` trước `to`; không được mặc định mọi `to:null` thành seq.

Ca hồi quy bắt buộc: script `17048`, node `2`, optionId `5`, textKey `AVG_BLLTFT_1_6`: next=end, không phát node 3. Option không có FinishTalk và không JumpTalk vẫn next=seq; JumpTalk vẫn nhảy đúng nid. Báo cáo mới có `optionNextKinds` và `optionControlConflicts`.

### B.3 Action cấp flow và video

Mỗi script thêm `flowActions`, giữ đúng thứ tự action gốc:

- `configure`: config trung lập tại vị trí SetPlotMode và raw để chẩn đoán. `script.config` chỉ là dữ liệu tiện tra; dispatcher không áp dụng hai lần.
- `talk`: danh sách `nids` của một ShowTalk, tham chiếu `nodes` trong script.
- `movie`: `videoName` và raw PlayMovie, bao gồm Mp4FrameEvents. Chưa có URL video hay runtime phát movie.
- `unsupported`: raw action chưa có handler; phải báo rõ/dừng debug hoặc cho người đọc xác nhận bỏ qua, không âm thầm xóa.

Script `1053` có `nodes:[]` nhưng có movie `VideoSolarSchoolOP01`, không được coi là script hoàn tất ngay. Engine phát movie, chờ completed/skip theo chính sách đã chọn rồi mới sang action tiếp. Nếu thiếu media, hiển thị trạng thái thiếu video và nút tiếp tục có chủ ý. Khôi phục save trong movie cần lưu flowActionIndex và thời điểm media; không dùng nid cho vị trí không có thoại.

Tra `BinData/cgVedio/videodata.json`: CgId 506/507 cùng tên VideoSolarSchoolOP01 và đường dẫn UE `/Game/Aki/UI/UIResources/UiActivity/Mp4/Activity38/SolarSchool/VideoSolarSchoolOP01.VideoSolarSchoolOP01`; CanSkip=false, Aspect=2.38. Đây là asset reference, không phải URL tải MP4. Muốn phát phải tìm asset trong client và theo media source tới payload thật. Raw PlayMovie có cue `play_avg_music_3_8_video_p01` ở giây 0; phải kiểm tra video có sẵn audio không để tránh phát trùng.

Báo cáo thêm `movieActions`, `scriptsWithoutTalkNodes`, `unsupportedFlowActions`; chúng tách biệt với `unknownStageOps`. Còn 7 loại action chưa hỗ trợ, tổng 8 lần ở hậu nhật đàm. Bản cập nhật giữ chúng để điều tra, không tuyên bố engine đã phát được.

### B.4 Nguồn skeleton và trình tự xuất asset

Đường dẫn package của Changli lấy từ bảng talker:
`/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Changli/SolarSchool_Changli`

Object atlas là `SolarSchool_Changli-atlas`, object skeleton là `SolarSchool_Changli-data`. Các suffix này là object name trong UE, không phải bảo đảm tồn tại file .atlas/.skel độc lập bên ngoài package.

Trong client chứa dữ liệu sự kiện 3.8, dùng FModel đã mount được archive để tìm package trên; xuất dữ liệu Spine/atlas dưới dạng JSON cùng texture gốc. Hướng dẫn [RealNath/wuwa-live2d-viewer](https://github.com/RealNath/wuwa-live2d-viewer) cung cấp bộ tách JSON export sang atlas/skel; lệnh hiện trong README là `python extract.py -f <JSON_NAME>` (script ở src/). Cần kiểm tra định dạng JSON SolarSchool thực tế có khớp script trước khi dùng. Sau đó mở bằng [SpineViewer](https://github.com/ww-rm/SpineViewer), kiểm tra animation và có thể render chân dung tĩnh để dùng cho T1.

WebP đơn lẻ không chứa đủ topology xương, mesh weights và animation để khôi phục chính xác skeleton gốc. Atlas page phải khớp kích thước texture, và Spine runtime phải tương thích phiên bản dữ liệu. Không thay PNG bằng WebP rồi giữ nguyên tên file trong atlas; phải đồng bộ page name/loader. Phiên này chưa có archive client, chưa trích xuất hay chạy thử skeleton/video thực tế.
