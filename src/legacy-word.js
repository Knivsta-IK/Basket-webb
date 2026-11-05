// Word 97–2003 text extraction using the MS-DOC piece table (FibRgFcLcb97.fcClx).
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01
export async function legacyWordText(bytes){
  const {default:CFB}=await import('cfb');
  const compound=CFB.read(bytes,{type:'buffer'});
  const word=CFB.find(compound,'WordDocument')?.content;
  if(!word||word.length<0x1aa)throw new Error('DOC-filen kunde inte läsas. Spara den som DOCX i Word och försök igen.');
  const data=Uint8Array.from(word),view=new DataView(data.buffer),flags=view.getUint16(0x0a,true);
  if(view.getUint16(0,true)!==0xa5ec||view.getUint16(2,true)<0xc1)throw new Error('Det här äldre Word-formatet stöds inte. Spara filen som DOCX först.');
  if(flags&0x0100)throw new Error('Word-filen är lösenordsskyddad. Spara en olåst kopia först.');
  const table=Uint8Array.from(CFB.find(compound,flags&0x0200?'1Table':'0Table')?.content||[]),tv=new DataView(table.buffer);
  const total=view.getUint32(0x4c,true);if(total>2_000_000)throw new Error('Word-dokumentet innehåller för mycket text.');
  let pos=view.getUint32(0x1a2,true);const length=view.getUint32(0x1a6,true),end=pos+length;
  if(end>table.length||!length)throw new Error('Texten i DOC-filen kunde inte läsas. Spara den som DOCX först.');
  while(pos<end&&table[pos]===1){if(pos+3>end)break;pos+=3+tv.getUint16(pos+1,true);}
  if(table[pos++]!==2||pos+4>end)throw new Error('DOC-filens texttabell stöds inte. Spara den som DOCX först.');
  const size=tv.getUint32(pos,true);pos+=4;const count=(size-4)/12;
  if(!Number.isInteger(count)||count<0||pos+size>end)throw new Error('DOC-filens texttabell är skadad.');
  let result='';
  for(let i=0;i<count;i++){
    const start=tv.getUint32(pos+4*i,true),next=tv.getUint32(pos+4*(i+1),true);if(start>=total)break;
    if(next<start)throw new Error('DOC-filens textordning är skadad.');
    const chars=Math.min(next,total)-start,fc=tv.getUint32(pos+4*(count+1)+8*i+2,true),compressed=!!(fc&0x40000000),offset=(fc&0x3fffffff)/(compressed?2:1),stop=offset+chars*(compressed?1:2);
    if(stop>data.length||!Number.isInteger(offset))throw new Error('DOC-filen saknar en del av texten.');
    result+=new TextDecoder(compressed?'windows-1252':'utf-16le').decode(data.subarray(offset,stop));
  }
  // Retain field results, omitting field instructions, embedded objects and non-text controls.
  const fields=[];let text='';for(const char of result){if(char==='\x13'){fields.push(false);continue;}if(char==='\x14'){if(fields.length)fields[fields.length-1]=true;continue;}if(char==='\x15'){fields.pop();continue;}if(fields.every(Boolean))text+=char;}
  return text.replace(/\x07/g,'\t').replace(/[\r\x0b\x0c]/g,'\n').replace(/[\x00-\x08\x0e-\x1f]/g,'').trim();
}
