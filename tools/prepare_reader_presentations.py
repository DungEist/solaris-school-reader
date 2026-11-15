"""Export only presentation definitions reached by supported script events.

Uses existing local source tables; it never reads or writes the installation.
Text remains keyed and separate from artwork. Score/rank letters stay deferred.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data'
RAW = ROOT / 'WutheringWaves_Data'

def read(path):
    return json.loads(path.read_text())

def operations(script):
    for node in script['nodes']:
        yield from node.get('stage', [])
        for option in node.get('options', []):
            yield from option.get('performances', [])

def main():
    paths = [DATA / 'maps/roles.json', DATA / 'maps/story-source.json',
             RAW / 'BinData/SolarSchool/solarschoolletter.json',
             RAW / 'BinData/SolarSchool/solarschoolletterpage.json',
             RAW / 'Textmaps/en/multi_text/MultiText.json']
    roles = {r['Id']: r for r in read(paths[0])['roles']}
    actions = read(paths[1])['actions']
    letters = {r['Id']: r for r in read(paths[2])}
    pages = {r['Id']: r for r in read(paths[3])}
    english = {r['Id']: r['Content'] for r in read(paths[4])}
    intro_ids, action_ids = set(), set()
    for path in (DATA / 'scripts').glob('*.json'):
        for op in operations(read(path)):
            if op.get('op') == 'roleIntro':
                intro_ids.add(op.get('introId'))
            if op.get('op') == 'activityAction' and op.get('kind') == 'SolarSchool':
                action_ids.add(op.get('actionId'))
    introductions = {}
    for identifier in sorted(i for i in intro_ids if isinstance(i, int)):
        role = roles.get(identifier)
        if not role:
            continue
        introductions[str(identifier)] = {
            'id': identifier, 'nameKey': role['IntroductionName'],
            'influenceKey': role['IntroductionInfluenceName'],
            'textKey': role['Introduction'], 'color': role['IntroductionColor'],
        }
    reached_letters, supplemental, deferred = {}, {}, []
    for action_id in sorted(i for i in action_ids if isinstance(i, int)):
        action = actions.get(str(action_id), {})
        if action.get('ActionType') not in (6, 10):
            continue
        params = {r['Key']: r['Value'] for r in action.get('ActionParams', [])}
        identifier = params.get('Id' if action['ActionType'] == 6 else 'LetterId', '')
        if not identifier.isdecimal() or int(identifier) not in letters:
            continue
        letter = letters[int(identifier)]
        selected_pages = []
        for page_id in letter['PageList'][letter['PageStart']:letter['PageEnd'] + 1]:
            paragraph_keys = pages.get(page_id, {}).get('Paragraph', [])
            if not paragraph_keys or any(key not in english for key in paragraph_keys):
                selected_pages = []
                break
            selected_pages.append({'id': page_id, 'paragraphKeys': paragraph_keys})
        keys = [key for page in selected_pages for key in page['paragraphKeys']]
        if not keys or action['ActionType'] != 6 or any(re.search(r'\{(?:Score|Rank):', english[key]) for key in keys):
            deferred.append({'actionId': action_id, 'letterId': int(identifier),
                             'reason': 'Accumulated score/rank or supported page state is unavailable.'})
            continue
        reached_letters[str(action_id)] = {'id': int(identifier), 'pages': selected_pages}
        supplemental.update({key: english[key] for key in keys})
    payload = {'schema': 1, 'introductions': introductions, 'lettersByAction': reached_letters,
               'english': supplemental, 'deferred': deferred,
               'source': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    (DATA / 'reader-presentations.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(f'Exported {len(introductions)} introductions, {len(reached_letters)} letters; {len(deferred)} result actions deferred.')

if __name__ == '__main__':
    main()
