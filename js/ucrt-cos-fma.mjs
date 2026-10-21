"use strict";
// Portable lift of the inspected Windows UCRT FMA3 cosine path. Constants and
// evaluation order come from code, never captured transcendental outputs.
// Finite |x| < 20,000,000 only; the large-argument reduction is not translated.
const view=new DataView(new ArrayBuffer(8));
function parts(x){view.setFloat64(0,x,true);const b=view.getBigUint64(0,true),exp=Number((b>>52n)&2047n);
 if(exp===2047)throw new Error('finite FMA operands required');
 let n=(b&0xfffffffffffffn)|(exp?0x10000000000000n:0n);if(b>>63n)n=-n;
 return {n,e:(exp?exp-1023:-1022)-52};}
function fma(a,b,c){
 const x=parts(a),y=parts(b),z=parts(c),pe=x.e+y.e,e=Math.min(pe,z.e);
 let n=(x.n*y.n<<BigInt(pe-e))+(z.n<<BigInt(z.e-e));
 if(n===0n)return 0;
 const negative=n<0n;if(negative)n=-n;
 const shift=Math.max(0,n.toString(2).length-53);
 if(shift){const unit=1n<<BigInt(shift),remainder=n&(unit-1n);n>>=BigInt(shift);
  if(remainder*2n>unit||remainder*2n===unit&&(n&1n))n++;}
 const result=Number(n)*2**(e+shift);
 if(!Number.isFinite(result)||result!==0&&Math.abs(result)<2**-1022)throw new Error('FMA result outside translated normal range');
 return negative?-result:result;
}
const C=[0.041666666666666664,-0.0013888888888887398,2.4801587298767044e-5,
 -2.755731727234489e-7,2.0876146382372144e-9,-1.138263981623609e-11];
const S=[-0.16666666666666666,0.00833333333333095,-0.00019841269836761127,
 2.7557316103728802e-6,-2.5051132068021698e-8,1.5918144304485914e-10];
function ucrtCosFinite(value){
 const x=Math.abs(value);if(!Number.isFinite(x)||x>=20000000)return null;
 if(x<=0.7853981633974483){
  if(x<2**-27)return 1;
  if(x<2**-13)return fma(-value,value*0.5,1);
  const z=value*value;let p=C[5];for(let i=4;i>=0;i--)p=fma(p,z,C[i]);
  return fma(fma(p,z,-0.5),z,1);
 }
 // UCRT's compensated FMA reduction to a multiple of pi/2.
 const n=fma(x,0.6366197723675814,6755399441055744)-6755399441055744;
 let r=fma(-n,1.5707963267948966,x);
 const tail=6.123233995736757e-17,product=n*tail,error=fma(n,tail,-product);
 let reduced=r-product,correction=(r-reduced)-product;
 r=fma(-n,tail,r);
 correction=((reduced-r)+correction)-error;
 const low=fma(-n,8.478427660368898e-32,correction),quadrant=n&3,z=r*r;
 let result;
 if(quadrant&1){
  let p=fma(z,S[5],S[4]);for(let i=3;i>=1;i--)p=fma(p,z,S[i]);
  const cube=r*z;let correction=low*0.5-cube*p;
  correction=z*correction-low;correction=fma(-cube,S[0],correction);
  result=r-correction;
 }else{
  const half=z*0.5,high=1-half;let correction=(1-high)-half;
  correction=fma(-r,low,correction);
  let p=fma(z,C[5],C[4]);for(let i=3;i>=0;i--)p=fma(p,z,C[i]);
  result=fma(p,z*z,correction)+high;
 }
 return (quadrant+1)&2?-result:result;
}
export {ucrtCosFinite,fma};
