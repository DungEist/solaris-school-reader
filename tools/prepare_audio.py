"""Project only SolarSchool audio, preserving unresolved references separately.
Requires the read-only pak inventory and local key; copies no unrelated audio.
"""
from pathlib import Path
import json,struct,hashlib,subprocess,sys,collections
from wwise_sources import Pak,load_pak_keys
from decode_wwise import decode
from wwise_bank import objects, music_sources, music_plan, sound_props, ambience_plan
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/audio';OUT.mkdir(parents=True,exist_ok=True);WORK=ROOT/'asset-work/audio';WORK.mkdir(parents=True,exist_ok=True)
r=json.load(open(sys.argv[1]))['records'];key=load_pak_keys(sys.argv[2])
def priority(row):
 p=Path(row['pak']);patch='/Base/' not in str(p) and '/Content/Paks/' not in str(p);v=p.parent.name.split('.');return (patch,tuple(int(x) for x in v if x.isdigit()))
byname={}
for row in sorted(r,key=priority):byname[row['name']]=row
banks={};media={};paks={};assets={};unresolved={}
for name,row in byname.items():
 if name.endswith('.bnk'):banks.setdefault(Path(name).stem,[]).append(row)
 if name.endswith('.wem'):media.setdefault(Path(name).stem,[]).append(row)
def extract(row):
 pak=paks.get(row['pak'])
 if not pak:
  if len(paks)>8:paks.clear()
  pak=paks[row['pak']]=Pak(row['pak'],key)
 return pak.extract(row['name'])
def install(row):
 identity=row['name'];token=hashlib.sha256(identity.encode()).hexdigest()[:20]
 if token in assets:return token
 wem=WORK/(token+'.wem');mp3=OUT/(token+'.mp3');metadata=WORK/(token+'.source.json')
 stat=Path(row['pak']).stat();identity=dict(name=row['name'],pak=row['pak'],pakSize=stat.st_size,pakMtimeNs=stat.st_mtime_ns,entry={k:row.get(k) for k in ['offset','size','compressed','compression','encrypted','custom']})
 saved=json.loads(metadata.read_text()) if metadata.exists() else {}
 b=wem.read_bytes() if wem.exists() else b''
 if saved.get('identity')!=identity or saved.get('wemSha256')!=hashlib.sha256(b).hexdigest():
  b=extract(row);wem.write_bytes(b)
 wav=WORK/(token+'.wav');facts=decode(b,wav)
 encoder='libmp3lame-q3-v1'
 if not mp3.exists() or saved.get('wemSha256')!=hashlib.sha256(b).hexdigest() or saved.get('encoder')!=encoder or saved.get('mp3Sha256')!=hashlib.sha256(mp3.read_bytes()).hexdigest():subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-codec:a','libmp3lame','-q:a','3',str(mp3)],check=True)
 metadata.write_text(json.dumps(dict(identity=identity,wemSha256=hashlib.sha256(b).hexdigest(),encoder=encoder,mp3Sha256=hashlib.sha256(mp3.read_bytes()).hexdigest())))
 wav.unlink()
 assets[token]=dict(url='assets/audio/'+mp3.name,source=row['name'],pak=row['pak'],wemSha256=hashlib.sha256(b).hexdigest(),sha256=hashlib.sha256(mp3.read_bytes()).hexdigest(),**facts)
 return token
scripts={p.stem:json.load(p.open()) for p in (ROOT/'public/data/scripts').glob('*.json')}
cues=json.load(open(ROOT/'public/data/maps/audio.json'));events={'__ambience_silence__':dict(kind='ambience',action='silence')};bankfacts={}
aliasfile=ROOT/'test-results/audio/music-aliases.json'
aliases=collections.defaultdict(list)
if aliasfile.exists():
 for match in json.load(aliasfile.open())['matches']:aliases[match['cacheId']].append(match)
for cue in cues:
 kind='music' if 'music' in cue else 'ambience' if cue.startswith('play_amb') else 'voice' if cue.startswith('play_vo') else 'effects'
 if cue.startswith('stop_'):events[cue]=dict(kind=kind,action='stop',target=cue.replace('stop_','play_',1));continue
 if cue in ['play_avg_music_3_8_slience','play_vo_silence_placeholder']:events[cue]=dict(kind=kind,action='silence');continue
 rows=banks.get(cue,[]);variants={};facts=[];clips=None;layers=None;settings={}
 for row in rows:
  lang=Path(row['name']).parent.name;lang=lang if lang in ['ja','en','ko','zh'] else 'default'
  try:
   b=extract(row);(WORK/(cue+'-'+lang+'.bnk')).write_bytes(b);obs=objects(b);ids=[];loops=False;sourceFacts=[]
   for typ,oid,d in obs:
    if typ==2:
     mid=struct.unpack_from('<I',d,9)[0];ids.append(mid)
     # v172 Sound NodeBase: empty effect lists + parent + flags, then property bundle.
     if len(d)>36 and d[22:26]==bytes(4):
      n=d[35];props=list(d[36:36+n]);vals=d[36+n:36+n+n*4]
      if len(vals)==n*4 and 0x4a in props:loops=struct.unpack_from('<i',vals,props.index(0x4a)*4)[0]==0
     sourceFacts.append(dict(object=oid,type=typ,mediaId=mid))
    if typ==11:
     n=struct.unpack_from('<I',d,4)[0];assert n<=8
     for i in range(n):
      mid=struct.unpack_from('<I',d,13+18*i)[0];ids.append(mid);sourceFacts.append(dict(object=oid,type=typ,mediaId=mid))
   plan=music_plan(obs) if kind=='music' else None
   if plan:ids=[x['mediaId'] for x in plan];sourceFacts=music_sources(obs)
   installed=[];resolved={};aliasfacts=[]
   for mid in dict.fromkeys(ids):
    candidates=media.get(str(mid),[]);candidate=next((m for m in candidates if Path(m['name']).parent.name==lang),None) or next((m for m in candidates if Path(m['name']).parent.name=='Media'),None)
    if not candidate and plan:
     cache=next(x['cacheId'] for x in plan if x['mediaId']==mid)
     matches=aliases[cache];mids={x['mediaId'] for x in matches}
     if len(mids)==1:
      candidate=next((m for m in media.get(str(next(iter(mids))),[]) if Path(m['name']).parent.name=='Media'),None)
      if candidate:aliasfacts.append(dict(requestedMediaId=mid,cacheId=cache,resolvedMediaId=next(iter(mids)),evidence=matches))
     elif len(mids)>1:
      alternatives=[next((m for m in media.get(str(x),[]) if Path(m['name']).parent.name=='Media'),None) for x in sorted(mids)]
      if all(alternatives):
       hashes={hashlib.sha256(extract(m)).hexdigest() for m in alternatives}
       if len(hashes)==1:
        candidate=alternatives[0];aliasfacts.append(dict(requestedMediaId=mid,cacheId=cache,identicalWemSha256=next(iter(hashes)),resolvedMediaIds=sorted(mids),evidence=matches))
    if candidate:
     token=install(candidate);installed.append(token);resolved[mid]=token
    else:raise ValueError('media '+str(mid)+' absent for '+lang)
   if plan:clips=[dict(asset=resolved[x['mediaId']],offset=x['offset'],duration=x['duration'],loop=x['loop']) for x in plan]
   for typ,oid,d in obs:
    if typ==2:
     setting=sound_props(d);settings[resolved[setting.pop('mediaId')]]=setting
   if kind=='ambience':
    layered=ambience_plan(obs)
    def project(layer):return dict(asset=resolved[layer['mediaId']],loop=layer['loop'],gain=layer['gain'],rate=layer['rate'])
    layers=dict(continuous=[project(x) for x in layered['continuous']],random=[dict(**{k:v for k,v in x.items() if k not in ['object','variants']},variants=[project(y) for y in x['variants']]) for x in layered['random']])
   if installed:variants[lang]=installed
   else:raise ValueError('no supported Sound/MusicTrack source in bank')
   facts.append(dict(bank=row['name'],pak=row['pak'],sha256=hashlib.sha256(b).hexdigest(),sources=sourceFacts,loop=loops,objectTypes=[o[0] for o in obs],musicPlan=plan,mediaAliases=aliasfacts))
  except Exception as ex:unresolved[cue+':'+lang]=str(ex) or type(ex).__name__
 if variants:
  events[cue]=dict(kind=kind,action='play',variants=variants,loop=kind in ['ambience','music'] or any(x['loop'] for x in facts),sequence=kind=='music')
  if clips:events[cue]['clips']=clips
  if clips:events[cue]['loop']=clips[-1]['loop']
  if layers:events[cue]['layers']=layers
  if settings:events[cue]['assetSettings']=settings
 else:unresolved[cue]=unresolved.get(cue+':default','No installed event bank')
 bankfacts[cue]=facts
 print('event',cue,len(variants),flush=True)
# Only authored PlayVoice=true lines use the PlotAudio lookup.
source={f['StateKey']:json.loads(f['Actions'] or '[]') for f in json.load(open(ROOT/'WutheringWaves_Data/BinData/flowState/flowstate.json')) if '索拉学院' in f['StateKey']}
plot={r['Id']:r for r in json.load(open(ROOT/'WutheringWaves_Data/BinData/plot_audio/plotaudio.json'))};lines={};linefacts={};langs=['ja','en','zh','ko']
for sid,s in scripts.items():
 raw={n['Id']:n for a in source[s['stateKey']] for n in a.get('Params',{}).get('TalkItems',[])}
 for n in s['nodes']:
  rn=raw.get(n['nid'],{});tk=n.get('textKey');pa=plot.get(tk)
  if not rn.get('PlayVoice') or not pa:continue
  variants={}
  for lang in langs:
   actual='gl' if pa['GlobalLanguage'] else lang;gender=pa.get('CheckGender'+lang.capitalize(),False)
   for g in ['male','female'] if gender else ['any']:
    filename=actual+'_'+pa['FileName']+('_M' if g=='male' else '_F' if g=='female' else '')
    if pa.get('VarParams'):unresolved['line:'+tk]='Dynamic VarParams require state mapping';continue
    row=next(iter(media.get(filename,[])),None)
    if row:
     try:variants[lang+':'+g]=install(row)
     except Exception as ex:unresolved['line:'+tk+':'+lang]=str(ex)
  if variants:lines[sid+':'+str(n['nid'])]=dict(textKey=tk,variants=variants)
  else:unresolved['line:'+tk]='PlotAudio exists but no installed playable voice media'
  linefacts[tk]=pa
roles=json.load(open(ROOT/'WutheringWaves_Data/BinData/SolarSchool/solarschoolrolespine.json'))
locations=json.load(open(ROOT/'WutheringWaves_Data/BinData/SolarSchool/solarschoollocation.json'))
manifest=dict(schema=1,languages=sorted({l.split(':')[0] for x in lines.values() for l in x['variants']}|{l for e in events.values() for l in e.get('variants',{}) if l!='default'}),events=events,assets=assets,lines=lines,roleSpines={str(r['Id']):r for r in roles},locationAmbience={str(r['Id']):r['Abient'] for r in locations},unresolved=unresolved)
manifest['unresolvedEvents']={c:dict(kind='music' if 'music' in c else 'ambience' if c.startswith('play_amb') else 'voice' if c.startswith('play_vo') else 'effects',reason=unresolved[c]) for c in cues if c not in events}
for path in OUT.glob('*.mp3'):
 if path.stem not in assets:path.unlink()
(ROOT/'public/data/maps/audio-playback.json').write_text(json.dumps(manifest,separators=(',',':')))
(ROOT/'test-results/audio/source-resolution.json').write_text(json.dumps(dict(cues=len(cues),events=len(events),assets=len(assets),lines=len(lines),languages=manifest['languages'],banks=bankfacts,plotAudio=linefacts,unresolved=unresolved),indent=2))
print('DONE',len(events),len(assets),len(lines),'unresolved',len(unresolved))
