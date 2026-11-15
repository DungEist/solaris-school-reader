"""Audit every supported script and authored location/interaction audio reference."""
from pathlib import Path
from collections import Counter
import json

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'public/data/maps/audio-playback.json').read_text())
research = json.loads((ROOT / 'public/data/maps/audio.json').read_text())
source = json.loads((ROOT / 'public/data/maps/story-source.json').read_text())

def resolve(cue):
    event = manifest['events'].get(cue)
    return {'cue': cue, 'kind': event['kind'], 'action': event['action']} if event else {'cue': cue, 'unresolved': manifest['unresolved'].get(cue, 'Not in traced manifest')}

def stage_audio(value):
    if isinstance(value, dict):
        if value.get('op') == 'audio' and value.get('cue'):
            yield value['cue']
        for key, child in value.items():
            if key != 'raw':
                yield from stage_audio(child)
    elif isinstance(value, list):
        for child in value:
            yield from stage_audio(child)

scripts = {}
missing_lines = []
for path in sorted((ROOT / 'public/data/scripts').glob('*.json')):
    script = json.loads(path.read_text())
    initial = [cue for action in script['flowActions'] for cue in action.get('config', {}).get('initialAudio', []) if cue]
    talk_events = [cue for node in script['nodes'] for cue in ([node['voice']] if isinstance(node.get('voice'), str) else node.get('voice', [])) if cue]
    lines = []
    for node in script['nodes']:
        key = f"{script['id']}:{node['nid']}"
        if key in manifest['lines']:
            lines.append(key)
        elif 'line:' + str(node.get('textKey')) in manifest['unresolved']:
            missing_lines.append({'script': script['id'], 'node': node['nid'], 'textKey': node['textKey']})
    scripts[script['id']] = {'stateKey': script['stateKey'], 'initialAudio': list(map(resolve, initial)), 'stageAudio': list(map(resolve, stage_audio(script))), 'talkAkEvents': list(map(resolve, talk_events)), 'resolvedVoiceLines': lines}
locations = {key: resolve(row['Abient']) if row.get('Abient') else {'action': 'silence'} for key, row in source['locations'].items()}
interactions = {key: {'textKey': row['TextKey'], 'audio': resolve(row['AudioId']) if row.get('AudioId') else {'action': 'silence'}} for key, row in source['roleSpines'].items()}
voice_failures = {key: reason for key, reason in manifest['unresolved'].items() if key.startswith('line:')}
voice_failure_keys = {key.removeprefix('line:').rsplit(':', 1)[0] if key.rsplit(':', 1)[1] in ['ja', 'en', 'zh', 'ko'] else key.removeprefix('line:') for key in voice_failures}
result = {
    'counts': {'researchCues': len(research), 'resolvedResearchCues': sum(cue in manifest['events'] for cue in research), 'unresolvedResearchCues': len(manifest['unresolvedEvents']), 'scripts': len(scripts), 'locations': len(locations), 'roleSpines': len(interactions), 'assets': len(manifest['assets']), 'resolvedVoiceNodeReferences': len(manifest['lines']), 'unresolvedVoiceNodeReferences': len(missing_lines), 'unresolvedVoiceTextKeys': len({row['textKey'] for row in missing_lines}), 'eventKindsIncludingSyntheticSilence': dict(Counter(row['kind'] for row in manifest['events'].values()))},
    'languages': manifest['languages'], 'scripts': scripts, 'locations': locations, 'interactions': interactions,
    'unresolvedEvents': manifest['unresolvedEvents'], 'unresolvedVoiceLines': missing_lines,
    'voiceVariantFailures': voice_failures, 'voiceTextKeysWithAnyUnresolvedVariant': len(voice_failure_keys),
}
out = ROOT / 'test-results/audio/coverage.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2))
print(json.dumps(result['counts'], indent=2))
