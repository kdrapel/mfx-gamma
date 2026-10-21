// Bounded baseline for statically decoded Gamma renderer operations.
// Deliberately not a shipping interpreter or a general x86/x87 emulator.
import {from64Bits,to64Bits,round,raw80,add,subtract,multiply,divide} from './finite-arithmetic.mjs';
import {architecturalConstant,transcendental,asNumber} from './transcendental-candidate.mjs';
const bits=n=>n.toString(2).length;
function isqrt(n){if(n<2n)return n;let x=1n<<BigInt(Math.ceil(bits(n)/2));for(;;){const y=(x+n/x)>>1n;if(y>=x)return x;x=y;}}
export function sqrtFinite(v,precision,rc){
 if(v.nan)return {...v};
 if(v.n<0n)throw new Error('Negative sqrt unsupported by finite intersection profile');
 if(v.infinity)return {...v};
 if(v.n===0n)return {...v};
 const exponent=Math.floor((v.e+bits(v.n)-1)/2),shift=v.e+2*(precision-1-exponent);
 const numerator=shift>=0?v.n<<BigInt(shift):v.n,denominator=shift<0?1n<<BigInt(-shift):1n;
 let q=isqrt(numerator/denominator);const exact=q*q*denominator===numerator;
 if(!exact){const midpoint=(2n*q+1n)**2n*denominator;
  if((rc===0&&(4n*numerator>midpoint||(4n*numerator===midpoint&&(q&1n))))||rc===2)q++;
 }
 return round({n:q,e:exponent-precision+1,negativeZero:false},precision,rc);
}
function integerRound(v,rc){
 if(v.infinity||v.nan)throw new Error('Nonfinite integer conversion unsupported');
 let n=v.n;if(v.e>=0)return n<<BigInt(v.e);
 const d=1n<<BigInt(-v.e),remainder=n%d;n/=d;
 if(remainder){if(rc===1&&v.n<0n)n--;else if(rc===2&&v.n>0n)n++;else if(rc===0){const m=remainder<0n?-remainder:remainder;if(m*2n>d||(m*2n===d&&(n&1n)))n+=v.n<0n?-1n:1n;}}
 return n;
}
class Fpu {
 constructor(cw){this.cw=cw;this.top=0;this.condition=0;this.exceptions=0;this.slots=Array.from({length:8},()=>({n:0n,e:0,negativeZero:false}));this.empty=Array(8).fill(true);}
 get precision(){return (this.cw&0x300)===0?24:64;}
 get rc(){return (this.cw>>>10)&3;}
 get sw(){return this.condition|this.exceptions|(this.top<<11);}
 // Unicorn's observed profile sets ZE for 0/0 and does not map host invalid
 // arithmetic/quiet-NaN comparisons into IE. This is not hardware fidelity.
 divide(a,b,p=this.precision,r=this.rc){if(!a.nan&&!b.nan&&b.n===0n){if(!(this.cw&4))throw new Error('Unmasked x87 zero division');this.exceptions|=4;if(a.n===0n)return {n:0n,e:0,negativeZero:false,nan:true,negative:true};return {n:(a.n<0n)!==Boolean(b.negativeZero)?-1n:1n,e:0,negativeZero:false,infinity:true};}return divide(a,b,p,r);}
 get(i=0){const p=(this.top+i)&7;if(this.empty[p])throw new Error('Unsupported empty FPU operand');return this.slots[p];}
 set(v,i=0){const p=(this.top+i)&7;this.slots[p]=v;this.empty[p]=false;}
 push(v){this.top=(this.top+7)&7;if(!this.empty[this.top])throw new Error('FPU overflow');this.set({...v});}
 pop(){const v=this.get();this.empty[this.top]=true;this.top=(this.top+1)&7;return v;}
 binary(fn,v,i=0){this.set(fn(this.get(i),v,this.precision,this.rc),i);}
 binaryPop(fn,i){const value=fn(this.get(i),this.get(),this.precision,this.rc);this.set(value,i);this.pop();}
 swap(i){const a=this.get(),b=this.get(i);this.set(b);this.set(a,i);}
 compare(v,pop=true){const a=this.get();if(a.nan||v.nan)this.condition=0x4500;else if(a.infinity||v.infinity){const x=a.infinity?(a.n<0n?-1:1):0,y=v.infinity?(v.n<0n?-1:1):0;this.condition=x<y?0x100:x===y?0x4000:0;}else{const e=Math.min(a.e,v.e),x=a.n<<BigInt(a.e-e),y=v.n<<BigInt(v.e-e);this.condition=x<y?0x100:x===y?0x4000:0;}if(pop)this.pop();}
 snapshot(){return {profile:'synthetic_empty_unicorn_architectural_not_capture_backend',cw:this.cw,sw:this.sw,
  tags:this.empty.reduce((word,empty,i)=>word|((empty?3:this.slots[i].infinity||this.slots[i].nan?2:this.slots[i].n===0n?1:0)<<(i*2)),0),slots:this.slots.map(raw80)};}
}
const parity=v=>{v&=255;v^=v>>>4;v^=v>>>2;v^=v>>>1;return (v&1)===0;};
const parts=Object.fromEntries(['a','b','c','d'].flatMap(letter=>[[letter+'l',['e'+letter+'x',0,255]],[letter+'h',['e'+letter+'x',8,255]],[letter+'x',['e'+letter+'x',0,65535]]]));
export class IntersectionMachine {
 constructor(memory,input,fixture){this.memory=memory;this.view=new DataView(memory.buffer,memory.byteOffset,memory.byteLength);this.r={...input};this.f=new Fpu(fixture.initial_cw);this.fixture=fixture;this.writes=[];this.trace=[];this.count=0;this.conversion=new DataView(new ArrayBuffer(8));}
 range(a,n,ranges){if(!Number.isInteger(a)||a<0||a+n>this.memory.length||!ranges.some(([lo,size])=>a>=lo&&a+n<=lo+size))throw new Error(`Out-of-contract RAM ${a.toString(16)}`);}
 address(o){const offset=((o.base?this.reg(o.base):0)+(o.index?this.reg(o.index)*o.scale:0)+o.disp)>>>0;if(!this.fixture.segment_table)return offset;const segment=o.segment||(['ebp','esp'].includes(o.base)?'ss':'ds'),info=this.fixture.segment_table[this.r[segment]];if(!info||offset+(o.size??1)-1>info.limit)throw new Error('Unsupported segment address');return (info.base+offset)>>>0;}
 reg(name){if(parts[name]){const [base,shift,mask]=parts[name];return (this.r[base]>>>shift)&mask;}if(!(name in this.r))throw new Error('Unsupported register '+name);return this.r[name];}
 setReg(name,v){v>>>=0;if(this.fixture.segment_table&&['cs','ds','es','ss','fs','gs'].includes(name)){const info=this.fixture.segment_table[v];if(!info||(['cs','ss'].includes(name)&&info.base!==0))throw new Error('Unsupported segment load');const a=info.descriptor_address+4,word=this.read(a);if(!(word&0x100))this.write(a,word|0x100);this.r[name]=v;return;}if(parts[name]){const [base,shift,mask]=parts[name];this.r[base]=((this.r[base]&~(mask<<shift))|((v&mask)<<shift))>>>0;}else this.r[name]=v;}
 read(a,n=4){this.range(a,n,this.fixture.read_ranges);if(n===1)return this.view.getUint8(a);if(n===2)return this.view.getUint16(a,true);if(n!==4)throw new Error('Unsupported read size');return this.view.getUint32(a,true);}
 write(a,value,n=4){this.range(a,n,this.fixture.write_ranges);if(n===1)this.view.setUint8(a,value);else if(n===2)this.view.setUint16(a,value,true);else if(n===4)this.view.setUint32(a,value,true);else if(n===8)this.view.setBigUint64(a,BigInt(value),true);else throw new Error('Unsupported write size');
  const event={pc:this.r.eip,address:a,size:n,value_hex:Array.from(this.memory.subarray(a,a+n),x=>x.toString(16).padStart(2,'0')).join('')};if(this.fixture.record!==false)this.writes.push(event);this.fixture.onWrite?.(event);}
 get(o){return o.type==='reg'?this.reg(o.name):o.type==='imm'?o.value>>>0:this.read(this.address(o),o.size);}
 put(o,v){if(o.type==='reg')this.setReg(o.name,v);else if(o.type==='mem')this.write(this.address(o),v,o.size);else throw new Error('Invalid destination');}
 float(o){if(o.type==='reg'&&o.name.startsWith('st('))return this.f.get(Number(o.name[3]));
  const a=this.address(o);this.range(a,o.size,this.fixture.read_ranges);
  if(o.size===8)return from64Bits(this.view.getBigUint64(a,true));
  if(o.size!==4)throw new Error('Unsupported floating load size');
  this.conversion.setFloat64(0,this.view.getFloat32(a,true),false);return from64Bits(this.conversion.getBigUint64(0,false));}
 storeFloat(o,pop){const v=this.f.get();if(o.type==='reg'){this.f.set({...v},Number(o.name[3]));if(pop)this.f.pop();return;}
  if(o.size===8){this.write(this.address(o),to64Bits(v,this.f.rc),8);if(pop)this.f.pop();return;}
  const r=round(v,24,this.f.rc),a=this.address(o);this.range(a,4,this.fixture.write_ranges);
  if(r.nan)this.conversion.setUint32(0,r.negative?0xffc00000:0x7fc00000,true);else this.conversion.setFloat32(0,r.infinity?(r.n<0n?-Infinity:Infinity):r.n===0n&&r.negativeZero?-0:Number(r.n)*2**r.e,true);this.write(a,this.conversion.getUint32(0,true));if(pop)this.f.pop();}
 push(v){this.r.esp=(this.r.esp-4)>>>0;this.write(this.r.esp,v);}
 pop(){const v=this.read(this.r.esp);this.r.esp=(this.r.esp+4)>>>0;return v;}
 flags(result,extra=0,width=32){this.r.eflags=((this.r.eflags&~0x8d5)|extra|(result===0?64:0)|(result&(1<<(width-1))?128:0)|(parity(result)?4:0))>>>0;}
 add(a,b,width=32){const modulus=2**width,sign=2**(width-1);a=(a>>>0)%modulus;b=(b>>>0)%modulus;const r=(a+b)%modulus;this.flags(r,(a+b>=modulus?1:0)|((a^b^r)&16)|((~(a^b)&(a^r)&sign)?0x800:0),width);return r;}
 sub(a,b,width=32){const modulus=2**width,sign=2**(width-1);a=(a>>>0)%modulus;b=(b>>>0)%modulus;const r=(a-b+modulus)%modulus;this.flags(r,(a<b?1:0)|((a^b^r)&16)|(((a^b)&(a^r)&sign)?0x800:0),width);return r;}
 logic(v,width=32){v=width===32?v>>>0:(v&((1<<width)-1));this.flags(v,0,width);return v;}
 above(){return (this.r.eflags&65)===0;}
 emptyFlareInterval(){
  if(!this.fixture.flare_clip_empty)return false;
  // Explicit port robustness adapter at the original flare row's JAE. A
  // completely off-screen projection can wrap its end pointer to 0xffxxxxxx;
  // the original unsigned comparison then reads outside the flare image.
  // Only the mathematically empty horizontal intersection is rejected here.
  const left=(this.r.eax-this.r.ecx)|0,right=(this.read(this.r.ebp-0x14)-this.r.ecx)|0;
  if(right<=0||left>=160*4){this.clippedFlareRows=(this.clippedFlareRows??0)+1;return true;}
  return false;
 }
 step(i){
  this.r.eip=i.address;const event={address:i.address,size:i.size,bytes:i.bytes};
  if(this.fixture.trace_state!==false)event.before={registers:{...this.r},fpu:this.f.snapshot()};if(this.fixture.record!==false)this.trace.push(event);this.fixture.onInstruction?.(event,this);this.count++;
  const [a,b]=i.operands;let next=i.address+i.size;
  switch(i.mnemonic){
   case 'push':this.push(this.get(a));break;
   case 'pop':this.put(a,this.pop());break;
   case 'pushal':{const esp=this.r.esp,values=[this.r.edi,this.r.esi,this.r.ebp,esp,this.r.ebx,this.r.edx,this.r.ecx,this.r.eax];this.r.esp=(esp-32)>>>0;for(let n=0;n<8;n++)this.write(this.r.esp+n*4,values[n]);break;}
   case 'popal':for(const name of ['edi','esi','ebp',null,'ebx','edx','ecx','eax']){const value=this.pop();if(name)this.setReg(name,value);}break;
   case 'lss':{if(a.name!=='esp'||b.type!=='mem')throw new Error('Unsupported LSS form');const address=this.address(b),esp=this.read(address),ss=this.read(address+4,2);this.setReg('ss',ss);this.r.esp=esp;break;}
   case 'iretd':{const pc=this.pop(),cs=this.pop(),flags=this.pop();if((cs&3)!==(this.r.cs&3)||(flags&0x24000)||cs!==this.r.cs)throw new Error('Unsupported IRET privilege/task/selector change');const info=this.fixture.segment_table?.[cs];if(!info||info.base!==0)throw new Error('Unsupported IRET code segment');/* This scoped Unicorn same-CS IRET does not emit a GDT accessed-bit write. */this.r.cs=cs;this.r.eflags=flags>>>0;next=pc;break;}
   case 'pushf':this.r.esp=(this.r.esp-2)>>>0;this.write(this.r.esp,this.r.eflags&65535,2);break;
   case 'popf':{const flags=this.read(this.r.esp,2);this.r.esp=(this.r.esp+2)>>>0;this.r.eflags=((this.r.eflags&0xffff0000)|flags|2)>>>0;break;}
   case 'cli':this.r.eflags&=~512;break;
   case 'sti':this.r.eflags|=512;break;
   case 'cld':this.r.eflags&=~0x400;break;
   case 'in':if(!this.fixture.portIn)throw new Error('Unsupported port input');this.put(a,this.fixture.portIn(i.address,this.get(b),a.size));break;
   case 'out':if(!this.fixture.portOut)throw new Error('Unsupported port output');this.fixture.portOut(i.address,this.get(a),b.size,this.get(b));break;
   case 'xchg':{const x=this.get(a),y=this.get(b);this.put(a,y);this.put(b,x);break;}
   case 'rep stosd':{if(this.r.ecx){this.write(this.r.edi,this.r.eax);this.r.edi=(this.r.edi+(this.r.eflags&0x400?-4:4))>>>0;this.r.ecx=(this.r.ecx-1)>>>0;next=i.address;}break;}
   case 'rep movsd':{if(this.r.ecx){this.write(this.r.edi,this.read(this.r.esi));const delta=this.r.eflags&0x400?-4:4;this.r.esi=(this.r.esi+delta)>>>0;this.r.edi=(this.r.edi+delta)>>>0;this.r.ecx=(this.r.ecx-1)>>>0;next=i.address;}break;}
   case 'enter':if(this.get(b)!==0)throw new Error('Nested ENTER unsupported');this.push(this.r.ebp);this.r.ebp=this.r.esp;this.r.esp=(this.r.esp-this.get(a))>>>0;break;
   case 'leave':this.r.esp=this.r.ebp;this.r.ebp=this.pop();break;
   case 'call':this.push(next);next=this.get(a);break;
   case 'ret':next=this.pop();if(a)this.r.esp=(this.r.esp+this.get(a))>>>0;break;
   case 'mov':case 'movzx':this.put(a,this.get(b));break;
   case 'movsx':{const shift=32-b.size*8;this.put(a,(this.get(b)<<shift)>>shift);break;}
   case 'cdq':this.r.edx=this.r.eax&0x80000000?0xffffffff:0;break;
   case 'neg':this.put(a,this.sub(0,this.get(a),a.size*8));break;
   case 'lea':this.put(a,this.address(b));break;
   case 'movsd':{this.put(a,this.get(b));const delta=this.r.eflags&0x400?-4:4;this.r.esi=(this.r.esi+delta)>>>0;this.r.edi=(this.r.edi+delta)>>>0;break;}
   case 'lodsb':case 'lodsd':{const width=i.mnemonic==='lodsd'?4:1;this.setReg(width===4?'eax':'al',this.read(this.r.esi,width));this.r.esi=(this.r.esi+(this.r.eflags&0x400?-width:width))>>>0;break;}
   case 'add':this.put(a,this.add(this.get(a),this.get(b),a.size*8));break;
   case 'sub':this.put(a,this.sub(this.get(a),this.get(b),a.size*8));break;
   case 'inc':{const carry=this.r.eflags&1;this.put(a,this.add(this.get(a),1,a.size*8));this.r.eflags=(this.r.eflags&~1)|carry;break;}
   case 'dec':{const carry=this.r.eflags&1;this.put(a,this.sub(this.get(a),1,a.size*8));this.r.eflags=(this.r.eflags&~1)|carry;break;}
   case 'cmp':this.sub(this.get(a),this.get(b),a.size*8);break;
   case 'and':this.put(a,this.logic(this.get(a)&this.get(b),a.size*8));break;
   case 'or':this.put(a,this.logic(this.get(a)|this.get(b),a.size*8));break;
   case 'xor':this.put(a,this.logic(this.get(a)^this.get(b),a.size*8));break;
   case 'test':this.logic(this.get(a)&this.get(b),a.size*8);break;
   // OF for count>1 is architecturally undefined. Retain the observed Unicorn
   // value for this scoped model rather than masking it in the comparison.
   case 'shl':{const n=this.get(b)&31;if(n){const v=this.get(a),r=(v<<n)>>>0,carry=(v>>>(32-n))&1;this.flags(r,carry|(((r>>>31)^carry)<<11));this.put(a,r);}break;}
   case 'sar':{const n=this.get(b)&31;if(n){const v=this.get(a),r=(v>>n)>>>0;this.flags(r,(v>>>(n-1))&1);this.put(a,r);}break;}
   case 'shr':{const n=this.get(b)&31;if(n){const width=a.size*8,v=this.get(a),r=v>>>n;this.flags(r,((v>>>(n-1))&1)|(((v>>>(n-1))>>>(width-1))<<11),width);this.put(a,r);}break;}
   case 'shrd':{const n=this.get(i.operands[2])&31;if(a.size!==4)throw new Error('Unsupported SHRD width');if(n){const v=this.get(a),r=((v>>>n)|(this.get(b)<<(32-n)))>>>0;this.flags(r,((v>>>(n-1))&1)|(((v^r)>>>31)<<11));this.put(a,r);}break;}
   case 'rol':{const width=a.size*8,n=(this.get(b)&31)%width;if(n){const v=this.get(a),r=Number(BigInt.asUintN(width,(BigInt(v)<<BigInt(n))|(BigInt(v)>>BigInt(width-n)))),carry=r&1;this.r.eflags=((this.r.eflags&~0x801)|carry|((((r>>>(width-1))^carry)&1)<<11))>>>0;this.put(a,r);}break;}
   case 'mul':{const width=a.size*8,low=width===8?'al':width===16?'ax':'eax',product=BigInt(this.reg(low))*BigInt(this.get(a)),r=Number(BigInt.asUintN(width,product)),hi=Number(product>>BigInt(width));if(width===8)this.setReg('ax',Number(product));else{this.setReg(low,r);this.setReg(width===16?'dx':'edx',hi);}this.flags(r,hi?0x801:0,width);break;}
   case 'div':{const width=a.size*8,divisor=BigInt(this.get(a));if(!divisor)throw new Error('Integer divide by zero');const dividend=width===8?BigInt(this.reg('ax')):(BigInt(this.reg(width===16?'dx':'edx'))<<BigInt(width))|BigInt(this.reg(width===16?'ax':'eax')),q=dividend/divisor,remainder=dividend%divisor;if(q>=1n<<BigInt(width))throw new Error('Integer divide overflow');this.setReg(width===8?'al':width===16?'ax':'eax',Number(q));this.setReg(width===8?'ah':width===16?'dx':'edx',Number(remainder));break;}
   case 'imul':{const product=i.operands.length===3?BigInt(this.get(b)|0)*BigInt(this.get(i.operands[2])|0):BigInt(this.get(a)|0)*BigInt(this.get(b)|0),r=Number(BigInt.asUintN(32,product)),overflow=product!==BigInt.asIntN(32,product);this.flags(r,overflow?0x801:0);this.put(a,r);break;}
   case 'seta':this.put(a,this.above()?1:0);break;
   case 'setg':this.put(a,!(this.r.eflags&64)&&Boolean(this.r.eflags&128)===Boolean(this.r.eflags&0x800)?1:0);break;
   case 'sahf':this.r.eflags=((this.r.eflags&~0xd5)|((this.r.eax>>>8)&0xd5)|2)>>>0;break;
   case 'jmp':next=this.get(a);break;
   case 'jae':if(!(this.r.eflags&1)||i.address===0x18644&&this.emptyFlareInterval())next=this.get(a);break;
   case 'ja':if(this.above())next=this.get(a);break;
   case 'jbe':if(this.r.eflags&65)next=this.get(a);break;
   case 'je':if(this.r.eflags&64)next=this.get(a);break;
   case 'jne':if(!(this.r.eflags&64))next=this.get(a);break;
   case 'jb':if(this.r.eflags&1)next=this.get(a);break;
   case 'jl':if(Boolean(this.r.eflags&128)!==Boolean(this.r.eflags&0x800))next=this.get(a);break;
   case 'jge':if(Boolean(this.r.eflags&128)===Boolean(this.r.eflags&0x800))next=this.get(a);break;
   case 'jg':if(!(this.r.eflags&64)&&Boolean(this.r.eflags&128)===Boolean(this.r.eflags&0x800))next=this.get(a);break;
   case 'jle':if((this.r.eflags&64)||Boolean(this.r.eflags&128)!==Boolean(this.r.eflags&0x800))next=this.get(a);break;
   case 'fld':this.f.push(this.float(a));break;
   case 'fild':{if(![2,4].includes(a.size))throw new Error('Unsupported integer floating load size');const shift=32-a.size*8;this.f.push({n:BigInt((this.read(this.address(a),a.size)<<shift)>>shift),e:0,negativeZero:false});break;}
   case 'fldz':this.f.push({n:0n,e:0,negativeZero:false});break;
   case 'fld1':this.f.push({n:1n,e:0,negativeZero:false});break;
   case 'fxch':this.f.swap(Number(i.operands.at(-1).name[3]));break;
   case 'fmul':this.f.binary(multiply,this.float(b??a),b?Number(a.name[3]):0);break;
   case 'fadd':this.f.binary(add,this.float(b??a),b?Number(a.name[3]):0);break;
   case 'fsub':this.f.binary(subtract,this.float(b??a),b?Number(a.name[3]):0);break;
   case 'fsubr':{const d=b?Number(a.name[3]):0;this.f.set(subtract(this.float(b??a),this.f.get(d),this.f.precision,this.f.rc),d);break;}
   case 'fdivr':{const d=b?Number(a.name[3]):0;this.f.set(this.f.divide(this.float(b??a),this.f.get(d)),d);break;}
   case 'fdiv':this.f.binary(this.f.divide.bind(this.f),this.float(b??a),b?Number(a.name[3]):0);break;
   case 'fdivp':this.f.binaryPop(this.f.divide.bind(this.f),Number(a.name[3]));break;
   case 'fmulp':this.f.binaryPop(multiply,Number(a.name[3]));break;
   case 'faddp':this.f.binaryPop(add,Number(a.name[3]));break;
   case 'fdivrp':this.f.binaryPop((x,y,p,r)=>this.f.divide(y,x,p,r),Number(a.name[3]));break;
   case 'fsubrp':this.f.binaryPop((x,y,p,r)=>subtract(y,x,p,r),Number(a.name[3]));break;
   case 'fsubp':this.f.binaryPop(subtract,Number(a.name[3]));break;
   case 'fchs':{const v=this.f.get();this.f.set(v.nan?{...v,negative:!v.negative}:{...v,n:-v.n,negativeZero:v.n===0n?!v.negativeZero:false});break;}
   case 'fabs':{const v=this.f.get();this.f.set({...v,n:v.n<0n?-v.n:v.n,negativeZero:false,...(v.nan?{negative:false}:{})});break;}
   case 'fsqrt':this.f.set(sqrtFinite(this.f.get(),this.f.precision,this.f.rc));break;
   case 'fst':this.storeFloat(a,false);break;
   case 'fstp':this.storeFloat(a,true);break;
   case 'fcomp':this.f.compare(this.float(a));break;
   case 'fcom':this.f.compare(this.float(a),false);break;
   case 'ftst':this.f.compare({n:0n,e:0,negativeZero:false},false);break;
   case 'fldln2':case 'fldl2e':this.f.push(architecturalConstant(i.mnemonic,this.f.rc));break;
   case 'fsin':case 'fcos':case 'f2xm1':this.f.set(transcendental(i.mnemonic,this.f.get()));break;
   case 'fyl2x':{const v=transcendental(i.mnemonic,this.f.get(),this.f.get(1));this.f.set(v,1);this.f.pop();break;}
   case 'fscale':{const scale=Math.trunc(asNumber(this.f.get(1)));if(!Number.isSafeInteger(scale)||Math.abs(scale)>1024)throw new Error('Unsupported FSCALE range');const v=this.f.get();this.f.set({...v,e:v.e+scale});break;}
   case 'fcompp':this.f.compare(this.f.get(1));this.f.pop();break;
   case 'fistp':{const v=this.f.get(),n=v.infinity||v.nan?-2147483648n:integerRound(v,this.f.rc);if(a.size!==4)throw new Error('Unsupported FISTP width');this.write(this.address(a),n< -2147483648n||n>2147483647n?0x80000000:Number(BigInt.asUintN(32,n)));this.f.pop();break;}
   case 'frndint':{const v=this.f.get();if(v.infinity||v.nan)break;const n=integerRound(v,this.f.rc);this.f.set({n,e:0,negativeZero:n===0n&&(v.n<0n||v.negativeZero)});break;}
   case 'fnstsw':this.put(a,this.f.sw);break;
   case 'wait':if(this.f.sw&0x3f&~this.f.cw)throw new Error('Pending unmasked x87 exception');break;
   case 'fnstcw':this.put(a,this.f.cw);break;
   case 'fldcw':{const cw=this.get(a);if(![0x7f,0x37f,0x47f,0x87f,0xc7f,0x1f7f].includes(cw))throw new Error('Unsupported x87 control word '+cw.toString(16));this.f.cw=cw;break;}
   default:throw new Error(`Unsupported intersection instruction ${i.mnemonic} at ${i.address.toString(16)}`);
  }
  this.r.eip=next;return next;
 }
 run(plan){
  const instructions=new Map(plan.instructions.map(i=>[i.address,i])),iterations=this.fixture.iterations??1;let pc=plan.entry,boundaries=0;
  while(true){
   if(pc===plan.stop&&++boundaries>=iterations)break;
   if(this.count>=this.fixture.instruction_limit)throw new Error('Instruction limit');const i=instructions.get(pc);if(!i)throw new Error('Unknown intersection block '+pc.toString(16));
   if(Array.from(this.memory.subarray(pc,pc+i.size),b=>b.toString(16).padStart(2,'0')).join('')!==i.bytes)throw new Error('Changed intersection instruction');pc=this.step(i);}
  return {registers:this.r,trace:this.trace,writes:this.writes,fpu:this.f.snapshot()};
 }
}
