#!/usr/bin/env python3
"""
build_data.py - Solaris School ("Second Coming of Solaris: Unwritten Dreams") data builder.

Reads a local clone of Arikatsu/WutheringWaves_Data and writes the engine-neutral data set
described in SPEC.md (section 4 / 7).

    python build_data.py <WutheringWaves_Data> <out_dir> [--locales en,ja] [--fallback en]
                         [--no-validate]

Output (<out_dir>):
    manifest.json
    scripts.index.json            list of scripts (id, group, node count)
    scripts/<id>.json             one script per flowState entry (structure only, text = keys)
    locales/<lang>.json           textKey -> string, ONLY keys referenced by the data set
    speakers.json                 WhoId -> {nameKey, talkerId, ...}
    maps/flow-registry.json       solarschoolflow.Id -> stateKey / group (the "ActionId" map)
    maps/story-graph.json         ending flow graph (solarschoolendingflow, 74 nodes)
    maps/endings.json             12 endings (solarschoolending)
    maps/quest-nodes.json         quest nodes (335) + quests (147)
    maps/calendar.json            calendar (285 days), time slots, date periods
    maps/behaviors.json           behaviors (124) + categories
    maps/locations.json           locations (196) -> BackgroundId
    maps/roles.json               roles (14), role talks, role spines
    maps/attrs.json               attributes + params (TiredThreshold, TotalDays, ...)
    maps/quizzes.json             exam questions, answers, action joins and raw result metadata
    maps/backgrounds.json         AvgBackground id -> description / day / night asset path
    maps/cgs.json                 AvgCg id -> description / asset path (male/female variants)
    maps/expressions.json         expression id -> AvgSolarSchoolRoleAnimation (talker + animation names)
    maps/talkers.json             AvgTalkerConfig id -> name / spine / interjections
    maps/audio.json               every audio cue used + where (bgm / sfx / voice / ambience)
    assets.manifest.json          logical asset ids -> UE asset paths (NO files, just ids/paths)
    assets.usage.json             per script: backgrounds, cgs, quizzes, talkers, expressions, audio, fx
    build-report.json             counts + validation results

The generated data contains copyrighted game text. Do NOT commit it to a public repo.
"""
import argparse, collections, glob, json, os, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("root"); ap.add_argument("out")
ap.add_argument("--locales", default="en,ja")
ap.add_argument("--fallback", default="", help="locale used when a source key is absent; explicit empty strings remain empty")
ap.add_argument("--no-validate", action="store_true")
args = ap.parse_args()
ROOT, OUT = args.root, args.out
LOCALES = [x.strip() for x in args.locales.split(",") if x.strip()]
FALLBACK = args.fallback.strip()
ACT = 111700001

def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf8") as f:
        return json.load(f)

def tryload(rel, default=None):
    try: return load(rel)
    except Exception: return default if default is not None else []

def write(rel, obj, indent=None):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)

def cue(path):
    """'/Game/Aki/WwiseAudio/Events/play_x.play_x' -> 'play_x'"""
    if not isinstance(path, str): return None
    return path.rsplit("/", 1)[-1].split(".")[0]

def find_cues(obj, acc):
    """collect every Wwise event referenced anywhere inside obj"""
    if isinstance(obj, dict):
        for v in obj.values(): find_cues(v, acc)
    elif isinstance(obj, list):
        for v in obj: find_cues(v, acc)
    elif isinstance(obj, str) and "WwiseAudio/Events/" in obj:
        acc.append(cue(obj))

# ---------------------------------------------------------------- text tables
texts = {}
source_texts = {}
for lg in LOCALES:
    d = {}
    source_texts[lg] = {}
    for x in load(f"Textmaps/{lg}/multi_text/MultiText.json"):
        source_texts[lg][x["Id"]] = x["Content"]
        if x["Content"].strip(): d[x["Id"]] = x["Content"]
    texts[lg] = d
fb = {}
if FALLBACK:
    if FALLBACK in texts: fb = texts[FALLBACK]
    else:
        for x in load(f"Textmaps/{FALLBACK}/multi_text/MultiText.json"):
            if x["Content"].strip(): fb[x["Id"]] = x["Content"]

used_keys = set()          # every textKey referenced by the output
def tk(key):
    if key: used_keys.add(key)
    return key or None

ACT_TITLE_KEY = tk(f"Activity_{ACT}_Title")
# The original favor confirmation resolves these four keys by tier number;
# they are not literal values in the role-favor config rows.
for favor_tier in range(1, 5):
    tk(f"SolarSchool_humanitiesClassFavor_{favor_tier}")

def exists_anywhere(key):
    return any(key in texts[lg] for lg in LOCALES) or key in fb

def collect_text_keys(row):
    """walk a passthrough row and register every string value that is a known text key"""
    if isinstance(row, dict):
        for v in row.values(): collect_text_keys(v)
    elif isinstance(row, list):
        for v in row: collect_text_keys(v)
    elif isinstance(row, str) and row and exists_anywhere(row):
        used_keys.add(row)

# ---------------------------------------------------------------- reference tables
bg_tbl   = {r["Id"]: r for r in load("BinData/AvgBackground/avgbackground.json")}
cg_tbl   = {r["Id"]: r for r in load("BinData/AvgCg/avgcg.json")}
expr_tbl = {r["Id"]: r for r in load("BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json")}
talk_tbl = {r["Id"]: r for r in load("BinData/AvgTalkerConfig/avgtalkerconfig.json")}
speaker_tbl = {r["Id"]: r for r in load("BinData/speaker/speaker.json")}
sflow    = load("BinData/SolarSchool/solarschoolflow.json")
sflow_id = {r["Id"]: r for r in sflow}
flow_by_key = {f'{r["FlowListName"]}_{r["FlowId"]}_{r["StateId"]}': r for r in sflow}

# Exam interactions are ActivityAction type 8, not TalkItem.Options. Join only
# the explicit action Id parameter, question ChoiceGroupId and answer GroupId.
exam_questions = tryload("BinData/SolarSchool/solarschoolexamevent.json")
exam_answers = tryload("BinData/SolarSchool/solarschoolexamchoice.json")
exam_params = tryload("BinData/SolarSchool/solarschoolparam.json")
action_types = {r["Id"]: r for r in tryload("BinData/ActivityAction/activityactionclienttype.json")}
quiz_type_ids = {r["Id"] for r in action_types.values() if r.get("TypeName") == "第二索拉考试选项"}
quiz_actions = [r for r in tryload("BinData/ActivityAction/activityaction.json") if r.get("ActionType") in quiz_type_ids]
quiz_by_action, unresolved_quiz_actions = {}, []
result_params = [r for r in exam_params if r.get("Key") == "ExamResultHoldDuration"
                 or "ChoiceCorrectSpineIdList" in r.get("Key", "") or "ChoiceFailSpineIdList" in r.get("Key", "")]
result_hold = next((r.get("IntValue") for r in exam_params if r.get("Key") == "ExamResultHoldDuration"), None)
for question in exam_questions:  # retain table order, including IDs 3/6 near its end
    for action in quiz_actions:
        references = [p.get("Value") for p in action.get("ActionParams", []) if p.get("Key") == "Id"]
        if references != [str(question["Id"])]:
            continue
        quiz_by_action[action["Id"]] = {
            "id": question["Id"], "actionId": action["Id"],
            "titleKey": tk(question.get("Title")), "questionKey": tk(question.get("Desc")),
            "illustration": question.get("Image") or None,
            "answers": [{"id": answer["Id"], "textKey": tk(answer.get("TextKey")),
                         "correct": answer.get("IsCorrect") if isinstance(answer.get("IsCorrect"), bool) else None,
                         "raw": answer} for answer in exam_answers if answer.get("GroupId") == question.get("ChoiceGroupId")],
            "addScore": question.get("AddScore"), "resultHoldMs": result_hold,
            "raw": {"question": question, "action": action, "actionType": action_types[action["ActionType"]],
                    "resultParameters": result_params},
        }
unresolved_quiz_actions = [r for r in quiz_actions if r["Id"] not in quiz_by_action]

# ---------------------------------------------------------------- speakers
def speaker_key(who):
    k = f"Speaker_{who}_Name"
    return k if exists_anywhere(k) else None

speakers = {}
def speaker_talker(who):
    """WhoId selects a speaker row; only its explicit config selects a talker."""
    return (speaker_tbl.get(who) or {}).get("AvgTalkerConfig") or None

def speaker(who):
    if not who: return None
    w = str(who)
    if w not in speakers:
        key = speaker_key(who)
        if key: used_keys.add(key)
        speakers[w] = {"nameKey": key, "talkerId": speaker_talker(who),
                       "nameZh": None}  # Keep name snapshots tied to the original speaker text key.
    return w

# ---------------------------------------------------------------- stage ops
usage_unknown = collections.Counter()
unsupported_flow_actions = collections.Counter()
option_control_conflicts = []

def option_next(actions, context):
    """Normalize choice control flow; FinishTalk is terminal, even with no JumpTalk."""
    controls = [a for a in actions if a.get("Name") in ("JumpTalk", "FinishTalk")]
    if len(controls) > 1:
        option_control_conflicts.append({"scriptId": context[0], "nid": context[1],
                                         "optionIndex": context[2], "actions": controls})
    if any(a["Name"] == "FinishTalk" for a in controls):
        return {"type": "end"}
    jumps = [a for a in controls if a["Name"] == "JumpTalk"]
    if jumps:
        return {"type": "jump", "to": jumps[-1]["Params"].get("TalkId")}
    return {"type": "seq"}

def solar_talker_asset(row):
    """Never silently reuse another event's generic Spine for SolarSchool."""
    return {"name": row.get("Name"), "spineSource": "SolarSchool",
            "spineAtlas": row.get("SolarSchoolSpineAtlas") or None,
            "spineSkeleton": row.get("SolarSchoolSpineSkeletonData") or None,
            "portraitTexture": row.get("SolarSchoolPortraitTexture") or None,
            "portraitTransform": row.get("SolarSchoolPortraitTransform"),
            "headIconTransform": row.get("SolarSchoolHeadIconTransform"),
            "defaultExpressionId": row.get("SolarSchoolDefaultExpressionId")}

def tr(t):
    return None if not t else [t.get("PosX", 0), t.get("PosY", 0), t.get("Scale", 1)]

def talk_item_role_op(item):
    """Apply authored node patches before its timed performances, without Enter."""
    who, rc = item.get("WhoId"), item.get("RoleConfig")
    if not who or not isinstance(rc, dict): return None
    fields = {dst: rc[src] for src, dst in (("Expression", "expr"),
              ("HidePortrait", "hidePortrait"), ("HideAvatar", "hideAvatar"),
              ("VisualEffect", "effect")) if src in rc}
    if not fields: return None
    return {"t": 0, "op": "modify", "who": speaker(who),
            "origin": "talk-item-role-config", "raw": rc, **fields}

def stage_ops(perfs, phase):
    ops = []
    for p in perfs or []:
        ty = p.get("Type"); o = {"t": p.get("StartTime", 0)}
        if phase == "end": o["phase"] = "end"
        if phase == "option":
            o["phase"] = "option"
            o["raw"] = p
        rc = p.get("RoleConfig") or {}
        who = p.get("WhoId")
        if ty in ("Enter", "Exit", "Move", "ModifyRole"):
            o["op"] = {"Enter": "enter", "Exit": "exit", "Move": "move", "ModifyRole": "modify"}[ty]
            o["who"] = speaker(who)
            if "Expression" in rc: o["expr"] = rc["Expression"]
            for src, dst in (("HidePortrait", "hidePortrait"), ("HideAvatar", "hideAvatar"),
                             ("VisualEffect", "effect")):
                if src in rc: o[dst] = rc[src]
            if p.get("Transform"): o["pos"] = tr(p["Transform"])
            for src, dst in (("Duration", "dur"), ("FadeInTime", "fadeIn"), ("FadeOutTime", "fadeOut")):
                if src in p: o[dst] = p[src]
            if "EaseCurve" in p: o["ease"] = p["EaseCurve"]  # preserve presets; do not infer curve semantics
        elif ty == "SendAudioEvent":
            o["op"] = "audio"; o["cue"] = cue(p.get("AudioEvent"))
            for src, dst in (("SkipOnUltraFastForward", "skipOnUltraFastForward"),
                             ("IsNotCountTimeAndNotInterrupted", "notCountTimeAndNotInterrupted")):
                if src in p: o[dst] = p[src]
        elif ty == "PortraitEffect":
            o["op"] = "portraitFx"; o["who"] = speaker(who)
            o["fx"] = p.get("EffectType"); o["amp"] = p.get("Amplitude")
            # Motion presets and any future source parameters must survive
            # normalization. They belong to the authored actor, not its voice.
            o["raw"] = p
        elif ty in ("PlayScreenEffect", "StopScreenEffect"):
            ec = p.get("EffectConfig") or {}
            o["op"] = "screenFx" if ty == "PlayScreenEffect" else "stopScreenFx"
            # Each effect family has its own selector. Keeping only the
            # Persistent path loses every OneShot asset and Custom behavior.
            path_field = {"Persistent": "PersistentEffectPath", "OneShot": "OneShotEffectPath"}.get(ec.get("Type"))
            path = ec.get(path_field) if path_field else None
            o["fx"] = cue(path) or ec.get("CustomType") or ec.get("Type")
            o["fxType"] = ec.get("Type"); o["path"] = path
            if "CustomType" in ec: o["customType"] = ec["CustomType"]
            for field, normalized in (("PersistentEffectPath", "persistentEffectPath"),
                                      ("OneShotEffectPath", "oneShotEffectPath")):
                if field in ec: o[normalized] = ec[field]
            if who is not None: o["who"] = speaker(who)
            o["effectConfig"] = ec
            o["raw"] = p
        elif ty == "CgMove":
            o["op"] = "cgMove"; o["from"] = tr(p.get("StartTransform")); o["to"] = tr(p.get("TargetTransform"))
            o["dur"] = p.get("Duration"); o["ease"] = p.get("EaseCurve")
        elif ty == "EnterBlackScreen":
            o["op"] = "blackIn"; o["fade"] = p.get("FadeInTime"); o["screen"] = p.get("ScreenType")
        elif ty == "LeaveBlackScreen":
            o["op"] = "blackOut"; o["fade"] = p.get("FadeOutTime")
        elif ty == "RoleIntroduction":
            c = p.get("RoleIntroductionConfig") or {}
            o["op"] = "roleIntro"; o["introId"] = c.get("IntroductionId"); o["dur"] = c.get("Duration")
        elif ty == "ActivityAction":
            c = p.get("ActivityActionConfig") or {}
            o["op"] = "activityAction"; o["kind"] = c.get("Type"); o["actionId"] = c.get("SolarSchoolActionId")
            if c.get("Type") == "SolarSchool" and c.get("SolarSchoolActionId") in quiz_by_action:
                o["quiz"] = quiz_by_action[c["SolarSchoolActionId"]]
                o["raw"] = p
        else:
            usage_unknown[ty] += 1
            o["op"] = "unknown"; o["type"] = ty; o["raw"] = p
        ops.append(o)
    return ops

# ---------------------------------------------------------------- scripts
KIND = {"VisualNovelTalk": "line", "Talk": "line", "VisualNovelNarration": "narration",
        "VisualNovelCenterText": "centerText", "VisualNovelNoTextItem": "silent",
        "VisualNovelOption": "option"}
RAW_KEYS = ("WaitTime", "DialogDelay", "Interjection", "PlotKeyId", "PlotLineKey", "PlotLineId",
            "OptionGroup", "OptionInteractionType", "CameraMotion", "Style", "ClickShowFull",
            "ActorMontageArray", "ActorFaceExpressionArray", "ActorTurnToArray", "ActorLookAtArray",
            "FlowTemplateList", "TextId", "Name", "RoleConfig")

def group_of(state_key):
    return state_key.rsplit("_", 2)[0].replace("剧情_3.8", "")

flowstate = [f for f in load("BinData/flowState/flowstate.json") if "索拉学院" in f.get("StateKey", "")]
flowstate.sort(key=lambda f: (flow_by_key[f["StateKey"]]["Id"] if f["StateKey"] in flow_by_key else 10**9, f["StateKey"]))

scripts, usage, unreg = {}, {}, []
audio_where = collections.defaultdict(lambda: {"kind": set(), "scripts": set()})
used_bg, used_cg, used_expr, used_talker = set(), set(), set(), set()
used_quizzes = set()
activity_actions = collections.Counter()

for n, f in enumerate(flowstate):
    reg = flow_by_key.get(f["StateKey"])
    sid = str(reg["Id"]) if reg else f"x{len(unreg) + 1}"
    if not reg: unreg.append(f["StateKey"])
    acts = json.loads(f["Actions"]) if f["Actions"] else []
    cfg, items, flow_actions = {}, [], []
    for a in acts:
        if a["Name"] == "SetPlotMode":
            vn = (a["Params"].get("VisualNovelConfig") or {})
            cfg = {"initialBackground": vn.get("InitialBackgroundId"),
                   "initialAudio": [cue(x) for x in vn.get("InitialAudioEvents", [])],
                   "subtype": vn.get("VisualNovelSubType")}
            flow_actions.append({"op": "configure", "config": dict(cfg), "raw": a})
        elif a["Name"] == "ShowTalk":
            items += a["Params"].get("TalkItems", [])
            flow_actions.append({"op": "talk", "nids": [it["Id"] for it in a["Params"].get("TalkItems", [])]})
        elif a["Name"] == "PlayMovie":
            flow_actions.append({"op": "movie", "videoName": a["Params"].get("VideoName"), "raw": a})
        else:
            unsupported_flow_actions[a["Name"]] += 1
            flow_actions.append({"op": "unsupported", "raw": a})

    u = {"bg": set(), "cg": set(), "talker": set(), "expr": set(), "audio": set(), "fx": set(), "voice": set()}
    if cfg.get("initialBackground"): u["bg"].add(cfg["initialBackground"])
    for c in cfg.get("initialAudio") or []:
        if c: u["audio"].add(c); audio_where[c]["kind"].add("bgm"); audio_where[c]["scripts"].add(sid)

    nodes = []
    ids = {it["Id"] for it in items}
    for it in items:
        ty = it.get("Type")
        node = {"nid": it["Id"], "kind": KIND.get(ty, "line"), "style": ty}
        who = it.get("WhoId")
        node["speakerId"] = speaker(who)
        node["textKey"] = tk(it.get("TidTalk"))
        # stage
        role_op = talk_item_role_op(it)
        stage = ([role_op] if role_op else []) + stage_ops(it.get("StartPerformances"), "start") + stage_ops(it.get("EndPerformances"), "end")
        if it.get("VisualNovelBackgroundConfig"):
            b = it["VisualNovelBackgroundConfig"]; stage.append({"t": 0, "op": "bg", "id": b.get("BackgroundId"), "mode": b.get("Type"), "raw": b})
        if it.get("CgConfig"):
            c = it["CgConfig"]; stage.append({"t": 0, "op": "cg", "id": c.get("ImageId"), "mode": c.get("Type"), "raw": c})
        node["stage"] = stage
        # voice / audio
        v = []; find_cues(it.get("PlayVoice"), v); find_cues(it.get("TalkAkEvent"), v)
        if v: node["voice"] = v[0] if len(v) == 1 else v
        # options
        if it.get("Options"):
            node["options"] = []
            for oi, o in enumerate(it["Options"]):
                to, extra = None, []
                for ac in o.get("Actions") or []:
                    if ac["Name"] == "JumpTalk": to = ac["Params"].get("TalkId")
                    elif ac["Name"] != "FinishTalk": extra.append(ac)
                params = o.get("TypeParams") or {}
                option = {"textKey": tk(o.get("TidTalkOption")), "to": to,
                                        "next": option_next(o.get("Actions") or [], (sid, it["Id"], oi)),
                                        "optionId": params.get("PlotOptionId"), "raw": o,
                                        **({"actions": extra} if extra else {})}
                if "PreCondition" in o:
                    option["preCondition"] = o["PreCondition"]
                    collect_text_keys(o["PreCondition"])
                if "TypeParams" in o: option["typeParams"] = o["TypeParams"]
                if "OptionPerformances" in params:
                    option["performances"] = stage_ops(params["OptionPerformances"], "option")
                node["options"].append(option)
        # next
        nxt, extra_actions = {"type": "seq"}, []
        for ac in it.get("Actions") or []:
            if ac["Name"] == "JumpTalk": nxt = {"type": "jump", "to": ac["Params"].get("TalkId")}
            elif ac["Name"] == "FinishTalk": nxt = {"type": "end"}
            else: extra_actions.append(ac)
        node["next"] = nxt
        if extra_actions: node["actions"] = extra_actions
        raw = {k: it[k] for k in RAW_KEYS if k in it}
        if raw: node["raw"] = raw
        nodes.append(node)

        # usage bookkeeping
        if speaker_talker(who): u["talker"].add(speaker_talker(who))
        for s in stage + [p for o in node.get("options", []) for p in o.get("performances", [])]:
            op = s["op"]
            if s.get("who"):
                tid = speaker_talker(int(s["who"]))
                if tid: u["talker"].add(tid)
            if op == "bg" and s.get("id"): u["bg"].add(s["id"])
            if op == "cg" and s.get("id"): u["cg"].add(s["id"])
            if s.get("expr"):
                u["expr"].add(s["expr"])
                tid = (expr_tbl.get(s["expr"]) or {}).get("AvgTalkerId")
                if tid: u["talker"].add(tid)
            if op == "audio" and s.get("cue"):
                u["audio"].add(s["cue"]); audio_where[s["cue"]]["scripts"].add(sid)
                audio_where[s["cue"]]["kind"].add("bgm" if "music" in s["cue"] else "amb" if s["cue"].startswith("play_amb") else "sfx")
            if op in ("screenFx", "stopScreenFx") and s.get("fx"): u["fx"].add(s["fx"])
            if op == "activityAction" and s.get("actionId") is not None: activity_actions[s["actionId"]] += 1
            if s.get("quiz"):
                u.setdefault("quiz", set()).add(s["quiz"]["id"])
        for c in ([node["voice"]] if isinstance(node.get("voice"), str) else node.get("voice", [])):
            u["voice"].add(c); audio_where[c]["kind"].add("voice"); audio_where[c]["scripts"].add(sid)

    used_bg |= u["bg"]; used_cg |= u["cg"]; used_expr |= u["expr"]; used_talker |= u["talker"]
    used_quizzes |= u.get("quiz", set())
    scripts[sid] = {"id": sid if not sid.startswith("x") else sid, "stateKey": f["StateKey"],
                    "group": group_of(f["StateKey"]), "needSave": bool(reg and reg.get("NeedSave")),
                    "registered": bool(reg), "config": cfg, "flowActions": flow_actions, "nodes": nodes}
    usage[sid] = {k: sorted(v, key=str) for k, v in u.items()}

# ---------------------------------------------------------------- map tables (passthrough)
def rows(rel): return tryload(rel, [])
def passthrough(name, obj):
    collect_text_keys(obj); return obj

endings    = rows("BinData/SolarSchool/solarschoolending.json")
endflow    = rows("BinData/SolarSchool/solarschoolendingflow.json")
quests     = rows("BinData/SolarSchool/solarschoolquest.json")
qnodes     = rows("BinData/SolarSchool/solarschoolquestnode.json")
calendar   = rows("BinData/SolarSchool/solarschoolcalendar.json")
timeslots  = rows("BinData/SolarSchool/solarschooltimeslot.json")
periods    = rows("BinData/SolarSchool/solarschooldateperiod.json")
behaviors  = rows("BinData/SolarSchool/solarschoolbehavior.json")
bcat       = rows("BinData/SolarSchool/solarschoolbehaviorcategory.json")
locations  = rows("BinData/SolarSchool/solarschoollocation.json")
roles      = rows("BinData/SolarSchool/solarschoolrole.json")
roletalk   = rows("BinData/SolarSchool/solarschoolroletalk.json")
rolespine  = rows("BinData/SolarSchool/solarschoolrolespine.json")
attrs      = rows("BinData/SolarSchool/solarschoolattr.json")
params     = rows("BinData/SolarSchool/solarschoolparam.json")
avgparam   = rows("BinData/SolarSchool/solarschoolavgparam.json")

# Table expressions reference additional authored forms, including the two
# player choice variants. Keep these separate from per-script usage.
script_expr, script_talkers = set(used_expr), set(used_talker)
configuration_expr = {r["AnimationId"] for r in rolespine if r.get("AnimationId")}
configuration_talkers = {expr_tbl[i]["AvgTalkerId"] for i in configuration_expr if i in expr_tbl}
configuration_talkers.update(tid for r in roles if (tid := speaker_talker(r.get("SpeakerId"))))
required_talkers = script_talkers | configuration_talkers
default_expressions = {tid: (talk_tbl.get(tid) or {}).get("SolarSchoolDefaultExpressionId") or None
                       for tid in required_talkers}
configuration_expr.update(i for i in default_expressions.values() if i)
# A configured female player resource has its own nine source compositions;
# this catalog does not substitute them into literal male script expressions.
female_talkers = {expr_tbl[i]["AvgTalkerId"] for i in configuration_expr if i in expr_tbl
                 and (talk_tbl.get(expr_tbl[i]["AvgTalkerId"]) or {}).get("Name", "").startswith("女{PlayerName}")}
configuration_expr.update(i for i, r in expr_tbl.items() if r.get("AvgTalkerId") in female_talkers)
used_expr |= configuration_expr
used_talker |= required_talkers

for tbl in (endings, quests, locations, roles, roletalk, rolespine, attrs, bcat, timeslots):
    collect_text_keys(tbl)

# audio cues referenced by tables
for tbl in (locations, rolespine, roletalk, timeslots, endings):
    c = []; find_cues(tbl, c)
for r in rolespine:
    if r.get("AudioId"): audio_where[r["AudioId"]]["kind"].add("voice"); audio_where[r["AudioId"]]["scripts"].add("rolespine")
for r in roletalk:
    if r.get("AudioId"): audio_where[r["AudioId"]]["kind"].add("voice"); audio_where[r["AudioId"]]["scripts"].add("roletalk")
for r in locations:
    if r.get("Abient"): audio_where[r["Abient"]]["kind"].add("amb"); audio_where[r["Abient"]]["scripts"].add("location")
for r in rows("BinData/SolarSchool/solarschoolendingsummary.json"):
    if r.get("AudioResource"): audio_where[r["AudioResource"]]["kind"].add("bgm"); audio_where[r["AudioResource"]]["scripts"].add("endingsummary")

# ---------------------------------------------------------------- conditions (ActivityCondition + main condition tables)
ac_tbl = {x["Id"]: x for x in tryload("BinData/ActivityCondition/activitycondition.json")}
ag_tbl = {x["Id"]: x for x in tryload("BinData/ActivityCondition/activityconditiongroup.json")}
ct_tbl = {x["Id"]: x["TypeName"] for x in tryload("BinData/ActivityCondition/activityconditionclienttype.json")}
mc_tbl = {x["Id"]: x for x in tryload("BinData/condition/condition.json")}
mg_tbl = {x["Id"]: x for x in tryload("BinData/condition/conditiongroup.json")}

# English glosses of the 29 client condition types (derived from the Chinese TypeName; see SPEC 4.7)
CT_GLOSS = {1: "attribute in range", 2: "behavior count", 3: "role favor level", 4: "exam score",
            5: "role unlocked", 6: "date in range", 7: "date reached", 8: "special-request state",
            9: "special requests completed", 10: "holds item", 11: "playthrough count",
            12: "location unlocked", 13: "current weekday", 14: "current location", 15: "AVG variable",
            16: "today's instance", 17: "ending chosen", 19: "role current-level favor full",
            20: "fatigue state", 21: "current time slot", 22: "behavior unlocked", 23: "faction level",
            24: "attribute count", 25: "shop purchase count", 26: "role gift count",
            27: "quest reward claimed", 28: "quest node completed", 29: "item count in range",
            30: "ending achieved"}
cond_out, cond_missing, cond_ambiguous = {}, set(), set()
cond_type_params = collections.defaultdict(set)
MAIN_FIRST = {("solarschoolgallery", "UnlockCondition"), ("solarschoolquestreward", "LocalCondition"),
              ("solarschoolscratchticketco", "MinCondition"), ("solarschoolscratchticketco", "MaxCondition")}

def params_of(c): return {x["Key"]: x["Value"] for x in c.get("Params") or c.get("LimitParams") or []}

def leaf_activity(i):
    c = ac_tbl[i]; pr = params_of(c)
    cond_type_params[c["Type"]].update(pr.keys())
    return {"id": i, "src": "activity", "node": "cond", "type": c["Type"], "typeName": ct_tbl.get(c["Type"]),
            "gloss": CT_GLOSS.get(c["Type"]), "params": pr}

def leaf_main(i):
    c = mc_tbl.get(i)
    if not c: cond_missing.add(i); return {"id": i, "node": "missing"}
    return {"id": i, "src": "main", "node": "cond", "type": c["Type"], "need": c.get("NeedNum"),
            "params": {x["Key"]: x["Value"] for x in c.get("LimitParams") or []}}

def decode(i, prefer_main=False):
    """-> expression tree. group: {node:'group', logic:'and'|'or', items:[leaf...]} ; leaf: {node:'cond', ...}
    Verified in the data: group items are ALWAYS condition ids (never nested groups); the few ids that exist in both the
    group and the condition table are coincidental reuse, so items are resolved as conditions only."""
    order = (["mg", "mc", "ag", "ac"] if prefer_main else ["ag", "ac", "mg", "mc"])
    tables = {"ag": ag_tbl, "ac": ac_tbl, "mg": mg_tbl, "mc": mc_tbl}
    hits = [k for k in order if i in tables[k]]
    if len(hits) > 1: cond_ambiguous.add(i)
    if not hits:
        cond_missing.add(i); return {"id": i, "node": "missing"}
    k = hits[0]
    if k == "ag":
        g = ag_tbl[i]
        return {"id": i, "src": "activity", "node": "group", "logic": "and" if g["Logic"] == 0 else "or",
                "items": [leaf_activity(x) if x in ac_tbl else {"id": x, "node": "missing"} for x in g["GroupId"]]}
    if k == "ac": return leaf_activity(i)
    if k == "mg":
        g = mg_tbl[i]
        return {"id": i, "src": "main", "node": "group", "logic": "and" if g.get("Relation", 0) == 0 else "or",
                "relationRaw": g.get("Relation"), "items": [leaf_main(x) for x in g["GroupId"]]}
    return leaf_main(i)

def expr(t):
    if t["node"] == "missing": return f"?{t['id']}"
    if t["node"] == "cond":
        pr = ",".join(f"{k}={v}" for k, v in t["params"].items())
        return f"{t.get('typeName') or t.get('type')}({pr})"
    return "(" + (" AND " if t["logic"] == "and" else " OR ").join(expr(x) for x in t["items"]) + ")"

cond_refs = collections.defaultdict(set)      # "table.field" -> ids
for rel in sorted(glob.glob(os.path.join(ROOT, "BinData/SolarSchool/*.json"))):
    tname = os.path.basename(rel)[:-5]
    try: d = json.load(open(rel, encoding="utf8"))
    except Exception: continue
    if not isinstance(d, list): continue
    for r in d:
        if not isinstance(r, dict): continue
        for k, v in r.items():
            if "Condition" in k and isinstance(v, int) and v:
                cond_refs[f"{tname}.{k}"].add(v)
for key, ids in cond_refs.items():
    t, f = key.split(".")
    for i in sorted(ids):
        if str(i) not in cond_out:
            tree = decode(i, prefer_main=(t, f) in MAIN_FIRST)
            tree["expr"] = expr(tree)
            cond_out[str(i)] = tree
write("maps/condition-types.json", {"types": {str(k): {"name": v, "gloss": CT_GLOSS.get(k),
                                    "paramKeys": sorted(cond_type_params.get(k, []))} for k, v in sorted(ct_tbl.items())}}, 1)
write("maps/conditions.json", {"note": "groups: logic and/or (ActivityCondition Logic 0=and, 1=or; Logic=1 confirmed by the ending-flow 'school saved' check)",
                               "refs": {k: sorted(v) for k, v in sorted(cond_refs.items())},
                               "conditions": cond_out}, None)

# Retain the whole authored activity, including management triggers which are
# not referenced by a dialogue performance. IDs belong to distinct namespaces.
story_source = {
    "schema": 1,
    "activity": next((r for r in rows("BinData/SolarSchool/solarschoolactivity.json") if r["Id"] == ACT), None),
    "actions": {str(r["Id"]): r for r in tryload("BinData/ActivityAction/activityaction.json")},
    "rewards": {str(r["Id"]): r for r in tryload("BinData/SolarSchool/solarschoolreward.json")},
    "rewardGroups": {str(r["Id"]): r for r in tryload("BinData/SolarSchool/solarschoolrewards.json")},
    "items": {str(r["Id"]): r for r in tryload("BinData/SolarSchool/solarschoolitem.json")},
    "groups": {str(i): r for i, r in ag_tbl.items()},
    "conditions": {str(i): r for i, r in ac_tbl.items()},
}
collect_text_keys(story_source["items"])
for name, filename in {
    "attrs": "attr", "roles": "role", "favorLevels": "rolefavorlevel",
    "avgParams": "avgparam", "params": "param", "requests": "quest",
    "questNodes": "questnode", "questRewards": "questreward",
    "behaviors": "behavior", "calendar": "calendar", "timeSlots": "timeslot",
    "instances": "instance", "locations": "location", "flows": "flow",
    "endingFlows": "endingflow", "endings": "ending", "buffs": "buff",
    "buffEffects": "buffeffect", "influences": "influence",
    "influenceLevels": "influencelevel", "exams": "exam", "examScoreRanks": "examscorerank",
    "roleSchedules": "roleschedule", "roleTalks": "roletalk", "roleSpines": "rolespine",
    "eventChecks": "eventcheck", "eventCheckOptions": "eventcheckopt",
    "eventProbabilities": "eventprobability",
    "datePeriods": "dateperiod", "shopGoods": "shopgoods",
    "shops": "shop", "shopRefresh": "shoprefresh",
    "spans": "span", "options": "options", "affairs": "affairs", "affairsOptions": "affairsoption",
    "scratchTickets": "scratchticketco", "scratchRewards": "scratchticketre",
    "itemEffects": "itemeffect", "roleGifts": "rolefavor",
}.items():
    table = rows(f"BinData/SolarSchool/solarschool{filename}.json")
    collect_text_keys(table)
    story_source[name] = {str(r["RoundId"] if name == "scratchTickets" else r["Id"]): r for r in table}
story_source["mainConditions"] = {str(i): r for i, r in mc_tbl.items()}
for name, filename in {"prizeActivities": "prizeactivity", "prizeAwards": "prizeawardsgroup"}.items():
    table = rows(f"BinData/SolarSchool/{filename}.json")
    collect_text_keys(table)
    story_source[name] = {str(r["Id"]): r for r in table}
write("maps/story-source.json", story_source, None)

# ---------------------------------------------------------------- write maps
write("maps/flow-registry.json", {str(r["Id"]): {"stateKey": f'{r["FlowListName"]}_{r["FlowId"]}_{r["StateId"]}',
                                                  "group": group_of(f'{r["FlowListName"]}_{r["FlowId"]}_{r["StateId"]}'),
                                                  "needSave": r.get("NeedSave"), "bitFlag": r.get("BitFlag")} for r in sflow}, 1)
write("maps/story-graph.json", {"startNode": next((r["Id"] for r in endflow if r.get("IsStart")), None),
                                "nodeTypes": {"1": "play flow: flowId in flow-registry, or a SYSTEM ACTION when flowId is not in flow-registry (see comment)",
                                              "2": "branch on ConditionId (true/false)",
                                              "3": "end of ending flow (comment: 结局流程结束)",
                                              "4": "terminal: start next playthrough (comment: 开启下一周目)"},
                                "nodes": [{"id": r["Id"], "type": r["NodeType"], "flowId": r["ActionId"] or None,
                                           "systemAction": bool(r["NodeType"] == 1 and r["ActionId"] not in sflow_id),
                                           "conditionId": r["ConditionId"] or None, "next": r["NextId"] or None,
                                           "true": r["TrueNextId"] or None, "false": r["FalseNextId"] or None,
                                           "isStart": r["IsStart"], "comment": r.get("Comments"),
                                           "conditionExpr": (cond_out.get(str(r["ConditionId"])) or {}).get("expr") if r["ConditionId"] else None}
                                          for r in endflow]}, 1)
ENDING_KIND = {1: "exclusive (no condition)", 2: "career/main ending", 3: "companion ending"}
write("maps/endings.json", [dict(e, kindName=ENDING_KIND.get(e.get("EndingType")),
                                 conditionExpr=(cond_out.get(str(e["ConditionId"])) or {}).get("expr")) for e in endings], 1)
write("maps/quest-nodes.json", {"quests": quests, "nodes": qnodes}, None)
write("maps/calendar.json", {"calendar": calendar, "timeSlots": timeslots, "datePeriods": periods}, None)
write("maps/behaviors.json", {"behaviors": behaviors, "categories": bcat}, None)
write("maps/locations.json", locations, None)
write("maps/roles.json", {"roles": roles, "talks": roletalk, "spines": rolespine}, None)
write("maps/attrs.json", {"attrs": attrs, "params": params, "avgFlags": avgparam}, 1)
write("maps/quizzes.json", list(quiz_by_action.values()), 1)
write("maps/backgrounds.json", {str(k): {"desc": v.get("Description"), "day": v.get("DayPicPath"), "night": v.get("NightPicPath")} for k, v in bg_tbl.items()}, 1)
write("maps/cgs.json", {str(k): {"desc": v.get("Description"), "level": v.get("Level"), "data": v.get("Data")} for k, v in cg_tbl.items()}, 1)
write("maps/expressions.json", {str(k): v for k, v in expr_tbl.items()}, None)
write("maps/talkers.json", {str(k): v for k, v in talk_tbl.items()}, None)
write("maps/audio.json", {c: {"kind": sorted(v["kind"]), "usedBy": sorted(v["scripts"], key=str)} for c, v in sorted(audio_where.items()) if c}, 1)
write("assets.character-catalog.json", {
    "schema": 1,
    "note": "Explicit source identities and table references; no inferred stage Enter or gender expression substitution.",
    "speakerSource": "BinData/speaker/speaker.json:AvgTalkerConfig",
    "talkerSource": "BinData/AvgTalkerConfig/avgtalkerconfig.json",
    "expressionSource": "BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json",
    "scriptTalkerIds": sorted(script_talkers), "configuredTalkerIds": sorted(configuration_talkers),
    "requiredTalkerIds": sorted(required_talkers),
    "scriptExpressionIds": sorted(script_expr), "configurationExpressionIds": sorted(configuration_expr),
    "talkerDefaultExpressions": {str(tid): eid for tid, eid in sorted(default_expressions.items())},
    "speakerTalkers": {who: row["talkerId"] for who, row in speakers.items()},
    "roleSpineReferences": [{"id": r["Id"], "roleId": r.get("RoleId"), "expressionId": r.get("AnimationId") or None}
                            for r in rolespine],
    "parameterSpineReferences": {r["Key"]: r["IntArrayValue"] for r in params if "SpineIdList" in r.get("Key", "")},
}, 1)

# ---------------------------------------------------------------- assets manifest / usage
fx_paths = {}
fx_cues = []
for s in scripts.values():
    for nd in s["nodes"]:
        phases = [(None, nd["stage"])] + [(oi, option.get("performances", []))
                                           for oi, option in enumerate(nd.get("options", []))]
        for option_index, operations in phases:
            for operation_index, st in enumerate(operations):
                if st["op"] not in ("screenFx", "stopScreenFx", "portraitFx"): continue
                if st["op"] != "portraitFx" and st.get("fx"): fx_paths[st["fx"]] = st.get("path")
                fx_cues.append({"scriptId": s["id"], "nid": nd["nid"],
                                "phase": st.get("phase", "start"),
                                "optionIndex": option_index, "operationIndex": operation_index,
                                "operation": st})
write("maps/vfx.json", {"schema": 1, "source": "flowState Start/End/OptionPerformances",
                        "effects": fx_paths, "cues": fx_cues}, 1)
write("assets.manifest.json", {
    "note": "ids and UE paths only; no binary assets are part of this data set",
    "backgrounds": {str(i): {"label": bg_tbl[i].get("Description"), "day": bg_tbl[i].get("DayPicPath"), "night": bg_tbl[i].get("NightPicPath")}
                    for i in sorted(used_bg) if i in bg_tbl},
    "cgs": {str(i): {"label": cg_tbl[i].get("Description"), "path": (cg_tbl[i].get("Data") or {}).get("PicPath"),
                     "pathMale": (cg_tbl[i].get("Data") or {}).get("PicPathMaleVariant")} for i in sorted(used_cg) if i in cg_tbl},
    "quizzes": {str(q["id"]): {"label": q["titleKey"], "path": q["illustration"]}
                for q in quiz_by_action.values() if q["id"] in used_quizzes},
    "talkers": {str(i): solar_talker_asset(talk_tbl[i]) for i in sorted(used_talker) if i in talk_tbl},
    "expressions": {str(i): {"talkerId": expr_tbl[i].get("AvgTalkerId"), "label": expr_tbl[i].get("AnimationName"),
                             "body": expr_tbl[i].get("BodyAnimation"), "eye": expr_tbl[i].get("EyeAnimation"),
                             "mouth": expr_tbl[i].get("MouthAnimation")} for i in sorted(used_expr) if i in expr_tbl},
    "audio": {c: {"kind": sorted(v["kind"])} for c, v in sorted(audio_where.items()) if c},
    "fx": fx_paths}, 1)
write("assets.usage.json", usage, None)

# ---------------------------------------------------------------- scripts + index
index = []
for sid, s in scripts.items():
    write(f"scripts/{sid}.json", s, None)
    index.append({"id": sid, "stateKey": s["stateKey"], "group": s["group"], "nodes": len(s["nodes"]), "registered": s["registered"]})
write("scripts.index.json", index, 1)
write("speakers.json", speakers, 1)

# ---------------------------------------------------------------- locales
missing_by_locale = {}
empty_by_locale = {}
for lg in LOCALES:
    out, miss = {}, []
    empty = []
    for k in sorted(used_keys):
        if k in source_texts[lg] and not source_texts[lg][k].strip():
            out[k] = source_texts[lg][k]
            empty.append(k)
            continue
        v = texts[lg].get(k) or (fb.get(k) if FALLBACK else None)
        if v: out[k] = v
        else: miss.append(k)
    write(f"locales/{lg}.json", out, None)
    missing_by_locale[lg] = miss
    empty_by_locale[lg] = empty

# ---------------------------------------------------------------- validation / report
report = {"scripts": len(scripts), "nodes": sum(len(s["nodes"]) for s in scripts.values()),
          "unregisteredScripts": unreg, "textKeysUsed": len(used_keys),
          "missingTextKeys": {lg: len(m) for lg, m in missing_by_locale.items()},
          "missingTextKeySamples": {lg: m[:15] for lg, m in missing_by_locale.items()},
          "explicitEmptyTextKeys": empty_by_locale,
          "hideAndAutoSelectNodes": [{"scriptId": sid, "nid": n["nid"]}
                                     for sid, script in scripts.items() for n in script["nodes"]
                                     if n.get("raw", {}).get("OptionInteractionType") == "HideAndAutoSelect"],
          "optionPerformanceCount": sum(len(o.get("performances", [])) for script in scripts.values()
                                        for n in script["nodes"] for o in n.get("options", [])),
          "unknownStageOps": dict(usage_unknown),
          "unsupportedFlowActions": dict(unsupported_flow_actions),
          "movieActions": [{"scriptId": sid, "videoName": a["videoName"]}
                           for sid, s in scripts.items() for a in s["flowActions"] if a["op"] == "movie"],
          "scriptsWithoutTalkNodes": [sid for sid, s in scripts.items() if not s["nodes"]],
          "optionControlConflicts": option_control_conflicts,
          "quizzes": {"questions": len(quiz_by_action), "unresolvedActions": unresolved_quiz_actions,
                      "unresolvedAnswers": [{"quizId": q["id"], "answerId": a["id"]} for q in quiz_by_action.values()
                                            for a in q["answers"] if a["correct"] is None],
                      "triggers": [{"scriptId": sid, "nid": n["nid"], "phase": op.get("phase", "start"),
                                    "actionId": op["actionId"], "quizId": op["quiz"]["id"]}
                                   for sid, script in scripts.items() for n in script["nodes"]
                                   for op in n["stage"] + [p for o in n.get("options", []) for p in o.get("performances", [])]
                                   if op.get("quiz")]},
          "optionNextKinds": dict(collections.Counter(o["next"]["type"] for s in scripts.values()
                                                       for n in s["nodes"] for o in n.get("options", []))),
          "talkersWithoutSolarSchoolSpine": [i for i in sorted(used_talker) if i in talk_tbl
                                             and not (talk_tbl[i].get("SolarSchoolSpineAtlas")
                                                      and talk_tbl[i].get("SolarSchoolSpineSkeletonData"))],
          "kinds": dict(collections.Counter(n["kind"] for s in scripts.values() for n in s["nodes"])),
          "speakers": len(speakers),
          "conditions": {"resolved": len(cond_out) - len(cond_missing), "referenced": len(cond_out),
                         "missing": sorted(cond_missing), "ambiguousIds": sorted(cond_ambiguous),
                         "typesInUse": sorted({c.get("type") for t in cond_out.values() for c in ([t] + t.get("items", [])) if isinstance(c, dict) and c.get("node") == "cond"}, key=str)},
          "speakersWithoutName": sorted(w for w, v in speakers.items() if not v["nameKey"]),
          "activityActionIds": {"distinct": len(activity_actions), "total": sum(activity_actions.values()),
                                "alsoFlowIds": sorted(a for a in activity_actions if a in sflow_id),
                                "note": "Numeric overlap with flow IDs is not a flow call. Only ActionType 1 with an explicit SolarSchoolFlow parameter defines a script target; none of the referenced performances uses that type."}}
if not args.no_validate:
    dangling, no_text_nodes, no_speaker = [], [], []
    for sid, s in scripts.items():
        nids = {n["nid"] for n in s["nodes"]}
        for n in s["nodes"]:
            tgt = [n["next"].get("to")] if n["next"]["type"] == "jump" else []
            tgt += [o["next"].get("to") for o in n.get("options", []) if o["next"]["type"] == "jump"]
            for t in tgt:
                if t not in nids: dangling.append([sid, n["nid"], t])
            if n["kind"] in ("line", "narration", "centerText") and not n["textKey"]: no_text_nodes.append([sid, n["nid"]])
    ref_missing = {"background": sorted(i for i in used_bg if i not in bg_tbl),
                   "cg": sorted(i for i in used_cg if i not in cg_tbl),
                   "expression": sorted(i for i in used_expr if i not in expr_tbl),
                   "talker": sorted(i for i in used_talker if i not in talk_tbl)}
    flows_ok = sum(1 for r in sflow if f'{r["FlowListName"]}_{r["FlowId"]}_{r["StateId"]}' in {s["stateKey"] for s in scripts.values()})
    bad_endflow = [{"node": r["Id"], "actionId": r["ActionId"], "comment": r.get("Comments")}
                   for r in endflow if r["NodeType"] == 1 and r["ActionId"] not in sflow_id]
    bad_ending = [r["Id"] for r in endings if r.get("FlowId") not in sflow_id]
    report["validation"] = {"danglingJumps": dangling[:50], "danglingJumpCount": len(dangling),
                            "nodesWithoutTextKey": no_text_nodes[:50], "nodesWithoutTextKeyCount": len(no_text_nodes),
                            "assetIdsMissingFromTables": ref_missing,
                            "flowRegistryResolved": f"{flows_ok}/{len(sflow)}",
                            "endingFlowSystemActions": bad_endflow, "endingsWithBadFlow": bad_ending}
write("build-report.json", report, 1)

write("manifest.json", {"schema": 2, "activityId": ACT, "titleKey": ACT_TITLE_KEY,
                        "source": {"gameVersion": "3.8.0", "resVersion": "3.8.6", "changelist": 9383927},
                        "defaultLocale": LOCALES[0], "locales": LOCALES, "scripts": "scripts.index.json",
                        "endings": "maps/endings.json", "story": "maps/story-graph.json",
                        "assets": "assets.manifest.json", "report": "build-report.json"}, 1)

print(f"{report['scripts']} scripts, {report['nodes']} nodes, {len(used_keys)} text keys, locales={LOCALES}")
print("missing text keys:", report["missingTextKeys"])
if "validation" in report:
    v = report["validation"]
    print("dangling jumps:", v["danglingJumpCount"], "| flow registry:", v["flowRegistryResolved"],
          "| nodes w/o textKey:", v["nodesWithoutTextKeyCount"])
    print("asset ids missing:", {k: len(x) for k, x in v["assetIdsMissingFromTables"].items()})
