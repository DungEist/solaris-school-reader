"""Correlate only missing SolarSchool MusicTrack cache IDs against local banks.
Extracts bank bytes transiently; never exports unrelated playable media.
"""
import sys,json,pathlib,struct,argparse
from wwise_sources import Pak,load_pak_keys
from wwise_bank import objects,music_sources
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('inventory');p.add_argument('--key-file',required=True);a=p.parse_args()
r=json.load(open(a.inventory))['records'];key=load_pak_keys(a.key_file)
by={x['name']:x for x in r};present={pathlib.Path(x['name']).stem for x in r if x['name'].endswith('.wem')};wanted=set()
for p in (ROOT/'asset-work/audio').glob('*music*.bnk'):
 for f in music_sources(objects(p.read_bytes())):
  if str(f['mediaId']) not in present:wanted.add(f['cacheId'])
rows=[x for x in by.values() if x['name'].endswith('.bnk') and 'music' in x['name']];matches=[];errors=[];paks={}
for i,row in enumerate(rows):
 try:
  if row['pak'] not in paks:
   if len(paks)>6:paks.clear()
   paks[row['pak']]=Pak(row['pak'],key)
  b=paks[row['pak']].extract(row['name'])
  for f in music_sources(objects(b)):
   if f['cacheId'] in wanted and str(f['mediaId']) in present:matches.append(dict(**f,bank=row['name'],pak=row['pak']))
 except Exception as ex:errors.append(dict(bank=row['name'],error=str(ex)))
 if i%100==0:print(i,'/',len(rows),'matches',len(matches),'errors',len(errors),flush=True)
(ROOT/'test-results/audio/music-aliases.json').write_text(json.dumps(dict(wanted=sorted(wanted),matches=matches,errors=errors),indent=2));print('DONE',len(matches))
