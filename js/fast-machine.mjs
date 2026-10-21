// Static basic-block compilation of the verified original instruction plan.
// It translates instructions, not output images. Unknown operations fail.
import {IntersectionMachine} from './intersection-machine.mjs';
import {FastFpu} from './fast-fpu.mjs';
import {compileFloat32Block} from './float32-block.mjs';
const partial=Object.fromEntries(['a','b','c','d'].flatMap(c=>[[c+'l',['e'+c+'x',0,255]],[c+'h',['e'+c+'x',8,255]],[c+'x',['e'+c+'x',0,65535]]]));
const control=new Set(['jmp','call','ret','je','jne','ja','jae','jb','jbe','jg','jge','jl','jle','rep movsd','rep stosd','iretd']);
const st=o=>Number(o.name[3]);
function reg(name){const p=partial[name];return p?`((r.${p[0]}>>>${p[1]})&${p[2]})`:`r.${name}`;}
function addr(o){if(o.segment&&!['cs','ds','es','ss'].includes(o.segment))throw new Error('Nonflat segment requires reference execution');return `((${o.base?reg(o.base):0}+${o.index?reg(o.index)+'*'+o.scale:0}+${o.disp})>>>0)`;}
function get(o){return o.type==='reg'?reg(o.name):o.type==='imm'?String(o.value>>>0):`m.read(${addr(o)},${o.size})`;}
function put(o,v){if(o.type==='mem')return `m.write(${addr(o)},${v},${o.size});`;if(o.type!=='reg')throw new Error('Invalid destination');const p=partial[o.name];return p?`r.${p[0]}=((r.${p[0]}&${~(p[2]<<p[1])})|(((${v})&${p[2]})<<${p[1]}))>>>0;`:`r.${o.name}=(${v})>>>0;`;}
function fl(o){return o.type==='reg'?`f.get(${st(o)})`:`m.view.getFloat${o.size*8}(${addr(o)},true)`;}
function compileInstruction(i,index,deadFlags=false){
 const [a,b]=i.operands,g=o=>get(o),p=(o,v)=>put(o,v),next=i.address+i.size;
 if(['fmul','fadd','fsub','fmulp','faddp','fsubp'].includes(i.mnemonic)){
  const pop=i.mnemonic.endsWith('p'),op=i.mnemonic.startsWith('fmul')?'*':i.mnemonic.startsWith('fsub')?'-':'+',kind={'*':'mul','-':'sub','+':'add'}[op],operand=b??a;
  const destination=pop||b?st(a):0;
  const target=`(t+${destination})&7`,rhs=pop?'f.slots[t]':fl(operand),check=pop?'f.quality[t]===24&&!f.empty[t]':operand.type==='reg'?`f.quality[(t+${st(operand)})&7]===24&&!f.empty[(t+${st(operand)})&7]`:String(operand.size===4);
  const fallback=pop?`f.binaryPop('${kind}',${st(a)});`:`f.binary('${kind}',${rhs},${destination});`;
  return `{const t=f.top,q=${target};if((f.cw&0xf00)===0&&f.quality[q]===24&&!f.empty[q]&&${check}){const v=f.slots[q]${op}(${rhs});if(v===0||Math.abs(v)>=1.1754943508222875e-38&&Math.abs(v)<=3.4028234663852886e38){f.slots[q]=Math.fround(v);${pop?'f.empty[t]=true;f.top=(t+1)&7;':''}}else{${fallback}}}else{${fallback}}}`;
 }
 if(deadFlags){switch(i.mnemonic){
  case 'add':case 'sub':return p(a,`${g(a)}${i.mnemonic==='add'?'+':'-'}${g(b)}`);
  case 'inc':case 'dec':return p(a,`${g(a)}${i.mnemonic==='inc'?'+':'-'}1`);
  case 'neg':return p(a,`-${g(a)}`);
  case 'and':case 'or':case 'xor':return p(a,`${g(a)}${{and:'&',or:'|',xor:'^'}[i.mnemonic]}${g(b)}`);
  case 'cmp':case 'test':return `void(${g(a)});void(${g(b)});`;
  case 'imul':if(a.size===4&&i.operands.length>=2)return p(a,`Math.imul(${g(i.operands.length===3?b:a)},${g(i.operands.length===3?i.operands[2]:b)})`);break;
  case 'shl':case 'sar':case 'shr':return `{const n=${g(b)}&31;if(n){${p(a,`${g(a)}${{shl:'<<',sar:'>>',shr:'>>>'}[i.mnemonic]}n`)}}}`;
 }}
 const branch={je:'r.eflags&64',jne:'!(r.eflags&64)',ja:'!(r.eflags&65)',jae:'!(r.eflags&1)',jb:'r.eflags&1',jbe:'r.eflags&65',jg:'!(r.eflags&64)&&Boolean(r.eflags&128)===Boolean(r.eflags&2048)',jge:'Boolean(r.eflags&128)===Boolean(r.eflags&2048)',jl:'Boolean(r.eflags&128)!==Boolean(r.eflags&2048)',jle:'(r.eflags&64)||Boolean(r.eflags&128)!==Boolean(r.eflags&2048)'};
 if(branch[i.mnemonic])return `return (${branch[i.mnemonic]}${i.address===0x18644?'||m.emptyFlareInterval()':''})?${g(a)}:${next};`;
 switch(i.mnemonic){
 case 'mov':case 'movzx':return p(a,g(b));
 case 'movsx':return p(a,`((${g(b)}<<${32-b.size*8})>>${32-b.size*8})`);
 case 'lea':return p(a,addr(b));
 case 'imul':if(a.size===4&&i.operands.length>=2){
  const left=i.operands.length===3?b:a,right=i.operands.length===3?i.operands[2]:b;
  // The low word is exact. A double product need only decide whether the
  // full product fits signed32; that entire interval is exactly representable.
  return `{const x=${g(left)}|0,y=${g(right)}|0,v=Math.imul(x,y)>>>0;m.flags(v,x*y===(v|0)?0:0x801);${p(a,'v')}}`;
 }return `m.slow(${index});`;
 case 'add':case 'sub':return p(a,`m.${i.mnemonic}${a.size===4?'32':''}(${g(a)},${g(b)},${a.size*8})`);
 case 'cmp':return `m.sub${a.size===4?'32':''}(${g(a)},${g(b)},${a.size*8});`;
 case 'and':case 'or':case 'xor':{const op={and:'&',or:'|',xor:'^'}[i.mnemonic];return p(a,`m.logic(${g(a)}${op}${g(b)},${a.size*8})`);}
 case 'test':return `m.logic(${g(a)}&${g(b)},${a.size*8});`;
 case 'inc':case 'dec':return `{const carry=r.eflags&1;${p(a,`m.${i.mnemonic==='inc'?'add':'sub'}(${g(a)},1,${a.size*8})`)}r.eflags=(r.eflags&~1)|carry;}`;
 case 'push':return `m.push(${g(a)});`;
 case 'pop':return p(a,'m.pop()');
 case 'call':return `m.push(${next});return ${g(a)};`;
 case 'ret':return `{const pc=m.pop();${a?`r.esp=(r.esp+${g(a)})>>>0;`:''}return pc;}`;
 case 'jmp':return `return ${g(a)};`;
 case 'enter':if(b.value!==0)throw new Error('Nested ENTER');return `m.push(r.ebp);r.ebp=r.esp;r.esp=(r.esp-${g(a)})>>>0;`;
 case 'leave':return 'r.esp=r.ebp;r.ebp=m.pop();';
 case 'shl':return `{const n=${g(b)}&31;if(n){const v=${g(a)},x=(v<<n)>>>0,c=(v>>>(32-n))&1;m.flags(x,c|(((x>>>31)^c)<<11));${p(a,'x')}}}`;
 case 'sar':return `{const n=${g(b)}&31;if(n){const v=${g(a)},x=(v>>n)>>>0;m.flags(x,(v>>>(n-1))&1);${p(a,'x')}}}`;
 case 'shr':return `{const n=${g(b)}&31;if(n){const v=${g(a)},x=v>>>n;m.flags(x,((v>>>(n-1))&1)|(((v>>>(n-1))>>>${a.size*8-1})<<11),${a.size*8});${p(a,'x')}}}`;
 case 'shrd':return `{const n=${g(i.operands[2])}&31;if(n){const v=${g(a)},x=((v>>>n)|(${g(b)}<<(32-n)))>>>0;m.flags(x,((v>>>(n-1))&1)|(((v^x)>>>31)<<11));${p(a,'x')}}}`;
 case 'neg':return p(a,`m.sub${a.size===4?'32':''}(0,${g(a)},${a.size*8})`);
 case 'cdq':return 'r.edx=r.eax&0x80000000?0xffffffff:0;';
 case 'seta':return p(a,'(r.eflags&65)===0?1:0');
 case 'setg':return p(a,'!(r.eflags&64)&&Boolean(r.eflags&128)===Boolean(r.eflags&2048)?1:0');
 case 'xchg':return `{const x=${g(a)},y=${g(b)};${p(a,'y')}${p(b,'x')}}`;
 case 'movsd':return `${p(a,g(b))}r.esi=(r.esi+(r.eflags&1024?-4:4))>>>0;r.edi=(r.edi+(r.eflags&1024?-4:4))>>>0;`;
 case 'lodsb':case 'lodsd':return `${put({type:'reg',name:i.mnemonic==='lodsd'?'eax':'al'},`m.read(r.esi,${i.mnemonic==='lodsd'?4:1})`)}r.esi=(r.esi+(r.eflags&1024?-${i.mnemonic==='lodsd'?4:1}:${i.mnemonic==='lodsd'?4:1}))>>>0;`;
 case 'cld':return 'r.eflags&=~1024;';
 case 'cli':return 'r.eflags&=~512;';
 case 'sti':return 'r.eflags|=512;';
 case 'wait':return "if(f.sw&63&~f.cw)throw new Error('Pending unmasked x87 exception');";
 case 'in':return p(a,`m.fixture.portIn(${i.address},${g(b)},${a.size})`);
 case 'out':return `m.fixture.portOut(${i.address},${g(a)},${b.size},${g(b)});`;
 case 'fld':return `f.push(${fl(a)});`;
 case 'fldz':return 'f.push(0);';
 case 'fld1':return 'f.push(1);';
 case 'fild':return `f.push((${g(a)}<<${32-a.size*8})>>${32-a.size*8});`;
 case 'fxch':return `{const t=f.top,q=(t+${st(i.operands.at(-1))})&7;if(f.empty[t]||f.empty[q])throw new Error('Empty FXCH operand');const x=f.slots[t],e=f.exact[t],p=f.quality[t];f.slots[t]=f.slots[q];f.slots[q]=x;f.exact[t]=f.exact[q];f.exact[q]=e;f.quality[t]=f.quality[q];f.quality[q]=p;}`;
 case 'fmul':case 'fadd':case 'fsub':case 'fdiv':return `f.binary('${{fmul:'mul',fadd:'add',fsub:'sub',fdiv:'div'}[i.mnemonic]}',${fl(b??a)},${b?st(a):0});`;
 case 'fsubr':case 'fdivr':return `f.set(f.calc('${i.mnemonic==='fsubr'?'sub':'div'}',${fl(b??a)},f.get(${b?st(a):0})),${b?st(a):0});`;
 case 'fmulp':case 'faddp':case 'fsubp':case 'fdivp':case 'fsubrp':case 'fdivrp':return `f.binaryPop('${{fmulp:'mul',faddp:'add',fsubp:'sub',fdivp:'div',fsubrp:'sub',fdivrp:'div'}[i.mnemonic]}',${st(a)},${i.mnemonic==='fsubrp'||i.mnemonic==='fdivrp'});`;
 case 'fst':case 'fstp':{
  const pop=i.mnemonic==='fstp';if(a.type==='reg')return `f.set(f.get(),${st(a)});${pop?'f.pop();':''}`;
  const fallback=`m.saveFloat(${addr(a)},${a.size},${pop});`;
  if(a.size!==4)return fallback;
  // DataView's float32 store performs the same nearest/even rounding as f32.
  // Keep diagnostic writes and directed/extended values on the old path.
  return `{const t=f.top;if(!m.diagnostics&&(f.cw&0xc00)===0&&!f.empty[t]&&f.exact[t]===null){const a=${addr(a)};if(!m.allowedWrite(a,4))throw Error('Out-of-contract floating store');m.view.setFloat32(a,f.slots[t],true);${pop?'f.empty[t]=true;f.top=(t+1)&7;':''}}else{${fallback}}}`;
 }
 case 'fcom':case 'fcomp':return `f.compare(${fl(a)},${i.mnemonic==='fcomp'});`;
 case 'fcompp':return 'f.compare(f.get(1));f.pop();';
 case 'ftst':return 'f.compare(0,false);';
 case 'fchs':case 'fabs':return `f.sign(${i.mnemonic==='fabs'});`;
 case 'fsqrt':return 'f.sqrt();';
 case 'fnstsw':return p(a,'f.sw');
 case 'fnstcw':return p(a,'f.cw');
 case 'fldcw':return `m.controlWord(${g(a)});`;
 case 'frndint':return 'f.roundInteger();';
 case 'fistp':if(a.size!==4)throw new Error('Unsupported integer store');return `m.write(${addr(a)},f.int32());f.pop();`;
 case 'fsin':case 'fcos':case 'f2xm1':case 'fyl2x':return `f.transcend('${i.mnemonic}');`;
 case 'fldln2':case 'fldl2e':return `f.constant('${i.mnemonic}');`;
 case 'fscale':return 'f.scale();';
 case 'sahf':return 'r.eflags=((r.eflags&~0xd5)|((r.eax>>>8)&0xd5)|2)>>>0;';
 case 'rep movsd':return `if(r.ecx){m.write(r.edi,m.read(r.esi));const delta=r.eflags&1024?-4:4;r.edi=(r.edi+delta)>>>0;r.esi=(r.esi+delta)>>>0;r.ecx=(r.ecx-1)>>>0;return ${i.address};}return ${next};`;
 case 'rep stosd':return `if(r.ecx){m.write(r.edi,r.eax);r.edi=(r.edi+(r.eflags&1024?-4:4))>>>0;r.ecx=(r.ecx-1)>>>0;return ${i.address};}return ${next};`;
 default:return `m.slow(${index});${control.has(i.mnemonic)?'return r.eip;':''}`;
 }
}
export class FastMachine extends IntersectionMachine{
 deoptFloat32Block(pc,remaining,top,mask,emptyMask,...values){
  const f=this.f,t=f.top;for(let i=0;i<8;i++)if(mask&(1<<i)){const q=(t+i)&7;f.slots[q]=values[i];f.exact[q]=null;f.quality[q]=Number.isNaN(values[i])?53:24;f.empty[q]=Boolean(emptyMask&(1<<i));}
  f.top=(t+top)&7;this.count-=remaining;return pc;
 }
 add32(a,b){a>>>=0;b>>>=0;const s=a+b,r=s>>>0;this.flags(r,(s>0xffffffff?1:0)|((a^b^r)&16)|((~(a^b)&(a^r)&0x80000000)?2048:0));return r;}
 sub32(a,b){a>>>=0;b>>>=0;const r=(a-b)>>>0;this.flags(r,(a<b?1:0)|((a^b^r)&16)|(((a^b)&(a^r)&0x80000000)?2048:0));return r;}
 constructor(memory,input,fixture){super(memory,input,fixture);if(fixture.read_ranges.length!==1||fixture.read_ranges[0][0]!==0||fixture.read_ranges[0][1]!==memory.length)throw new Error('Fast RAM read contract requires full mapped image');this.f=new FastFpu(fixture.initial_cw);this.compiled=null;this.boundaries=new Set();this.diagnostics=fixture.record!==false||Boolean(fixture.onInstruction||fixture.onWrite);this.allowedWrite=new Function('a','n',`return a>=0&&a+n<=${memory.length}&&(${fixture.write_ranges.map(([a,n])=>`(a>=${a}&&a+n<=${a+n})`).join('||')});`);}
 read(a,n=4){if(n===4)return this.view.getUint32(a,true);if(n===2)return this.view.getUint16(a,true);if(n===1)return this.view.getUint8(a);throw new Error('Unsupported read');}
 write(a,value,n=4){if(this.diagnostics)return super.write(a,value,n);if(!this.allowedWrite(a,n))throw new Error('Out-of-contract compiled write '+a.toString(16));if(n===4)this.view.setUint32(a,value,true);else if(n===2)this.view.setUint16(a,value,true);else if(n===1)this.view.setUint8(a,value);else if(n===8)this.view.setBigUint64(a,BigInt(value),true);else throw new Error('Unsupported write');}
 loadFloat(a,n){if(n===4)return this.view.getFloat32(a,true);if(n===8)return this.view.getFloat64(a,true);throw new Error('Unsupported floating load');}
 saveFloat(a,n,pop){const v=this.f.get();if(n===8)this.write(a,this.f.bits64(v),8);else if(n===4){if(this.diagnostics){this.conversion.setFloat32(0,this.f.f32(v),true);this.write(a,this.conversion.getUint32(0,true));}else{if(!this.allowedWrite(a,4))throw new Error('Out-of-contract floating write');this.view.setFloat32(a,this.f.f32(v),true);}}else throw new Error('Unsupported floating store');if(pop)this.f.discard();}
 controlWord(cw){if(![0x7f,0x37f,0x47f,0x87f,0xc7f,0x1f7f].includes(cw))throw new Error('Unsupported control word');this.f.cw=cw;}
 slow(index){const count=this.count,callback=this.fixture.onInstruction;this.fixture.onInstruction=undefined;try{super.step(this.instructions[index]);}finally{this.fixture.onInstruction=callback;this.count=count;}}
 compile(plan){
  this.instructions=plan.instructions;this.byAddress=new Map(this.instructions.map((i,n)=>[i.address,n]));const starts=new Set(this.boundaries);
  for(const i of this.instructions){const bytes=Array.from(this.memory.subarray(i.address,i.address+i.size),b=>b.toString(16).padStart(2,'0')).join('');if(bytes!==i.bytes)throw new Error('Changed original instruction');if(this.fixture.write_ranges.some(([a,n])=>a<i.address+i.size&&a+n>i.address))throw new Error('Writable compiled code is unsupported');if(control.has(i.mnemonic)){if(i.mnemonic.startsWith('rep '))starts.add(i.address);starts.add(i.address+i.size);if(i.operands[0]?.type==='imm')starts.add(i.operands[0].value>>>0);}}
  // Original data slot 0x17654 is the sole allowed code-region write. All
  // other writes still check their explicit RAM contract on every operation.
  this.blocks=new Map();this.dispatch=new Array(this.instructions.reduce((size,i)=>Math.max(size,i.address+1),0));let block=[];
  const flush=()=>{if(!block.length)return;const length=block.length,end=block.at(-1)[0].address+block.at(-1)[0].size;
   const dead=new Set();let flagsLive=true;
   if(!this.diagnostics&&this.fixture.optimize_flags!==false)for(let n=block.length-1;n>=0;n--){const i=block[n][0],op=i.mnemonic;
    if(['add','sub','cmp','and','or','xor','test','neg'].includes(op)||op==='imul'&&i.operands[0].size===4&&i.operands.length>=2||['shl','shr','sar'].includes(op)&&i.operands[1].type==='imm'&&(i.operands[1].value&31)!==0){if(!flagsLive)dead.add(i.address);flagsLive=false;}
    else if(['inc','dec'].includes(op)){if(!flagsLive)dead.add(i.address);}
    else if(['pushf','popf','sahf','rol','seta','setg'].includes(op)||op.startsWith('j')&&op!=='jmp')flagsLive=true;
   }
   const source=block.map(([i,index])=>`${this.diagnostics||this.fixture.precise_pc?`r.eip=${i.address};`:''}${this.fixture.onInstruction?`m.fixture.onInstruction(m.events[${index}],m);m.count++;`:''}${compileInstruction(i,index,dead.has(i.address))}`).join('\n');
   const body=`const r=m.r,f=m.f;${this.fixture.onInstruction?'':`m.count+=${length};`}\n${source}\nreturn ${end};`;
   const original=new Function('m',body+(this.fixture.profile_blocks?'\n//# sourceURL=gamma-block-'+block[0][0].address.toString(16)+'.js':''));
   // Additional blocks are the measured intersection/refraction hot path in
   // the 105.7..109.4 s transition; original rounding and fallback stay intact.
   const local=!this.diagnostics&&!this.fixture.precise_pc&&this.fixture.float32_blocks!==false&&[0x15393,0x153f9,0x1553a,0x155b4,0x156a2,0x1583d,0x1598b,0x15b8e].includes(block[0][0].address)?compileFloat32Block(block,{compileInstruction,addr,put,dead}):null;
   const compiled={run:local?m=>local(m,original):original,length};
   this.blocks.set(block[0][0].address,compiled);this.dispatch[block[0][0].address]=compiled;block=[];};
  this.instructions.forEach((i,index)=>{if(block.length&&(starts.has(i.address)||block.at(-1)[0].address+block.at(-1)[0].size!==i.address))flush();block.push([i,index]);if(control.has(i.mnemonic))flush();});flush();
  this.events=this.instructions.map(i=>({address:i.address,size:i.size,bytes:i.bytes}));this.compiled=plan.instructions;
 }
 run(plan){
  if(this.fixture.segment_table)throw new Error('Fast segment dispatch not established');
  if(this.compiled!==plan.instructions||!this.boundaries.has(plan.entry)||!this.boundaries.has(plan.stop)){this.boundaries.add(plan.entry);this.boundaries.add(plan.stop);this.compile(plan);}
  let pc=plan.entry,boundaries=0;const iterations=this.fixture.iterations??1;
  while(true){if(pc===plan.stop&&++boundaries>=iterations)break;let block=this.dispatch[pc];if(!block){if(!this.byAddress.has(pc))throw new Error('Unknown compiled block '+pc.toString(16));this.boundaries.add(pc);this.compile(plan);block=this.dispatch[pc];}if(this.count+block.length>this.fixture.instruction_limit)throw new Error('Instruction limit at 0x'+pc.toString(16));pc=block.run(this);}
  this.r.eip=pc;return {registers:this.r,fpu:this.f.snapshot()};
 }
}
