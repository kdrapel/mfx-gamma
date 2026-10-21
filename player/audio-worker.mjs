import {NativeMusic,AUDIO_RATE} from '../js/native-music.mjs';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function checked(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(`Audio input load failed (${r.status})`);return r;}
onmessage=async({data})=>{if(data.type!=='prepare')return;try{
 const duration=data.duration??145;if(duration!==145)throw Error('Unsupported soundtrack duration');
 const meta=await(await checked(new URL('./assets/audio.json',import.meta.url))).json();
 const plan=await(await checked(new URL('./assets/opening-plan-extra.json',import.meta.url))).json();
 const response=await checked(new URL('./assets/'+meta.seed_file,import.meta.url));
 const memory=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 if(await hash(memory)!==meta.seed_sha256||plan.parent_ram.sha256!==meta.seed_sha256)throw Error('Audio input integrity failure');
 for(const mutation of meta.mutations){const bytes=Uint8Array.from(mutation.hex.match(/../g),b=>parseInt(b,16));memory.set(bytes,mutation.address);}
 const music=new NativeMusic(memory,meta,plan);music.initialize();
 const length=duration*AUDIO_RATE,left=new Float32Array(length),right=new Float32Array(length);
 let position=0,lastPercent=-1,peak=0,nonzero=0;const started=performance.now();
 while(position<length){
  const samples=music.interval(),count=Math.min(samples.length/2,length-position);
  for(let i=0;i<count;i++){const l=samples[i*2],r=samples[i*2+1];left[position+i]=l/32768;right[position+i]=r/32768;peak=Math.max(peak,Math.abs(l),Math.abs(r));if(l||r)nonzero++;}
  position+=count;const percent=Math.floor(position/length*100);
  if(percent!==lastPercent){postMessage({type:'progress',percent});lastPercent=percent;await new Promise(resolve=>setTimeout(resolve,0));}
 }
 postMessage({type:'ready',left,right,sample_rate:AUDIO_RATE,length,peak,nonzero,seconds:(performance.now()-started)/1000,
  profile:meta.profile,first_irq_counts:music.initialPeriod},[left.buffer,right.buffer]);
 }catch(e){postMessage({type:'error',message:e.message});}};
