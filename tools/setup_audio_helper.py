"""Reuse OodleSharp from the operator's local FModel .NET bundle, offline.
No key, game file, native decoder, or unrelated FModel assembly is published.
"""
import argparse,json,struct,zlib,subprocess,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('fmodel');p.add_argument('--output',default=str(ROOT/'asset-work/audio-tools'));a=p.parse_args()
exe=Path(a.fmodel).read_bytes();sig=bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae');pos=struct.unpack_from('<q',exe,exe.index(sig)-8)[0]
major,minor,count=struct.unpack_from('<III',exe,pos);pos+=12
assert major==6,'Only the inspected .NET v6 bundle is supported'
def string():
 global pos
 n=0;shift=0
 while True:
  b=exe[pos];pos+=1;n|=(b&127)<<shift
  if not b&128:break
  shift+=7
 value=exe[pos:pos+n].decode();pos+=n;return value
bundle=string();pos+=40;member=None
for _ in range(count):
 off,size,compressed,kind=struct.unpack_from('<qqqB',exe,pos);pos+=25;name=string()
 if name=='OodleSharp.dll':member=dict(offset=off,size=size,compressed=compressed,kind=kind)
assert member,'OodleSharp not found in local FModel'
raw=exe[member['offset']:member['offset']+(member['compressed'] or member['size'])]
if member['compressed']:raw=zlib.decompress(raw,-15)
assert len(raw)==member['size']
out=Path(a.output);out.mkdir(parents=True,exist_ok=True);original=out/'OodleSharp.original.dll';original.write_bytes(raw)
sdks=subprocess.check_output(['dotnet','--list-sdks'],text=True).splitlines();line=next(x for x in reversed(sdks) if x.startswith('8.'))
version,location=line.split(' ',1);sdk=Path(location.strip('[]'))/version
refs=next((sdk.parents[1]/'packs/Microsoft.NETCore.App.Ref').glob('8.*/ref/net8.0'))
runtime=subprocess.check_output(['dotnet','--list-runtimes'],text=True).splitlines();rt=next(x.split()[1] for x in runtime if x.startswith('Microsoft.NETCore.App 8.'))
config=json.dumps(dict(runtimeOptions=dict(tfm='net8.0',framework=dict(name='Microsoft.NETCore.App',version=rt))))
def compile(name,extra=[]):
 dest=out/(name+'.dll');rsp=out/(name+'.rsp')
 rsp.write_text('\n'.join(['-nologo','-target:exe','-nullable:enable','-out:'+str(dest)]+['-r:'+str(x) for x in refs.glob('*.dll')]+['-r:'+str(x) for x in extra]+[str(ROOT/'tools/audio-helper'/('PatchReferences.cs' if name=='PatchReferences' else 'Decompress.cs'))]))
 subprocess.run(['dotnet',str(sdk/'Roslyn/bincore/csc.dll'),'@'+str(rsp)],check=True)
 (out/(name+'.runtimeconfig.json')).write_text(config);return dest
patch=compile('PatchReferences');decoder=out/'OodleSharp.dll';subprocess.run(['dotnet',str(patch),str(original),str(decoder)],check=True)
compile('Decompress',[decoder])
(out/'provenance.json').write_text(json.dumps(dict(fmodel=str(Path(a.fmodel).resolve()),fmodelSha256=hashlib.sha256(exe).hexdigest(),bundle=bundle,member=member,originalSha256=hashlib.sha256(raw).hexdigest(),patchedSha256=hashlib.sha256(decoder.read_bytes()).hexdigest(),referencePatch='AssemblyRef framework major version 10 -> 8; decompressor code unchanged'),indent=2))
print('Offline helper ready:',out/'Decompress.dll')
