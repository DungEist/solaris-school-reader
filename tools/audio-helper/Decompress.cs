using System;using System.IO;using OodleSharp;
var b=File.ReadAllBytes(args[0]);var d=new byte[int.Parse(args[2])];var n=OodleDecompressor.Decompress(b,d);if(n!=d.Length)throw new Exception("Oodle size mismatch: "+n);File.WriteAllBytes(args[1],d);
