import {createGusVoiceDevice} from './gus-voice-device.mjs';
// Named fixed-48000, 8-bit profile. Polling completes stop ramps synchronously.
// This is a device candidate, not a DOSBox capture or analog-output claim.
const PAN=[0,13,26,41,57,72,94,116,141,169,203,244,297,372,500,4095],GAIN=new Int32Array(4096);
let gain=8192;for(let i=4095;i>=0;i--){GAIN[i]=Math.trunc(gain);gain/=1.002709201;}
export function createGusPcmDevice(rate=48000,options){
 if(rate!==48000)throw new Error('Only fixed-48000 profile is established');
 const device=createGusVoiceDevice(options),state=device.state;
 Object.assign(state,{wave_q9:Array(32).fill(0),ramp_q10:Array(32).fill(0),frames:0,pit_remainder:0,sample_rate:rate});
 const originalOut=device.portOut,originalIn=device.portIn;
 function portOut(pc,port,size,value){
  originalOut(pc,port,size,value);if(![0x324,0x325].includes(port)||state.selected>=14)return;
  const v=state.voice,r=state.voices[v];
  if([10,11].includes(state.selected))state.wave_q9[v]=(r[10]&8191)*65536+r[11];
  else if(state.selected===9)state.ramp_q10[v]=r[9]*64;
 }
 function portIn(pc,port,size){
  if(port===0x325&&size===1&&state.selected===0x8d){const v=state.voice,r=state.voices[v],mode=r[13]>>>8;
   if(!(mode&3)){state.ramp_q10[v]=(r[mode&64?7:8]>>>8)*16384;r[9]=state.ramp_q10[v]>>>6;r[13]|=256;}}
  return originalIn(pc,port,size);
 }
 function render(length){
  const output=new Int16Array(length*2),active=1+((state.global_registers[14]>>>8)&31);
  if(active<14||active>32)throw new Error('Unsupported GUS voice clock');
  const base=Math.floor(0.5+1000000/(1.619695497*active));
  for(let n=0;n<length;n++){
   let left=0,right=0;
   if((state.global_registers[0x4c]&0x300)===0x300)for(let v=0;v<active;v++){
    const r=state.voices[v];let mode=r[0]>>>8,control=r[13]>>>8;
    if((mode&0x24)||(control&0x2c))throw new Error('Unsupported 16-bit/IRQ/rollover/ramp-loop PCM mode');
    let position=state.wave_q9[v];const index=(position>>>9)&0xfffff,fraction=position&511;
    const a=(device.ram[index]<<24>>24)*256,b=(device.ram[(index+1)&0xfffff]<<24>>24)*256;
    const sample=a+Math.floor((b-a)*fraction/512),volume=state.ramp_q10[v]>>>10,pan=(r[12]>>>8)&15;
    left+=sample*GAIN[Math.max(0,volume-PAN[pan]*2)];right+=sample*GAIN[Math.max(0,volume-PAN[15-pan]*2)];
    if(!(mode&3)){
     const start=(r[2]&8191)*65536+r[3],end=(r[4]&8191)*65536+r[5],step=Math.floor((r[1]>>>1)*base/rate);
     position=(position+(mode&64?-step:step))>>>0;const crossed=mode&64?position<start:position>end;position&=0x1fffffff;
     if(crossed){const extra=mode&64?start-position:position-end;
      if(mode&8){if(start>=end)throw new Error('Degenerate sample loop');if(mode&16)mode^=64;position=((mode&64?end-extra:start+extra)>>>0)&0x1fffffff;}
      else if(control&4)throw new Error('Unsupported wave rollover');else{mode|=1;position=mode&64?start:end;}}
     state.wave_q9[v]=position;r[0]=mode<<8;r[10]=(position>>>16)&8191;r[11]=position&65535;
    }
    if(!(control&3)){
     const speed=r[6]>>>8,step=Math.floor((speed&63)*base*1024/(rate*2**(3*(speed>>>6))));
     const lo=(r[7]>>>8)*16384,hi=(r[8]>>>8)*16384;let ramp=Math.max(0,Math.min(4194303,state.ramp_q10[v]+(control&64?-step:step)));
     if(control&64?ramp<=lo:ramp>=hi){ramp=control&64?lo:hi;r[13]|=256;}
     state.ramp_q10[v]=ramp;r[9]=ramp>>>6;
    }
   }
   if(left< -2147483648||left>2147483647||right< -2147483648||right>2147483647)throw new Error('Unestablished mixer accumulator overflow');
   output[n*2]=Math.max(-32768,Math.min(32767,Math.floor(left/16384)));output[n*2+1]=Math.max(-32768,Math.min(32767,Math.floor(right/16384)));
  }
  state.frames+=length;return output;
 }
 function advancePit(counts){state.pit_remainder+=counts*rate;const length=Math.floor(state.pit_remainder/1193182);state.pit_remainder%=1193182;return render(length);}
 return {...device,portOut,portIn,render,advancePit};
}
