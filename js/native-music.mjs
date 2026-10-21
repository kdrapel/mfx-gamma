import {FastMachine} from './fast-machine.mjs';
import {createGusPcmDevice} from './gus-pcm-device.mjs';
export const PIT_RATE=1193182,AUDIO_RATE=48000,PLAYER_BASE=0x173944;
// Original upload/reset/consumer/tracker code, with the explicitly enabled GUS
// candidate already checked by the offline oracle. Graphics keep their own RAM.
export class NativeMusic{
 constructor(memory,metadata,plan,{record_ports=false,on_port}={}){
  this.memory=memory;this.metadata=metadata;this.plan=plan;
  this.device=createGusPcmDevice(AUDIO_RATE,{record_ports,on_port});
  this.fixture={initial_cw:0x7f,record:false,trace_state:false,read_ranges:[[0,memory.length]],
   write_ranges:metadata.write_ranges.map(([lo,hi])=>[lo,hi-lo]),portIn:this.device.portIn,portOut:this.device.portOut};
  this.machine=new FastMachine(memory,metadata.initial_registers,this.fixture);
  this.elapsedCounts=0;this.tickCount=0;
 }
 execute(entry,stop,registers={}){
  for(const [name,value]of Object.entries(registers))this.machine.setReg(name,value);
  this.fixture.instruction_limit=this.machine.count+500000;
  return this.machine.run({...this.plan,entry,stop});
 }
 initialize(){
  for(const phase of this.metadata.initialization)this.execute(phase.entry,phase.stop,phase.registers);
  this.initialPeriod=this.machine.read(PLAYER_BASE+0x41);this.intervalCounts=this.initialPeriod;
  if(this.initialPeriod<1||this.initialPeriod>65535)throw Error('Unsupported initial music timer');
 }
 tick(){
  this.execute(0x17e47,0x17e51,{esi:PLAYER_BASE,ebp:PLAYER_BASE});this.tickCount++;
 }
 // Used only for the oracle's named call-at-zero convention.
 referenceInterval(){const period=this.machine.read(PLAYER_BASE+0x41);this.tick();return this.device.advancePit(period);}
 // First IRQ occurs after one timer interval, exactly as in OpeningSequence.
 // A changed reload takes effect after the already scheduled next interrupt.
 interval(){
  const samples=this.device.advancePit(this.intervalCounts);this.elapsedCounts+=this.intervalCounts;
  const periodBefore=this.machine.read(PLAYER_BASE+0x41);
  if(periodBefore<1||periodBefore>65535)throw Error('Unsupported music timer period');
  this.tick();this.intervalCounts=periodBefore;return samples;
 }
 control(){return {tick:this.tickCount,time_counts:this.elapsedCounts,next_tick_counts:this.elapsedCounts+this.intervalCounts,
  order:this.machine.read(PLAYER_BASE+0x12),row:this.machine.read(PLAYER_BASE+6),tick_in_row:this.machine.read(PLAYER_BASE+3,1),
  speed:this.machine.read(PLAYER_BASE+4,1),period:this.machine.read(PLAYER_BASE+0x41)};}
}
