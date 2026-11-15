"""Bounded v172 HIRC source/playlist reader. Unsupported topology stays unresolved."""
import struct, math

def objects(b):
 p=b.index(b'HIRC')+8;n=struct.unpack_from('<I',b,p)[0];p+=4;out=[]
 for _ in range(n):
  kind=b[p];size=struct.unpack_from('<I',b,p+1)[0];d=b[p+5:p+5+size]
  if len(d)!=size:raise ValueError('Truncated HIRC')
  out.append((kind,int.from_bytes(d[:4],'little'),d));p+=5+size
 return out

def music_sources(obs):
 out=[]
 for typ,oid,d in obs:
  if typ!=11:continue
  n=struct.unpack_from('<I',d,4)[0]
  if n>8:raise ValueError('Unsupported source count')
  for i in range(n):
   media,cache=struct.unpack_from('<II',d,13+18*i)
   out.append(dict(object=oid,type=typ,mediaId=media,cacheId=cache))
 return out

def music_plan(obs):
 tracks={oid:d for t,oid,d in obs if t==11};segments={oid:d for t,oid,d in obs if t==10};playlists=[d for t,oid,d in obs if t==13]
 if len(playlists)!=1:raise ValueError('Unsupported music playlist topology')
 d=playlists[0];nodes=None
 for count in range(2,32):
  pos=len(d)-30*count-4
  if pos>=0 and struct.unpack_from('<I',d,pos)[0]==count:
   rows=[struct.unpack_from('<IIIihhhIHBB',d,pos+4+i*30) for i in range(count)]
   if rows[0][0]==0 and rows[0][2]==count-1 and rows[0][3]==0 and all(x[0] in segments and x[2]==0 for x in rows[1:]):nodes=rows;break
 if nodes is None:raise ValueError('Unsupported random/nested music playlist')
 root_loop=nodes[0][4]
 if root_loop not in [0,1] or (root_loop==0 and len(nodes)!=2):raise ValueError('Unsupported repeating music root')
 result=[]
 for row in nodes[1:]:
  segment=segments[row[0]];children=[(oid,d) for oid,d in tracks.items() if struct.pack('<I',oid) in segment]
  if len(children)!=1:raise ValueError('Unsupported layered music segment')
  oid,d=children[0];pos=8+18*struct.unpack_from('<I',d,4)[0]+1
  if struct.unpack_from('<I',d,pos)[0]!=1:raise ValueError('Unsupported layered music clips')
  _,media,cache,event,play,begin,end,duration=struct.unpack_from('<IIII4d',d,pos+4)
  entry=struct.unpack_from('<d',segment,segment.index(bytes.fromhex('12df9802'))+4)[0]
  exit=struct.unpack_from('<d',segment,segment.index(bytes.fromhex('48d6bb5b'))+4)[0]
  if event or row[4] not in [0,1] or not all(math.isfinite(x) for x in [play,begin,end,duration,entry,exit]):raise ValueError('Unsupported music clip')
  # Initial finite pre-entry clips precede the looping segment. Main clips are
  # trimmed at authored exit cues (post-exit transition material is not looped).
  repeating=row[4]==0 or root_loop==0
  length=exit if entry==exit else exit-entry
  offset=max(0,begin + (0 if entry==exit else entry))
  result.append(dict(segment=row[0],track=oid,mediaId=media,cacheId=cache,offset=offset/1000,duration=length/1000,loop=repeating,rootLoopCount=root_loop,leafLoopCount=row[4],playAtMs=play,beginTrimMs=begin,endTrimMs=end,sourceDurationMs=duration,entryMs=entry,exitMs=exit))
 if not result or any(x['loop'] for x in result[:-1]):raise ValueError('Unsupported repeating music sequence')
 return result

def sound_props(d):
 n=d[35];ids=d[36:36+n];values=d[36+n:36+5*n]
 if len(values)!=4*n:raise ValueError('Unsupported sound properties')
 props={p:struct.unpack_from('<f',values,i*4)[0] for i,p in enumerate(ids)}
 loop=0x4a in props and struct.unpack_from('<i',values,ids.index(0x4a)*4)[0]==0
 return dict(mediaId=struct.unpack_from('<I',d,9)[0],loop=loop,gain=10**(props.get(0,0)/20),rate=2**(props.get(1,0)/1200))

def ambience_plan(obs):
 sounds={oid:d for t,oid,d in obs if t==2};containers={oid:(t,d) for t,oid,d in obs if t in [5,7,9]};known=set(sounds)|set(containers)
 layers=[(oid,d) for t,oid,d in obs if t==9]
 if len(layers)!=1:raise ValueError('Unsupported ambience root')
 def children(d):
  for pos in range(4,len(d)-3):
   n=struct.unpack_from('<I',d,pos)[0]
   if 1<=n<=64 and pos+4+4*n<=len(d):
    ids=list(struct.unpack_from('<'+'I'*n,d,pos+4))
    if len(set(ids))==n and all(x in known for x in ids):return pos,ids
  raise ValueError('Unsupported child list')
 continuous=[];random=[]
 _,roots=children(layers[0][1])
 for oid in roots:
  if oid in sounds:continuous.append(dict(object=oid,**sound_props(sounds[oid])));continue
  typ,d=containers[oid]
  if typ!=5:raise ValueError('Unsupported ambience child container')
  pos,ids=children(d)
  if pos<24 or any(x not in sounds for x in ids):raise ValueError('Unsupported nested ambience randomness')
  loop,minimum,maximum,delay,dmin,dmax,avoid,mode,randommode,sequence,flags=struct.unpack_from('<hhhfffHBBBB',d,pos-24)
  if loop!=0 or mode not in [1,3,5] or sequence!=0:raise ValueError('Unsupported ambience random scheduling')
  n=d[17];props=d[18:18+n];values=d[18+n:18+5*n]
  gain=10**(struct.unpack_from('<f',values,props.index(0)*4)[0]/20) if 0 in props else 1
  random.append(dict(object=oid,transitionMode=mode,delay=delay/1000,delayMin=dmin/1000,delayMax=dmax/1000,avoidRepeat=avoid,shuffle=bool(randommode),gain=gain,variants=[dict(object=x,**sound_props(sounds[x])) for x in ids]))
 return dict(continuous=continuous,random=random)
