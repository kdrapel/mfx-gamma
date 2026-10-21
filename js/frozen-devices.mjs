// Explicit development models: PIT count source and bounded VGA DAC writes.
// No instruction timing, IRQ dispatch, scanout or analog output model.
export function createFrozenDevices({pit_count,dac:input,clock,record_ports=true,on_port}){
 if(clock===undefined||clock===null){
  if(!Number.isInteger(pit_count)||pit_count<0||pit_count>65535)throw new Error('Invalid PIT input');
 }
 const dac=structuredClone(input),ports=[];let phase=0,latched=pit_count,machine=null,now=0,target=0;
 if(!Array.isArray(dac.palette)||dac.palette.length!==256||dac.palette.some(c=>c.length!==3||c.some(v=>!Number.isInteger(v)||v<0||v>63)))throw new Error('Invalid VGA6 palette');
 if(!Number.isInteger(dac.write_index)||dac.write_index<0||dac.write_index>255||!Number.isInteger(dac.component)||dac.component<0||dac.component>2)throw new Error('Invalid DAC cursor');
 dac.writes=0;
 if(clock){
  if(clock.mode!=='capture_frame_interval')throw new Error('Unsupported clock mode');
  if(!Number.isInteger(clock.frame_interval_counts)||clock.frame_interval_counts<1)throw new Error('Invalid frame interval');
  if(!Number.isInteger(clock.frame_minimum_counts)||clock.frame_minimum_counts<1||clock.frame_interval_counts<clock.frame_minimum_counts)throw new Error('Invalid minimum frame interval');
  if(!Number.isInteger(clock.reload)||clock.reload<2||clock.reload>65535)throw new Error('Invalid clock reload');
  if(!Number.isInteger(clock.initial_now)||clock.initial_now<0)throw new Error('Invalid clock origin');
  if(!Array.isArray(clock.counter_addresses)||clock.counter_addresses.length!==2||clock.counter_addresses.some(a=>!Number.isInteger(a)||a<0||a+4>0x800000))throw new Error('Invalid counter addresses');
  now=clock.initial_now;target=now;
  const offset=now%clock.reload;latched=offset===0?clock.reload:clock.reload-offset;
 }
 const bind=m=>{machine=m;};
 const counterWrite=()=>{
  const offset=now%clock.reload,accumulator=now-offset;
  for(const address of clock.counter_addresses)if(machine.read(address,4)!==accumulator)machine.write(address,accumulator,4);
  latched=offset===0?clock.reload:clock.reload-offset;
 };
 const portIn=(pc,port,size)=>{if(port!==0x40||size!==1||![1,2].includes(phase))throw new Error('Unsupported PIT input');const value=(latched>>>((phase-1)*8))&255;phase=phase===1?2:0;if(record_ports)ports.push({pc,kind:'in',port,size,value});on_port?.(pc,'in',port,size,value);return value;};
 const portOut=(pc,port,size,value)=>{
  if(size!==1||!Number.isInteger(value)||value<0||value>255)throw new Error('Unsupported port width/value');
  if(port===0x43&&value===0&&phase===0){
   if(clock){
    if(!machine)throw new Error('Clock not bound to machine');
    if(now<target)now=target;else target=now+clock.frame_interval_counts;
    counterWrite();
   }
   phase=1;
  }
  else if(port===0x3c8){dac.write_index=value;dac.component=0;}
  else if(port===0x3c9){dac.palette[dac.write_index][dac.component]=value&63;dac.component++;dac.writes++;if(dac.component===3){dac.component=0;dac.write_index=(dac.write_index+1)&255;}}
  else throw new Error('Unsupported port output');if(record_ports)ports.push({pc,kind:'out',port,size,value});on_port?.(pc,'out',port,size,value);
 };
 return {dac,ports,portIn,portOut,bind,clockState:()=>({now,target,latched})};
}
