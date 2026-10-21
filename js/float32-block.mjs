// Local-register execution of verified straight-line x87 float32 instructions.
// Every original operation still rounds separately. Exceptional/range cases
// commit the prefix and resume the ordinary compiled path at that instruction.
export function compileFloat32Block(block,{compileInstruction,addr,put,dead}){
 const supported=new Set(['fld','fldz','fld1','fxch','fmul','fadd','fsub','fmulp','faddp','fsubp','fdiv','fdivr','fdivp','fdivrp','fsqrt','fst','fstp','fcomp','fcom','fcompp','fchs','fabs','fnstsw']);
 if(block.some(([i])=>i.mnemonic.startsWith('f')&&!supported.has(i.mnemonic)))return null;
 const length=block.length,end=block.at(-1)[0].address+block.at(-1)[0].size;
 let top=0,serial=0;const values=Array(8).fill(null),empty=Array(8).fill(null),touched=new Set(),guards=[],code=[];
 const slot=i=>(top+i+16)&7,name=i=>`v${i}`,physical=i=>`((t+${i})&7)`;
 function need(i){if(empty[i]===true)throw Error('Invalid static float stack');if(values[i]===null){guards.push(`!f.empty[${physical(i)}]&&f.quality[${physical(i)}]===24`);values[i]=name(i);code.push(`${name(i)}=f.slots[${physical(i)}];`);}empty[i]=false;return name(i);}
 function commit(){let s=`f.top=(t+${top})&7;`;for(const i of touched)s+=`f.slots[${physical(i)}]=${name(i)};f.exact[${physical(i)}]=null;f.quality[${physical(i)}]=Number.isNaN(${name(i)})?53:24;f.empty[${physical(i)}]=${empty[i]};`;return s;}
 function bailout(index,condition){
  if(index===0)return `if(${condition}){m.count-=${length};return fallback(m);}`;
  let mask=0,emptyMask=0;for(const i of touched){mask|=1<<i;if(empty[i])emptyMask|=1<<i;}
  return `if(${condition})return m.deoptFloat32Block(${block[index][0].address},${length-index},${top},${mask},${emptyMask},${Array.from({length:8},(_,i)=>touched.has(i)?name(i):'undefined').join(',')});`;
 }
 function operand(o){if(o.type==='reg')return need(slot(Number(o.name[3])));if(o.type!=='mem'||o.size!==4)throw Error('Non-float32 operand');return `m.view.getFloat32(${addr(o)},true)`;}
 function assign(i,expression){values[i]=name(i);empty[i]=false;touched.add(i);code.push(`${name(i)}=${expression};`);}
 function push(expression,index){const q=(top+7)&7;if(empty[q]===false)throw Error('Static float overflow');if(empty[q]===null)guards.push(`f.empty[${physical(q)}]`);top=q;assign(q,expression);}
 function pop(){const q=slot(0);need(q);empty[q]=true;touched.add(q);top=(top+1)&7;}
 function temporary(expression){const v=`x${serial++}`;code.push(`const ${v}=${expression};`);return v;}
 try{
  for(let index=0;index<length;index++){
   const [i,instructionIndex]=block[index],[a,b]=i.operands,op=i.mnemonic;
   if(op==='fld'||op==='fldz'||op==='fld1'){
    const v=temporary(op==='fld'?operand(a):op==='fldz'?'0':'1');
    code.push(bailout(index,`!Number.isFinite(${v})`));push(v,index);
   }else if(op==='fxch'){
    const x=slot(0),y=slot(Number(i.operands.at(-1).name[3])),v=temporary(need(x)),w=need(y);assign(x,w);assign(y,v);
   }else if(['fmul','fadd','fsub','fmulp','faddp','fsubp','fdiv','fdivr','fdivp','fdivrp'].includes(op)){
    const pops=op.endsWith('p'),destination=slot(pops||b?Number(a.name[3]):0),left=need(destination),right=temporary(pops?need(slot(0)):operand(b??a));
    const kind=op.startsWith('fmul')?'mul':op.startsWith('fadd')?'add':op.startsWith('fsub')?'sub':'div';
    const reverse=op.startsWith('fdivr'),lhs=reverse?right:left,rhs=reverse?left:right;
    const value=temporary(`${lhs}${{mul:'*',add:'+',sub:'-',div:'/'}[kind]}${rhs}`);
    code.push(bailout(index,`Number.isFinite(${value})&&!(${value}===0||Math.abs(${value})>=1.1754943508222875e-38&&Math.abs(${value})<=3.4028234663852886e38)`));
    // calc retains the exact midpoint fallback for double-rounded division.
    // It also retains the measured zero-division and signed quiet-NaN behavior
    // used by degenerate quadrics/planes, without deoptimizing the whole tail.
    assign(destination,kind==='div'?`f.calc('div',${lhs},${rhs})`:`Number.isFinite(${value})?Math.fround(${value}):f.calc('${kind}',${lhs},${rhs})`);if(pops)pop();
   }else if(op==='fsqrt'){
    const q=slot(0),v=need(q);assign(q,`f.sqrtValue(${v})`);
   }else if(op==='fst'||op==='fstp'){
    const value=need(slot(0));if(a.type==='reg')assign(slot(Number(a.name[3])),value);
    else{if(a.size!==4)throw Error('Non-float32 store');code.push(`{const a=${addr(a)};if(!m.allowedWrite(a,4))throw Error('Out-of-contract float32 block store');m.view.setFloat32(a,${value},true);}`);}
    if(op==='fstp')pop();
   }else if(op==='fchs'||op==='fabs'){const q=slot(0),v=need(q);code.push(bailout(index,`Number.isNaN(${v})`));assign(q,op==='fchs'?`-${v}`:`Math.abs(${v})`);
   }else if(op==='fcomp'||op==='fcom'||op==='fcompp'){
    const left=need(slot(0)),right=temporary(op==='fcompp'?need(slot(1)):operand(a));
    code.push(`f.condition=Number.isNaN(${left})||Number.isNaN(${right})?0x4500:${left}<${right}?256:${left}===${right}?16384:0;`);
    if(op!=='fcom')pop();if(op==='fcompp')pop();
   }else if(op==='fnstsw')code.push(put(a,`(f.condition|f.exceptions|(((t+${top})&7)<<11))`));
   else{
    const source=compileInstruction(i,instructionIndex,dead.has(i.address));if(source.includes('m.slow'))throw Error('Unsupported local block instruction');
    if(index===length-1){code.push(commit());code.push(source);}else code.push(source);
   }
  }
 }catch{return null;}
 // If the last operation is floating point, it did not emit a branch commit.
 if(block.at(-1)[0].mnemonic.startsWith('f'))code.push(commit());
 const guard=['(f.cw&0xf00)===0',...new Set(guards)].join('&&');
 const body=`const r=m.r,f=m.f,t=f.top;if(!(${guard}))return fallback(m);m.count+=${length};let v0,v1,v2,v3,v4,v5,v6,v7;${code.join('\n')}\nreturn ${end};`;
 return new Function('m','fallback',body);
}
