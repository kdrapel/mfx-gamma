import {IntersectionMachine} from './intersection-machine.mjs';
import {createFrozenDevices} from './frozen-devices.mjs';
const BASE=0x173944,GPRS=['eax','ebx','ecx','edx','esi','edi','ebp','esp','eip','eflags'];
export class OpeningSequence{
 constructor(memory,metadata,callbacks={}){
  this.metadata=metadata;this.memory=memory;this.frame=0;this.period=21311;this.lastTick=0;this.nextTick=21311;this.tickCount=0;
  this.dac=structuredClone(metadata.dac_input);this.ports=[];this.recordPorts=metadata.record_ports!==false;
  this.fixture={initial_cw:0x7f,record:false,trace_state:false,read_ranges:[[0,memory.length]],
   write_ranges:metadata.write_ranges.map(([lo,hi])=>[lo,hi-lo]),flare_clip_empty:metadata.flare_clip_empty??false,...callbacks};
  this.machine=new IntersectionMachine(memory,metadata.initial_registers,this.fixture);
 }
 context(){return Object.fromEntries(GPRS.map(name=>[name,this.machine.r[name]]));}
 setContext(values){for(const [name,value]of Object.entries(values))this.machine.setReg(name,value);}
 execute(entry,stop,limit=12000000,values){
  if(values)this.setContext(values);this.fixture.instruction_limit=this.machine.count+limit;
  return this.machine.run({...this.metadata.plan,entry,stop});
 }
 initialize(){
  // The flare lookup image occupies 0x244ee8..0x276ee8. Use the lower
  // half of the existing 0x2a8000..0x2aa000 stack allocation, below the
  // suspended main frame. A scratch stack at 0x26fff0 corrupts that image.
  const saved=this.context();this.execute(0x144db,0x144e0,200000,{eax:0x80000000,ebx:BASE,esi:0x177944,esp:0x2a8ff0});
  if(this.machine.r.eax!==1)throw new Error('Original silent module loader failed');
  this.execute(0x17d43,0x17dad,100000,{eax:0,ebp:BASE,esi:BASE,esp:BASE+0x2daa});this.setContext(saved);
  this.period=this.machine.read(BASE+0x41);this.nextTick=this.period;this.execute(0x145c5,0x145db);
 }
 hostWrite(address,value){
  if(this.machine.read(address)===value)return;const pc=this.machine.r.eip;this.machine.r.eip=0;
  try{this.machine.write(address,value);}finally{this.machine.r.eip=pc;}
 }
 next(){
  if(this.frame>=this.metadata.target_times.length)return null;
  return this.renderAt(this.metadata.target_times[this.frame],this.frame+1<this.metadata.target_times.length);
 }
 minimumTime(){return Math.ceil(Math.fround((this.drawTime??0)+30000));}
 renderAt(now,continueSequence=true){
  if(!Number.isInteger(now)||now<30000)throw new Error('Invalid opening time');
  // The original main loop waits until its own accumulated draw time plus the
  // 30,000-count minimum has elapsed. The modeled PIT countdown is frozen for a
  // draw, so a requested target below that would spin in the original wait loop
  // instead of advancing time; advance to the earliest satisfiable time.
  const earliest=this.minimumTime();if(now<earliest)now=earliest;
  if(now<=(this.currentTime??0))throw new Error('Invalid opening time');
  this.currentTime=now;const saved=this.context();
  while(this.nextTick<=now){
   this.period=this.machine.read(BASE+0x41);if(this.period<1||this.period>65535)throw new Error('Opening clock requires unsplit PIT period');
   try{this.execute(0x17e47,0x17e51,100000,{ebp:BASE,esi:BASE,esp:BASE+0x2daa});}
   catch(e){throw new Error(`${e.message} in tracker tick ${this.tickCount+1} at ${now} counts`);}
   this.lastTick=this.nextTick;this.nextTick+=this.period;this.tickCount++;
  }
  this.setContext(saved);this.hostWrite(BASE+0x35,this.period);this.hostWrite(BASE+0x39,this.lastTick);this.hostWrite(BASE+0x4b,this.lastTick);
  const devices=createFrozenDevices({pit_count:this.nextTick-now,dac:this.dac,record_ports:this.recordPorts,on_port:this.fixture.onPort});
  this.fixture.portIn=(...args)=>{const value=devices.portIn(...args);if(this.recordPorts)this.ports.push(devices.ports.at(-1));return value;};
  this.fixture.portOut=(...args)=>{devices.portOut(...args);if(this.recordPorts)this.ports.push(devices.ports.at(-1));};
  try{this.execute(0x145db,0x15339,200000000);}
  catch(e){throw new Error(`${e.message} in scene draw ${this.frame+1} at ${now} counts`);}
  this.dac=devices.dac;this.frame++;
  const view=this.machine.view,exited=this.machine.read(0x1706d4)!==0;this.drawTime=view.getFloat32(this.machine.r.ebp-0x38,true);
  const result={frame:this.frame,time_counts:now,seconds:now/1193182,instructions:this.machine.count,
   scene_time_rows:view.getFloat32(0x223d04,true),order:this.machine.read(BASE+0x12),row:this.machine.read(BASE+6),
   script_pointer:this.machine.read(0x223cf4),exited,indices:this.memory.slice(0xa3200,0xafa00),palette:structuredClone(this.dac.palette)};
  if(exited){this.exited=true;return result;}
  // The next invocation starts at the next main-loop entry; retain every tail
  // update now, including the original keyboard/exit check.
  if(continueSequence)try{this.execute(0x15339,0x145db);}
  catch(e){throw new Error(`${e.message} in frame tail ${this.frame} at ${now} counts`);}
  return result;
 }
}
