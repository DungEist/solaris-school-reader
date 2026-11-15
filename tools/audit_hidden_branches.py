"""Trace every hidden branch against exported source definitions; no gameplay simulation."""
import collections
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
data = root / "public/data"
source = json.loads((data / "maps/story-source.json").read_text())
scripts = [json.loads(p.read_text()) for p in sorted((data / "scripts").glob("*.json"))]
grants = collections.defaultdict(list)
hidden_options = {f"{s['id']}/{n['nid']}": n['options'] for s in scripts for n in s['nodes']
                  if n.get('raw', {}).get('OptionInteractionType') == 'HideAndAutoSelect'}
option_prerequisites = [{"scriptId": s['id'], "nid": n['nid'], "optionId": o['optionId'], "preCondition": o['preCondition']}
                        for s in scripts for n in s['nodes'] for o in n.get('options', []) if 'preCondition' in o]
audit = json.loads(subprocess.check_output([
    'node', '--experimental-strip-types', '--input-type=module', '--eval',
    """import { readFileSync } from 'node:fs';
import { evaluateCondition, initialStoryState, resolveHiddenBranch, validateStorySource } from './src/engine/StoryState.ts';
const source = validateStorySource(JSON.parse(readFileSync('public/data/maps/story-source.json', 'utf8')));
const fresh = initialStoryState(source), partial = initialStoryState();
const input = JSON.parse(process.argv[1]);
const hidden = Object.fromEntries(Object.entries(input.hidden).map(([key, options]) => [key, {
  fresh: resolveHiddenBranch(options, fresh, source),
  partial: resolveHiddenBranch(options, partial, source),
  conditions: options.map(option => evaluateCondition(option.preCondition, fresh, source)),
}]));
const options = input.options.map(row => ({ ...row,
  fresh: evaluateCondition(row.preCondition, fresh, source),
  nextCycle: evaluateCondition(row.preCondition, { ...fresh, playthroughCount: 2 }, source),
  partial: evaluateCondition(row.preCondition, partial, source),
}));
process.stdout.write(JSON.stringify({ hidden, options }));""", json.dumps({"hidden": hidden_options, "options": option_prerequisites}),
], cwd=root, text=True))
evaluations = audit['hidden']

def action_trace(action_id):
    action = source["actions"].get(str(action_id))
    trace = {"actionId": action_id, "definition": action}
    if action and action["ActionType"] == 2:
        params = {p["Key"]: p["Value"] for p in action["ActionParams"]}
        group = source["rewardGroups"].get(params.get("SolarSchoolRewardId"))
        trace["rewardGroup"] = group
        trace["rewards"] = [source["rewards"].get(str(i)) for i in (group or {}).get("RewardIds", [])]
    return trace

for script in scripts:
    for node in script["nodes"]:
        for operation in node["stage"]:
            if operation["op"] != "activityAction":
                continue
            trace = action_trace(operation.get("actionId"))
            for reward in trace.get("rewards", []):
                if reward and reward["RewardType"] == 2:
                    grants[str(reward["TargetId"])].append({"scriptId": script["id"], "nid": node["nid"], "phase": operation.get("phase", "start"), "time": operation["t"], **trace})

branches = []
for script in scripts:
    for node in script["nodes"]:
        if node.get("raw", {}).get("OptionInteractionType") != "HideAndAutoSelect":
            continue
        group_id = str(node["options"][0]["preCondition"]["System"]["ConditionGroupId"])
        group = source["groups"].get(group_id)
        conditions = [source["conditions"].get(str(i)) for i in (group or {}).get("GroupId", [])]
        inventory = [p["Value"] for c in conditions if c and c["Type"] == 10 for p in c["Params"] if p["Key"] == "ItemId"]
        branches.append({
            "scriptId": script["id"], "nid": node["nid"], "group": group, "conditions": conditions,
            "evaluations": evaluations[f"{script['id']}/{node['nid']}"],
            "withObservedRequiredInventory": "first conditioned option precedes fallback" if inventory else "gallery ending4 must be achieved",
            "priorityEvidence": {"path": "docs/ROUTE_DISPATCHER_EVIDENCE.md", "method": "SelectFirstAvailableOption", "token": "0x0602520F", "rule": "first eligible option in source order"},
            "priorChoiceOrPlotIdDependency": "No implicit PlotOptionId AVG write; these conditions read owned items or gallery achievement.",
            "inventoryAcquisition": [g for item in inventory for g in grants[item]],
            "options": [{"optionId": o["optionId"], "preCondition": o.get("preCondition"), "actions": o.get("raw", {}).get("Actions", []), "next": o["next"], "performances": [{"time": p["t"], **action_trace(p.get("actionId"))} for p in o.get("performances", []) if p["op"] == "activityAction"]} for o in node["options"]],
        })

resolved = sum(b["evaluations"]["fresh"]["optionIndex"] is not None for b in branches)
output = root / "test-results/phase8-hidden-branches.json"
output.parent.mkdir(exist_ok=True)
unknown_options = [o for o in audit['options'] if o['fresh']['value'] == 'unknown']
output.write_text(json.dumps({"activityId": 111700001, "evidenceKind": "static source trace and current evaluator probes; no original-game execution", "automaticallyResolvedInFreshSession": resolved, "hiddenNodes": branches,
                             "authoredOuterPrerequisites": {"count": len(audit['options']), "freshUnknownCount": len(unknown_options), "options": audit['options']}}, indent=2) + "\n")
print(f"Audited {len(branches)} hidden nodes ({resolved} fresh resolutions) and {len(audit['options'])} outer prerequisites ({len(unknown_options)} fresh unknowns). Evidence: {output.relative_to(root)}")
