#!/usr/bin/env python3
"""Audit every Reader script's source identities, lighting cues and potential
dialogue edges. This scans source structure; it does not simulate eligibility
or claim rendered playback of every route."""
import argparse
import collections
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data', type=pathlib.Path, default=ROOT / 'public/data')
parser.add_argument('--source', type=pathlib.Path, default=ROOT / 'WutheringWaves_Data')
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'test-results/reader-speaker-lighting/script-scan.json')
args = parser.parse_args()


def read(path):
    return json.loads(path.read_text())


def identity(who):
    return str(who) if who else None


TEXT = {'line', 'narration', 'centerText'}
ROLE_OPS = {'Enter': 'enter', 'Exit': 'exit', 'Move': 'move', 'ModifyRole': 'modify', 'PortraitEffect': 'portraitFx'}
STAGE_ROLE_OPS = set(ROLE_OPS.values())
LIGHT_OPS = {'enter', 'move', 'modify', 'exit'}
speakers = read(args.data / 'speakers.json')
original_speakers = {str(r['Id']): r for r in read(args.source / 'BinData/speaker/speaker.json')}
rows = read(args.source / 'BinData/flowState/flowstate.json')
originals = {}
for row in rows:
    if '索拉学院' not in row.get('StateKey', ''):
        continue
    originals[row['StateKey']] = [item for action in json.loads(row['Actions'] or '[]')
        if action.get('Name') == 'ShowTalk' for item in action.get('Params', {}).get('TalkItems', [])]
del rows

index = read(args.data / 'scripts.index.json')
files = sorted((args.data / 'scripts').glob('*.json'))
scripts = [read(path) for path in files]
assert {s['id'] for s in scripts} == {s['id'] for s in index}, 'Index/script file coverage disagrees'
counts = collections.Counter()
issues = []
cases = collections.defaultdict(list)
script_reports = []
speaker_usage = collections.defaultdict(set)
color_values = collections.Counter()


def talker(who):
    return speakers.get(who or '', {}).get('talkerId') or None


def source_roles(item):
    expected = []
    rc = item.get('RoleConfig') or {}
    if item.get('WhoId') and any(k in rc for k in ['Expression', 'HidePortrait', 'HideAvatar', 'VisualEffect']):
        expected.append({'phase': 'start', 'time': 0, 'op': 'modify', 'who': identity(item['WhoId']),
            **({'effect': rc['VisualEffect']} if 'VisualEffect' in rc else {})})
    for phase, performances in [('start', item.get('StartPerformances', [])), ('end', item.get('EndPerformances', []))]:
        for p in performances or []:
            if p.get('Type') not in ROLE_OPS:
                continue
            role = p.get('RoleConfig') or {}
            expected.append({'phase': phase, 'time': p.get('StartTime', 0), 'op': ROLE_OPS[p['Type']], 'who': identity(p.get('WhoId')),
                **({'effect': role['VisualEffect']} if 'VisualEffect' in role and p['Type'] != 'PortraitEffect' else {})})
    return expected


def exported_roles(operations):
    return [{'phase': op.get('phase', 'start'), 'time': op['t'], 'op': op['op'], 'who': op.get('who'),
        **({'effect': op['effect']} if 'effect' in op else {})}
        for op in operations if op['op'] in STAGE_ROLE_OPS]


def lighting(node, phase='start'):
    return [op for op in node['stage'] if op['op'] in LIGHT_OPS and 'effect' in op and op.get('phase', 'start') == phase]


for script in scripts:
    sid = script['id']
    nodes = {n['nid']: n for n in script['nodes']}
    source_nodes = {n['Id']: n for n in originals.get(script['stateKey'], [])}
    if script['stateKey'] not in originals:
        issues.append({'scriptId': sid, 'code': 'missing-original-flow', 'stateKey': script['stateKey']})
    if set(nodes) != set(source_nodes):
        issues.append({'scriptId': sid, 'code': 'original-node-id-mismatch', 'exported': sorted(nodes), 'original': sorted(source_nodes)})
    declared = set()
    for node in script['nodes']:
        source = source_nodes.get(node['nid'], {})
        counts['nodes'] += 1
        if node['speakerId'] != identity(source.get('WhoId')):
            issues.append({'scriptId': sid, 'nid': node['nid'], 'code': 'speaker-who-id-mismatch', 'rawWhoId': source.get('WhoId'), 'exportedSpeakerId': node['speakerId']})
        counts['speakerWhoIdsCompared'] += 1
        if source_roles(source) != exported_roles(node['stage']):
            issues.append({'scriptId': sid, 'nid': node['nid'], 'code': 'actor-target-or-lighting-cue-mismatch',
                'original': source_roles(source), 'exported': exported_roles(node['stage'])})
        counts['actorTargetAndLightingRowsCompared'] += len(source_roles(source))
        for oi, option in enumerate(node.get('options', [])):
            counts['optionsCompared'] += 1
            raw = source.get('Options', [])[oi]
            original = {'StartPerformances': raw.get('TypeParams', {}).get('OptionPerformances', [])}
            expected = [{**p, 'phase': 'option'} for p in source_roles(original)]
            exported = exported_roles(option.get('performances', []))
            counts['optionActorTargetAndLightingRowsCompared'] += len(expected)
            if expected != exported:
                issues.append({'scriptId': sid, 'nid': node['nid'], 'optionIndex': oi, 'code': 'option-actor-target-or-lighting-cue-mismatch', 'original': expected, 'exported': exported})
        if node['speakerId']:
            speaker_usage[node['speakerId']].add(sid)
        for op in node['stage'] + [op for option in node.get('options', []) for op in option.get('performances', [])]:
            if op.get('who'):
                speaker_usage[op['who']].add(sid)
            if op['op'] == 'enter' and op.get('who'):
                declared.add(op['who'])
            if 'effect' in op and op['op'] in LIGHT_OPS:
                counts['explicitLightingCues'] += 1
                color_values[str(op['effect'])] += 1
        if node['kind'] in TEXT:
            counts['textNodes'] += 1
            if not lighting(node):
                counts['textNodesWithoutStartLighting'] += 1
                cases['textWithoutStartLighting'].append({'scriptId': sid, 'nid': node['nid'], 'speakerId': node['speakerId'], 'talkerId': talker(node['speakerId']), 'kind': node['kind']})
            if not node['stage']:
                counts['textNodesWithoutStageActions'] += 1
                cases['textWithoutStageActions'].append({'scriptId': sid, 'nid': node['nid'], 'speakerId': node['speakerId'], 'talkerId': talker(node['speakerId']), 'kind': node['kind']})

    blocks = [(i, action['nids']) for i, action in enumerate(script['flowActions']) if action['op'] == 'talk' and action['nids']]
    vertices = {(bi, nid): nodes[nid] for bi, nids in blocks for nid in nids}
    edges = []
    outbound = collections.defaultdict(list)
    block_lookup = {bi: (index, nids) for index, (bi, nids) in enumerate(blocks)}
    for (bi, nid), node in vertices.items():
        block_index, nids = block_lookup[bi]
        next_in_block = nids[nids.index(nid) + 1] if nids.index(nid) + 1 < len(nids) else None
        destinations = [('option', oi, option, option['next']) for oi, option in enumerate(node.get('options', []))]
        if not destinations:
            destinations = [('node', None, None, node['next'])]
        for kind, oi, option, navigation in destinations:
            target = None
            if navigation['type'] == 'jump':
                if navigation['to'] in nids:
                    target = (bi, navigation['to'])
                else:
                    issues.append({'scriptId': sid, 'nid': nid, 'flowActionIndex': bi, 'code': 'invalid-jump-target', 'navigation': navigation})
            elif navigation['type'] == 'seq' and next_in_block is not None:
                target = (bi, next_in_block)
            elif block_index + 1 < len(blocks):
                target = (blocks[block_index + 1][0], blocks[block_index + 1][1][0])
            edge = {'from': (bi, nid), 'to': target, 'kind': kind, 'navigation': navigation}
            if option is not None:
                edge.update({'optionIndex': oi, 'optionId': option['optionId'], 'preCondition': option.get('preCondition'),
                    'lightingCues': [p for p in option.get('performances', []) if 'effect' in p and p['op'] in LIGHT_OPS]})
            edges.append(edge)
            if target is not None:
                outbound[(bi, nid)].append(target)

    entry = (blocks[0][0], blocks[0][1][0]) if blocks else None
    reachable = set()
    pending = collections.deque([entry] if entry is not None else [])
    while pending:
        vertex = pending.popleft()
        if vertex in reachable:
            continue
        reachable.add(vertex)
        pending.extend(outbound[vertex])
    # Propagate the nearest text speaker through NoText/option vertices. Every
    # potential branch is admitted; condition eligibility is intentionally not
    # inferred. Text visits replace prior focus regardless of explicit cues.
    before = collections.defaultdict(set)
    if entry is not None:
        before[entry].add(None)
        pending.append(entry)
    while pending:
        vertex = pending.popleft()
        node = vertices[vertex]
        after = {node['speakerId']} if node['kind'] in TEXT else before[vertex]
        for target in outbound[vertex]:
            added = after - before[target]
            if added:
                before[target].update(added)
                pending.append(target)

    edge_reports = []
    local = collections.Counter()
    for edge in edges:
        source = vertices[edge['from']]
        target = vertices.get(edge['to'])
        prev_focus = {source['speakerId']} if source['kind'] in TEXT else before[edge['from']]
        flags = []
        if target is not None and target['kind'] in TEXT:
            if not lighting(target):
                flags.append('target-without-start-lighting')
            if not target['stage']:
                flags.append('target-without-stage-actions')
            if any(w != target['speakerId'] for w in prev_focus):
                flags.append('speaker-who-change')
            if any(talker(w) != talker(target['speakerId']) for w in prev_focus):
                flags.append('speaker-resource-change')
            if source['kind'] == 'narration':
                flags.append('after-narration')
            if edge['kind'] == 'option':
                flags.append('after-choice')
            if source['kind'] in {'silent', 'option'}:
                flags.append('after-nontext')
            if edge['to'][0] != edge['from'][0]:
                flags.append('next-talk-block')
            ref = {'scriptId': sid, 'fromFlowActionIndex': edge['from'][0], 'fromNid': source['nid'],
                'toFlowActionIndex': edge['to'][0], 'toNid': target['nid'], 'fromSpeakerId': source['speakerId'],
                'previousPossibleTextSpeakers': sorted(prev_focus, key=lambda v: v or ''),
                'toSpeakerId': target['speakerId'], 'toTalkerId': talker(target['speakerId']), 'edgeKind': edge['kind']}
            if edge['from'] in reachable:
                for category, required in [
                    ('speakerChangesWithoutStartLighting', ['speaker-who-change', 'target-without-start-lighting']),
                    ('speakerChangesWithoutStageActions', ['speaker-who-change', 'target-without-stage-actions']),
                    ('afterNarrationWithoutStartLighting', ['after-narration', 'target-without-start-lighting']),
                    ('afterChoicesWithoutStartLighting', ['after-choice', 'target-without-start-lighting']),
                    ('afterNontextWithoutStartLighting', ['after-nontext', 'target-without-start-lighting']),
                    ('nextTalkBlockWithoutStartLighting', ['next-talk-block', 'target-without-start-lighting']),
                ]:
                    if all(flag in flags for flag in required):
                        local[category] += 1
                        cases[category].append(ref)
        edge_reports.append({**edge, 'from': list(edge['from']), 'to': list(edge['to']) if edge['to'] else None,
            'potentiallyReachable': edge['from'] in reachable, 'classification': flags})
    counts.update(local)
    counts['graphVertices'] += len(vertices)
    counts['potentiallyReachableVertices'] += len(reachable)
    counts['graphEdges'] += len(edges)
    if len(declared) >= 2:
        counts['scriptsDeclaringMultipleActors'] += 1
    script_reports.append({'scriptId': sid, 'stateKey': script['stateKey'], 'group': script['group'],
        'initialBackground': script.get('config', {}).get('initialBackground'),
        'declaredActors': [{'who': who, 'talkerId': talker(who)} for who in sorted(declared)],
        'nodeCount': len(nodes), 'textNodeCount': sum(n['kind'] in TEXT for n in nodes.values()),
        'entry': list(entry) if entry else None, 'reachableVertexCount': len(reachable),
        'unreachableVertices': [list(v) for v in vertices if v not in reachable],
        'counts': dict(local), 'edges': edge_reports})

for who, used_in in speaker_usage.items():
    expected = original_speakers.get(who, {}).get('AvgTalkerConfig') or None
    exported = speakers.get(who, {}).get('talkerId') or None
    counts['speakerTalkerIdsCompared'] += 1
    if expected != exported:
        issues.append({'who': who, 'code': 'speaker-resource-talker-mismatch', 'original': expected, 'exported': exported, 'scripts': sorted(used_in)})

counts['scripts'] = len(scripts)
for key in ['speakerChangesWithoutStartLighting', 'speakerChangesWithoutStageActions',
            'afterNarrationWithoutStartLighting', 'afterChoicesWithoutStartLighting',
            'afterNontextWithoutStartLighting', 'nextTalkBlockWithoutStartLighting']:
    counts.setdefault(key, 0)
    cases.setdefault(key, [])
alias_groups = collections.defaultdict(list)
for who in speaker_usage:
    if talker(who):
        alias_groups[talker(who)].append(who)
aliases = [{'talkerId': tid, 'speakerIds': sorted(whos)} for tid, whos in sorted(alias_groups.items()) if len(whos) > 1]
report = {'passedSourcePreservationAudit': not issues, 'scope': 'All indexed scripts, every source node, actor-target/light cue row and option performance; all potential seq/jump/choice paths within ordered talk blocks and their continuations.',
    'evidenceKind': 'Static original-flow comparison and potential authored graph scan; original-game runtime and rendered playback are not inferred from this scan.',
    'limitations': [
        'Branches are included regardless of current SystemCondition eligibility; potentiallyReachable means structural reachability under some choices, not a playable current route.',
        'Calendar/quest/Go out dispatch crosses scripts through StoryPlaythrough and is not simulated by this graph. Stage-exit and checkpoint behavior require separate engine and browser verification.',
        'Declared actors establish available source identities, not simultaneous runtime portrait visibility.',
        'Rendering of every graph edge is not claimed. Representative normal Reader playback is recorded separately in production-browser-result.json.',
    ],
    'counts': dict(counts), 'explicitLightingValues': dict(color_values), 'sourcePreservationIssues': issues,
    'resourceAliases': aliases, 'cases': dict(cases), 'scripts': script_reports,
    'sourceIdentity': {'flowStateSha256': hashlib.sha256((args.source / 'BinData/flowState/flowstate.json').read_bytes()).hexdigest(),
        'speakerTableSha256': hashlib.sha256((args.source / 'BinData/speaker/speaker.json').read_bytes()).hexdigest(),
        'exportedSpeakerTableSha256': hashlib.sha256((args.data / 'speakers.json').read_bytes()).hexdigest(),
        'scriptDigests': {path.stem: hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': not issues, 'counts': dict(counts), 'preservationIssues': len(issues), 'report': str(args.output)}, ensure_ascii=False))
raise SystemExit(1 if issues else 0)
