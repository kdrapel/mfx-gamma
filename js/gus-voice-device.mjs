// Controlled voice/DRAM contract. No sample clock or timed volume ramps yet.
export function createGusVoiceDevice({record_ports=true,on_port}={}){
 const state={voice:0,selected:0,board_control:0,voices:Array.from({length:32},()=>Array(16).fill(0)),global_registers:Array(128).fill(0)},ram=new Uint8Array(1024*1024),ports=[];
 const globals=new Set([0x0e,0x43,0x44,0x4c]),address=()=>((state.global_registers[0x44]>>>8)&15)*65536+state.global_registers[0x43];
 function record(pc,kind,port,size,value){if(record_ports)ports.push({pc,kind,port,size,value});on_port?.(pc,kind,port,size,value);}
 function portOut(pc,port,size,value){
  if(![1,2].includes(size)||!Number.isInteger(value)||value<0||value>=2**(size*8))throw new Error('Unsupported GUS width/value');
  if(port===0x220&&size===1&&[8,9].includes(value))state.board_control=value;
  else if(port===0x322&&size===1){if(value>=32)throw new Error('Unsupported GUS voice');state.voice=value;}
  else if(port===0x323&&size===1)state.selected=value;
  else if([0x324,0x325].includes(port)&&[1,2].includes(size)){
   const register=state.selected;if(!(register<14||globals.has(register))||(size===2&&port!==0x324))throw new Error('Unsupported GUS register write');
   const bank=globals.has(register)?state.global_registers:state.voices[state.voice],shift=port===0x325?8:0,mask=(2**(size*8)-1)<<shift;
   bank[register]=(bank[register]&~mask)|((value<<shift)&mask);
  }else if(port===0x327&&size===1)ram[address()]=value;
  else throw new Error('Unsupported GUS output');
  record(pc,'out',port,size,value);
 }
 function portIn(pc,port,size){
  let value;const bank=state.voices[state.voice];
  if(port===0x327&&size===1)value=ram[address()];
  else if(state.selected===0x8d&&port===0x325&&size===1)value=(bank[13]>>>8)|1;
  else if([0x80,0x89].includes(state.selected)&&((port===0x325&&size===1)||(port===0x324&&size===2)))value=bank[state.selected&127]>>>(port===0x325?8:0);
  else throw new Error('Unsupported GUS input');
  record(pc,'in',port,size,value);return value;
 }
 return {state,ram,ports,portIn,portOut};
}
