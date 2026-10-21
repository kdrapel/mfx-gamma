// Cache simulation inputs before chapter frames. Every displayed target frame
// is rendered again; this contains no image playback or reference-output repair.
const fields=['frame','period','lastTick','nextTick','tickCount','drawTime','currentTime','exited'];
export function saveSequenceState(c){
 const f=c.machine.f;
 return {memory:c.memory.slice(),registers:{...c.machine.r},count:c.machine.count,
  clippedFlareRows:c.machine.clippedFlareRows??0,dac:structuredClone(c.dac),
  controller:Object.fromEntries(fields.map(k=>[k,c[k]])),
  fpu:{cw:f.cw,top:f.top,condition:f.condition,exceptions:f.exceptions,
   slots:f.slots.slice(),quality:f.quality.slice(),exact:structuredClone(f.exact),empty:[...f.empty]}};
}
export function restoreSequenceState(c,s){
 if(c.memory.length!==s.memory.length)throw Error('Seek memory size differs');
 c.memory.set(s.memory);c.machine.r={...s.registers};c.machine.count=s.count;
 c.machine.clippedFlareRows=s.clippedFlareRows;c.dac=structuredClone(s.dac);
 for(const k of fields)c[k]=s.controller[k];c.ports.length=0;
 const f=c.machine.f;for(const k of ['cw','top','condition','exceptions'])f[k]=s.fpu[k];
 f.slots.set(s.fpu.slots);f.quality.set(s.fpu.quality);
 f.exact=structuredClone(s.fpu.exact);f.empty=[...s.fpu.empty];
}
export function encodeSequenceState(s){
 const bytes=new Uint8Array(s.fpu.slots.buffer,s.fpu.slots.byteOffset,s.fpu.slots.byteLength);
 return JSON.stringify({...s,memory:undefined,fpu:{...s.fpu,slots:undefined,
  slot_bytes:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),quality:Array.from(s.fpu.quality)}},
  (_k,v)=>typeof v==='bigint'?{$bigint:String(v)}:v);
}
export function decodeSequenceState(text,memory){
 const s=JSON.parse(text,(_k,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$bigint==='string'?BigInt(v.$bigint):v);
 if(!/^[0-9a-f]{128}$/.test(s.fpu.slot_bytes))throw Error('Invalid checkpoint FPU bytes');
 const bytes=Uint8Array.from(s.fpu.slot_bytes.match(/../g),b=>parseInt(b,16));
 s.fpu.slots=new Float64Array(bytes.buffer);s.fpu.quality=Uint8Array.from(s.fpu.quality);s.memory=memory;return s;
}
export class SequenceSeek{
 constructor(controller,chapters,{cacheLimit=8,diskCheckpoints=[],loadCheckpoint}={}){
  this.controller=controller;this.starts=new Set(chapters.map(c=>c.frame-1));
  this.cacheLimit=cacheLimit;this.cache=new Map([[0,saveSequenceState(controller)]]);
  this.diskCheckpoints=diskCheckpoints;this.loadCheckpoint=loadCheckpoint;
 }
 remember(){
  const frame=this.controller.frame;if(!this.starts.has(frame)||this.cache.has(frame))return;
  this.cache.set(frame,saveSequenceState(this.controller));
  while(this.cache.size>this.cacheLimit){const key=[...this.cache.keys()].find(k=>k!==0);this.cache.delete(key);}
 }
 async seek(frame,{validate=async()=>{},progress=()=>{},cancelled=()=>false}={}){
  if(!Number.isInteger(frame)||frame<1||frame>this.controller.metadata.frames.length)throw Error('Invalid chapter frame');
  const target=frame-1;
  let nearest=Math.max(...[...this.cache.keys()].filter(k=>k<=target));
  const disk=this.diskCheckpoints.filter(c=>c.frame<=target).sort((a,b)=>b.frame-a.frame)[0];
  if(disk&&disk.frame>nearest){
   const state=await this.loadCheckpoint(disk);
   if(state.controller.frame!==disk.frame)throw Error('Checkpoint frame differs');
   this.cache.set(disk.frame,state);nearest=disk.frame;
   while(this.cache.size>this.cacheLimit){const key=[...this.cache.keys()].find(k=>k!==0&&k!==nearest);this.cache.delete(key);}
  }
  restoreSequenceState(this.controller,this.cache.get(nearest));
  while(this.controller.frame<target){
   if(cancelled())return null;
   this.remember();const result=this.controller.next();await validate(result);
   progress(result.seconds);
  }
  if(cancelled())return null;
  this.remember();const result=this.controller.next();await validate(result);return result;
 }
}
