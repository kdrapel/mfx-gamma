// Optimized execution of the measured Unicorn numeric profile. Exact dyadic
// fallback retains extended intermediates and float32 midpoint decisions.
import {from64Bits,to64Bits,raw80,round,add,subtract,multiply,divide} from './finite-arithmetic.mjs';
import {sqrtFinite} from './intersection-machine.mjs';
import {architecturalConstant,transcendental,asNumber,preciseLog,preciseExp2} from './transcendental-candidate.mjs';
const conversion=new DataView(new ArrayBuffer(8));
function numberBits(n){conversion.setFloat64(0,n,true);return conversion.getBigUint64(0,true);}
const dyadic=v=>typeof v==='number'?from64Bits(numberBits(v)):v;
function nan(negative=true){conversion.setBigUint64(0,negative?0xfff8000000000000n:0x7ff8000000000000n,true);return conversion.getFloat64(0,true);}
const negativeNaN=nan(),positiveNaN=nan(false);
const ops={add,sub:subtract,mul:multiply,div:divide};
const logTwo=preciseLog(2),logCache=new Map(),expCache=new Map(),constants=new Map();
function cached(cache,x,fn){if(cache.has(x))return cache.get(x);const v=fn(x);if(cache.size>=4096)cache.clear();cache.set(x,v);return v;}
function midpoint(n){conversion.setFloat64(0,n,true);return (conversion.getUint32(0,true)&0x1fffffff)===0x10000000;}
function integer(v,rc){
 const d=dyadic(v);if(d.infinity||d.nan)throw new Error('Nonfinite integer conversion unsupported');
 let n=d.n;if(d.e>=0)return n<<BigInt(d.e);const denominator=1n<<BigInt(-d.e),remainder=n%denominator;n/=denominator;
 if(remainder){if(rc===1&&d.n<0n)n--;else if(rc===2&&d.n>0n)n++;else if(rc===0){const r=remainder<0n?-remainder:remainder;if(r*2n>denominator||(r*2n===denominator&&(n&1n)))n+=d.n<0n?-1n:1n;}}
 return n;
}
function roundedNumber(v,rc){
 if(rc===1)return Math.floor(v);if(rc===2)return Math.ceil(v);if(rc===3)return Math.trunc(v);
 const n=Math.floor(v),fraction=v-n;
 const r=fraction>.5||fraction===.5&&n%2!==0?n+1:n;
 return r===0&&(v<0||Object.is(v,-0))?-0:r;
}
export class FastFpu{
 constructor(cw){this.cw=cw;this.top=0;this.condition=0;this.exceptions=0;this.slots=new Float64Array(8);this.quality=new Uint8Array(8);this.exact=Array(8).fill(null);this.empty=Array(8).fill(true);}
 get precision(){return (this.cw&0x300)===0?24:64;}
 get rc(){return (this.cw>>>10)&3;}
 get sw(){return this.condition|this.exceptions|(this.top<<11);}
 get(i=0){const p=(this.top+i)&7;if(this.empty[p])throw new Error('Unsupported empty FPU operand');return this.exact[p]??this.slots[p];}
 set(v,i=0){const p=(this.top+i)&7;if(typeof v==='number'){this.slots[p]=v;this.exact[p]=null;this.quality[p]=Math.fround(v)===v?24:53;}else{this.exact[p]=v;this.quality[p]=0;}this.empty[p]=false;}
 push(v){this.top=(this.top+7)&7;if(!this.empty[this.top])throw new Error('FPU overflow');this.set(v);}
 pop(){const v=this.get();this.empty[this.top]=true;this.top=(this.top+1)&7;return v;}
 discard(){const p=this.top;if(this.empty[p])throw new Error('Unsupported empty FPU operand');this.empty[p]=true;this.top=(p+1)&7;}
 swap(i){const a=this.get(),b=this.get(i);this.set(b);this.set(a,i);}
 calc(kind,a,b){
  const x=typeof a==='number'?a:asNumber(a),y=typeof b==='number'?b:asNumber(b);
  if(kind==='div'&&y===0&&!Number.isNaN(x)){
   if(!(this.cw&4))throw new Error('Unmasked x87 zero division');this.exceptions|=4;
   if(x===0)return negativeNaN;
  }
  if(this.precision===24&&this.rc===0&&typeof a==='number'&&typeof b==='number'){
   let v=kind==='add'?a+b:kind==='sub'?a-b:kind==='mul'?a*b:a/b;
   if(Number.isNaN(v))return Number.isNaN(a)?a:Number.isNaN(b)?b:negativeNaN;
   if(!Number.isFinite(v))return v;
   // A rounded binary64 operation can affect float32 rounding only when it
   // lands precisely on a float32 midpoint. Resolve those cases exactly.
   if((v===0||Math.abs(v)>=2**-126&&Math.abs(v)<=3.4028234663852886e38)&&(!midpoint(v)||kind!=='div'&&Math.fround(a)===a&&Math.fround(b)===b))return Math.fround(v);
  }
  let result;
  if(kind==='div'&&y===0&&!Number.isNaN(x))result=x===0?dyadic(negativeNaN):{n:(x<0)!==Object.is(y,-0)?-1n:1n,e:0,negativeZero:false,infinity:true};
  else result=ops[kind](dyadic(a),dyadic(b),this.precision,this.rc);
  return this.precision===24?asNumber(result):result;
 }
 binary(kind,v,i=0){this.set(this.calc(kind,this.get(i),v),i);}
 binaryPop(kind,i,reverse=false){const a=this.get(i),b=this.get();this.set(this.calc(kind,reverse?b:a,reverse?a:b),i);this.discard();}
 compare(v,pop=true){
  const a=this.get();if(typeof a==='number'&&typeof v==='number')this.condition=Number.isNaN(a)||Number.isNaN(v)?0x4500:a<v?0x100:a===v?0x4000:0;
  else{const x=dyadic(a),y=dyadic(v);if(x.nan||y.nan)this.condition=0x4500;else if(x.infinity||y.infinity){const l=x.infinity?(x.n<0n?-1:1):0,r=y.infinity?(y.n<0n?-1:1):0;this.condition=l<r?0x100:l===r?0x4000:0;}else{const e=Math.min(x.e,y.e),l=x.n<<BigInt(x.e-e),r=y.n<<BigInt(y.e-e);this.condition=l<r?0x100:l===r?0x4000:0;}}
  if(pop)this.discard();
 }
 sqrtValue(v){if(typeof v==='number'&&this.precision===24&&this.rc===0){if(v<0)throw new Error('Negative sqrt unsupported');const r=Math.sqrt(v);if((r===0||Math.abs(r)>=2**-126&&Math.abs(r)<=3.4028234663852886e38)&&!midpoint(r))return Number.isNaN(v)?v:Math.fround(r);}const r=sqrtFinite(dyadic(v),this.precision,this.rc);return this.precision===24?asNumber(r):r;}
 sqrt(){this.set(this.sqrtValue(this.get()));}
 sign(abs=false){const v=this.get();if(typeof v==='number'){if(Number.isNaN(v)){const negative=Boolean(numberBits(v)>>63n);this.set(abs?positiveNaN:nan(!negative));}else this.set(abs?Math.abs(v):-v);}else this.set({...v,n:abs?(v.n<0n?-v.n:v.n):-v.n,negativeZero:abs?false:v.n===0n?!v.negativeZero:false,...(v.nan?{negative:abs?false:!v.negative}:{})});}
 f32(v){if(typeof v==='number'&&this.rc===0)return Math.fround(v);return asNumber(round(dyadic(v),24,this.rc));}
 bits64(v){return typeof v==='number'?numberBits(v):to64Bits(v,this.rc);}
 constant(name){const key=name+this.rc;if(!constants.has(key))constants.set(key,architecturalConstant(name,this.rc));this.push(constants.get(key));}
 transcend(name){const x=this.get(),a=typeof x==='number'?x:asNumber(x);if(name==='fyl2x'){if(!(a>0))throw new Error('Unsupported logarithm domain');const y=this.get(1),b=typeof y==='number'?y:asNumber(y);this.set((cached(logCache,a,preciseLog)/logTwo)*b,1);this.pop();}else if(name==='f2xm1'){if(Math.abs(a)>1)throw new Error('Unsupported F2XM1 domain');this.set(cached(expCache,a,preciseExp2)-1);}else this.set(asNumber(transcendental(name,dyadic(x))));}
 integer(){const v=this.get();if(typeof v==='number'?!Number.isFinite(v):v.infinity||v.nan)return -2147483648n;return integer(v,this.rc);}
 int32(){const v=this.get();if(typeof v==='number'){if(!Number.isFinite(v))return 0x80000000;const n=roundedNumber(v,this.rc);return n< -2147483648||n>=2147483648?0x80000000:n>>>0;}const n=this.integer();return n< -2147483648n||n>2147483647n?0x80000000:Number(BigInt.asUintN(32,n));}
 roundInteger(){const v=this.get();if(typeof v==='number'?!Number.isFinite(v):v.infinity||v.nan)return;if(typeof v==='number'){const n=roundedNumber(v,this.rc);if(Number.isSafeInteger(n)){this.set(n);return;}}const n=this.integer(),negative=typeof v==='number'?v<0||Object.is(v,-0):v.n<0n||v.negativeZero;this.set({n,e:0,negativeZero:n===0n&&negative});}
 scale(){const scale=Math.trunc(asNumber(dyadic(this.get(1))));if(!Number.isSafeInteger(scale)||Math.abs(scale)>1024)throw new Error('Unsupported FSCALE range');const v=dyadic(this.get());this.set({...v,e:v.e+scale});}
 snapshot(){const slots=Array.from(this.slots,(v,i)=>dyadic(this.exact[i]??v));return {profile:'synthetic_empty_unicorn_architectural_not_capture_backend',cw:this.cw,sw:this.sw,tags:this.empty.reduce((w,empty,i)=>w|((empty?3:slots[i].infinity||slots[i].nan?2:slots[i].n===0n?1:0)<<(i*2)),0),slots:slots.map(raw80)};}
}
