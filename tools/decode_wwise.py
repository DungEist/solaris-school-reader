"""Decode installed Wwise Opus WEM (0x3041) with the system libopus.
PCM sample count and encoder pre-skip are taken from the authored RIFF fmt.
"""
import ctypes, struct, wave
from pathlib import Path
opus=ctypes.CDLL('libopus.so.0')
opus.opus_decoder_create.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.POINTER(ctypes.c_int)];opus.opus_decoder_create.restype=ctypes.c_void_p
opus.opus_decode.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_int,ctypes.c_int];opus.opus_decode.restype=ctypes.c_int
opus.opus_decoder_destroy.argtypes=[ctypes.c_void_p]
def chunks(b):
 assert b[:4]==b'RIFF' and b[8:12]==b'WAVE'
 p=12;d={}
 while p+8<=len(b):
  tag=b[p:p+4];n=struct.unpack_from('<I',b,p+4)[0];d[tag]=b[p+8:p+8+n];p+=8+n+(n%2)
 return d
def decode(b,out):
 d=chunks(b);f=d[b'fmt '];codec,ch,rate=struct.unpack_from('<HHI',f);assert codec==0x3041,(hex(codec),ch,rate)
 samples,count,skip,version,mapping=struct.unpack_from('<IIHBB',f,24);assert mapping==0 and ch in (1,2) and version==1
 sizes=struct.unpack('<'+'H'*count,d[b'seek']);assert sum(sizes)==len(d[b'data'])
 err=ctypes.c_int();decoder=opus.opus_decoder_create(rate,ch,ctypes.byref(err));assert err.value==0
 result=[];p=0
 try:
  for size in sizes:
   packet=d[b'data'][p:p+size];p+=size;pcm=(ctypes.c_int16*(5760*ch))();n=opus.opus_decode(decoder,packet,size,pcm,5760,0);assert n>0,n;result.append(bytes(pcm)[:n*ch*2])
 finally:opus.opus_decoder_destroy(decoder)
 pcm=b''.join(result)[skip*ch*2:(skip+samples)*ch*2];assert len(pcm)==samples*ch*2
 with wave.open(str(out),'wb') as w:w.setnchannels(ch);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm)
 return dict(codec='Wwise Opus 0x3041',channels=ch,sampleRate=rate,samples=samples,preSkip=skip,duration=samples/rate)
if __name__=='__main__':
 import sys
 print(decode(Path(sys.argv[1]).read_bytes(),sys.argv[2]))
