using System;using System.IO;using System.Linq;using System.Reflection.Metadata;using System.Reflection.Metadata.Ecma335;using System.Reflection.PortableExecutable;
var b=File.ReadAllBytes(args[0]);using var pe=new PEReader(new MemoryStream(b));var reader=pe.GetMetadataReader();var rva=pe.PEHeaders.CorHeader!.MetadataDirectory.RelativeVirtualAddress;var section=pe.PEHeaders.SectionHeaders.First(s=>s.VirtualAddress<=rva&&rva<s.VirtualAddress+s.VirtualSize);var root=section.PointerToRawData+rva-section.VirtualAddress;var start=root+reader.GetTableMetadataOffset(TableIndex.AssemblyRef);var row=reader.GetTableRowSize(TableIndex.AssemblyRef);
for(int n=0;n<reader.AssemblyReferences.Count;n++){var p=start+n*row;if(BitConverter.ToUInt16(b,p)==10){b[p]=8;b[p+1]=0;}}
File.WriteAllBytes(args[1],b);
