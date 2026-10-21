// Candidate Unicorn host-double operations. Each supported use needs oracle
// validation; this module alone establishes no DOSBox/hardware equivalence.
import {from64Bits,to64Bits,round} from './finite-arithmetic.mjs';
import {ucrtCosFinite} from './ucrt-cos-fma.mjs';
const view=new DataView(new ArrayBuffer(8));
export function fromNumber(value){view.setFloat64(0,value,true);return from64Bits(view.getBigUint64(0,true));}
export function asNumber(value){view.setBigUint64(0,to64Bits(value,0),true);return view.getFloat64(0,true);}
const Q=320;let ln2=0n,power=3n;
for(let k=0;k<220;k++){ln2+=(1n<<BigInt(Q+1))/(BigInt(2*k+1)*power);power*=9n;}
// Derive architectural constants from the convergent log series. No captured
// transcendental values or reference outputs are used as runtime constants.
export const architecturalConstant=(name,rc)=>round({n:name==='fldln2'?ln2:(1n<<BigInt(Q*2))/ln2,e:-Q,negativeZero:false},64,rc);
const unit=1n<<BigInt(Q);
function fixed(v){return v.e+Q>=0?v.n<<BigInt(v.e+Q):v.n>>BigInt(-v.e-Q);}
export function preciseExp2(x){
 if(Math.abs(x)>1)throw new Error('Precise exp2 outside reduced range');
 const y=fixed(fromNumber(x))*ln2/unit;let term=unit,sum=unit;
 for(let k=1;k<512;k++){term=term*y/(unit*BigInt(k));if(!term)break;sum+=term;}
 return asNumber(round({n:sum,e:-Q,negativeZero:false},53,0));
}
export function preciseLog(x){
 if(!(x>0)||!Number.isFinite(x))throw new Error('Precise log outside positive finite domain');
 const v=fromNumber(x),length=v.n.toString(2).length,exponent=v.e+length-1,mantissa=(v.n<<BigInt(Q))/(1n<<BigInt(length-1));
 const z=(mantissa-unit)*unit/(mantissa+unit),square=z*z/unit;let power=z,sum=0n;
 for(let k=0;k<512;k++){const term=power/BigInt(2*k+1);if(!term)break;sum+=term;power=power*square/unit;}
 return asNumber(round({n:2n*sum+BigInt(exponent)*ln2,e:-Q,negativeZero:false},53,0));
}
export function transcendental(name,x,y){
 const a=asNumber(x);let value;
 if(name==='fsin')value=Math.sin(a);
 else if(name==='fcos'){value=ucrtCosFinite(a);if(value===null)throw new Error('Cosine outside bounded host-library range');}
 // Unicorn 2.1.4 fpu_helper.c uses log(x)/log(2), then multiplication,
 // and pow(2,x)-1. Preserve those separately rounded host-double operations.
 else if(name==='fyl2x'){if(a<=0)throw new Error('Unsupported logarithm domain');value=(preciseLog(a)/preciseLog(2))*asNumber(y);}
 else if(name==='f2xm1'){if(Math.abs(a)>1)throw new Error('Unsupported F2XM1 domain');value=preciseExp2(a)-1;}
 else throw new Error('Unknown transcendental '+name);
 return fromNumber(value);
}
