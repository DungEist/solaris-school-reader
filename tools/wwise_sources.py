"""Read-only WuWa v12 pak inventory and selected SHA1-verified extraction.
The local AES key is supplied as a file, never included in output.
"""
from pathlib import Path
import struct, hashlib, json, zlib, os
from Crypto.Cipher import AES
def load_pak_keys(path):
 b=Path(path).read_bytes()
 if len(b)==32:return b
 data=json.loads(b)
 keys={str(row['guid']).replace('-','').upper():bytes.fromhex(row['key'].removeprefix('0x')) for row in data.get('dynamicKeys',[])}
 keys['0'*32]=bytes.fromhex(data['mainKey'].removeprefix('0x'))
 if any(len(value)!=32 for value in keys.values()):raise ValueError('Pak keys must contain 32 bytes')
 return keys
class Reader:
 def __init__(self,b):self.b=b;self.p=0
 def read(self,n):x=self.b[self.p:self.p+n];self.p+=n;assert len(x)==n;return x
 def num(self,f):return struct.unpack('<'+f,self.read(struct.calcsize('<'+f)))[0]
 def string(self):
  n=self.num('i');assert abs(n)<10000;return self.read(abs(n)*(2 if n<0 else 1)).decode('utf-16le' if n<0 else 'utf8').rstrip('\0')
class Pak:
 def __init__(self,path,key):
  self.path=Path(path)
  with self.path.open('rb') as f:f.seek(-512,2);tail=f.read()
  p=tail.rfind(bytes.fromhex('e1126f5a'));assert p>=0
  self.guid=''.join(f'{word:08X}' for word in struct.unpack_from('<4I',tail,p-17))
  self.key=key.get(self.guid) if isinstance(key,dict) else key if self.guid=='0'*32 else None
  if self.key is None:raise ValueError(f'Missing pak encryption key for GUID {self.guid}')
  self.version,o,s=struct.unpack_from('<Iqq',tail,p+4);assert self.version==12
  self.encrypted=tail[p-1]!=0
  primary=self.block(o,s);r=Reader(primary);self.mount=r.string();self.count=r.num('i');r.read(8)
  indexes=[]
  for kind in ['hash','directory']:
   if r.num('i'):indexes.append((kind,r.num('q'),r.num('q'),r.read(20)))
  encoded=r.read(r.num('i'));self.encoded=encoded
  directory=next(i for i in indexes if i[0]=='directory');d=self.block(directory[1],directory[2]);assert hashlib.sha1(d).digest()==directory[3]
  rd=Reader(d);self.entries={}
  for _ in range(rd.num('i')):
   folder=rd.string()
   for _ in range(rd.num('i')):
    name=folder+rd.string();offset=rd.num('i')
    if offset>=0:self.entries[(self.mount+name).removeprefix('../../../')]=offset
 def block(self,o,s):
  with self.path.open('rb') as f:f.seek(o);b=f.read(s)
  return AES.new(self.key,AES.MODE_ECB).decrypt(b) if self.encrypted else b
 def entry(self,name):
  r=Reader(self.encoded);r.p=self.entries[name];raw=r.num('I');f=((raw>>16)&63)|((raw&65535)<<6)|((raw&0x10000000)>>6)|((raw&0xfc00000)<<1)|((raw&0xc0000000)>>1)|((raw&0x20000000)<<2);custom=r.num('B')
  bs=r.num('I') if f&63==63 else (f&63)<<11
  a=r.num('I' if f&0x80000000 else 'Q');b=r.num('I' if f&0x40000000 else 'Q');o,size=b,a
  comp=(f>>23)&63;csize=r.num('I' if f&0x20000000 else 'Q') if comp else size
  encrypted=bool(f&0x400000);count=(f>>6)&65535
  return dict(offset=o,size=size,compressed=csize,compression=comp,encrypted=encrypted,custom=custom,blocks=count,blockSize=bs)
 def extract(self,name):
  e=self.entry(name);o=e['offset'];stored=[];limit={0:2**31-1,1:2097152,2:2048,4:0}[e['custom']]
  import subprocess, tempfile
  with self.path.open('rb') as f:
   f.seek(o);header=f.read(128)
   if e['compression']:
    count=struct.unpack_from('<I',header,48)[0];chunks=[]
    for i in range(count):
     start,end=struct.unpack_from('<QQ',header,52+16*i);f.seek(o+start);b=f.read((end-start+15)//16*16 if e['encrypted'] else end-start)
     stored.append(b);n=min(len(b),limit)//16*16
     if e['encrypted']:b=AES.new(self.key,AES.MODE_ECB).decrypt(b[:n])+b[n:]
     limit-=n
     b=b[:end-start]
     with tempfile.TemporaryDirectory(prefix='solar-oodle-') as d:
      src=Path(d)/'in';dst=Path(d)/'out';src.write_bytes(b)
      size=min(e['size'] if count==1 else e['blockSize'],e['size']-sum(map(len,chunks)))
      helper=os.environ.get('SOLARSCHOOL_OODLE_HELPER',str(Path(__file__).resolve().parents[1]/'asset-work/audio-tools/Decompress.dll'))
      subprocess.run(['dotnet',helper,str(src),str(dst),str(size)],check=True,capture_output=True)
      chunks.append(dst.read_bytes())
    b=b''.join(chunks)
   else:
    # custom=4 uses a padded 64-byte header, independently SHA1 checked.
    f.seek(o+(64 if e['custom']==4 else 53));b=f.read((e['size']+15)//16*16 if e['encrypted'] else e['size'])
    stored.append(b[:e['size']]);n=min(len(b),limit)//16*16
    if e['encrypted']:b=AES.new(self.key,AES.MODE_ECB).decrypt(b[:n])+b[n:]
  b=b[:e['size']]
  # UE hashes compressed/encrypted stored bytes, including alignment padding.
  assert hashlib.sha1(b''.join(stored)[:{0:2**31-1,1:2097152,2:2048,4:2**31-1}[e['custom']]]).digest()==header[28:48],(name,e,'stored SHA1 mismatch')
  return b
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('game');p.add_argument('--key-file',required=True,help='Private 32-byte main key or JSON mainKey/dynamicKeys keyring');p.add_argument('--output',required=True);a=p.parse_args();key=load_pak_keys(a.key_file);records=[];errors=[]
 for path in sorted(Path(a.game).rglob('*.pak')):
  if not path.name.startswith('pakchunk'):continue
  try:
   pak=Pak(path,key)
   for name in pak.entries:
    if name.endswith(('.wem', '.bnk')):records.append(dict(pak=str(path),name=name,**pak.entry(name)))
  except Exception as ex:errors.append(dict(pak=str(path),error=str(ex)))
 Path(a.output).write_text(json.dumps(dict(records=records,errors=errors),indent=1));print(len(records),'audio members;',len(errors),'pak errors')
