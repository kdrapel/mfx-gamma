import {FastOpeningSequence} from '../js/fast-opening-sequence.mjs';
import {SequenceSeek,decodeSequenceState} from '../js/sequence-seek.mjs';
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join(''),sha=async b=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',b)));
async function fetchChecked(url){const r=await fetch(url);if(!r.ok)throw new Error(`Loading failed (${r.status})`);return r;}
let ready,state,queue=Promise.resolve(),latestRequest;
async function load(){
 const metadataText=await(await fetchChecked(new URL('./assets/opening-20s.json',import.meta.url))).text();
 const metadata=JSON.parse(metadataText);
 const extraText=await(await fetchChecked(new URL('./assets/opening-plan-extra.json',import.meta.url))).text();
 const extra=JSON.parse(extraText);
 if(extra.parent_ram.sha256!==metadata.seed_sha256)throw new Error('Expanded code input changed');
 metadata.plan={instructions:extra.instructions};
 const compressed=await fetchChecked(new URL('./assets/'+metadata.seed_file,import.meta.url));
 const memory=new Uint8Array(await new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 if(await sha(memory)!==metadata.seed_sha256)throw new Error('Opening input integrity failure');
 for(const mutation of metadata.mutations){const bytes=new Uint8Array(mutation.hex.match(/../g).map(b=>parseInt(b,16)));if(mutation.address<0||mutation.address+bytes.length>memory.length)throw new Error('Invalid opening input');memory.set(bytes,mutation.address);}
 if(await sha(memory)!==metadata.initial_ram_sha256)throw new Error('Opening initialization integrity failure');
 const chapters=await(await fetchChecked(new URL('./assets/chapters.json',import.meta.url))).json();
 const metadataHash=await sha(new TextEncoder().encode(metadataText));
 if(metadataHash!==chapters.source_sha256)throw Error('Chapter timeline input changed');
 const checkpoints=await(await fetchChecked(new URL('./assets/seek/manifest.json',import.meta.url))).json();
 if(!checkpoints.pass||checkpoints.metadata_sha256!==metadataHash||checkpoints.plan_sha256!==await sha(new TextEncoder().encode(extraText)))throw Error('Seek checkpoint inputs changed; rebuild checkpoints');
 let verifiedSources;
 async function loadCheckpoint(entry){
  verifiedSources??=Promise.all(checkpoints.sources.filter(s=>s.path.startsWith('js/')).map(async source=>{
   const bytes=await(await fetchChecked(new URL('../'+source.path,import.meta.url))).arrayBuffer();
   if(await sha(bytes)!==source.sha256)throw Error('Seek checkpoint code changed; rebuild checkpoints');
  }));await verifiedSources;
  const [stateResponse,ramResponse]=await Promise.all([fetchChecked(new URL('./assets/seek/'+entry.state_file,import.meta.url)),fetchChecked(new URL('./assets/seek/'+entry.ram_file,import.meta.url))]);
  const text=await stateResponse.text();if(await sha(new TextEncoder().encode(text))!==entry.state_sha256)throw Error('Seek state integrity failure');
  const compressed=await ramResponse.arrayBuffer();if(await sha(compressed)!==entry.compressed_sha256)throw Error('Seek compressed RAM integrity failure');
  const ram=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(await sha(ram)!==entry.ram_sha256)throw Error('Seek RAM integrity failure');
  return decodeSequenceState(text,ram);
 }
 const controller=new FastOpeningSequence(memory,{...metadata,flare_clip_empty:true,record_ports:false});controller.initialize();
 return {metadata,controller,memory,chapters:chapters.chapters,seeker:new SequenceSeek(controller,chapters.chapters,{diskCheckpoints:checkpoints.checkpoints,loadCheckpoint})};
}
async function validate(frame){
 const {metadata, memory}=state,expected=metadata.frames[frame.frame-1];
 if(!expected||frame.time_counts!==expected.time_counts)throw Error('Invalid canonical seek schedule');
 if(await sha(memory.subarray(0x223d14,0x223d14+0x32f1*4))!==expected.grid_sha256||await sha(frame.indices)!==expected.vga_sha256||await sha(new Uint8Array(frame.palette.flat()))!==expected.palette_sha256||expected.instructions!==undefined&&frame.instructions!==expected.instructions)
  throw Error(`Seek frame ${frame.frame} differs from oracle`);
}
async function handle(data){try{
 const started=performance.now();ready??=load();state??=await ready;
 const {metadata:m,controller,memory}=state,realtime=data.clock==='realtime';
 if(data.request_id!==latestRequest)return;
 if(data.type==='seek'){
  const byTime=data.seconds!==undefined;
  if(byTime&&(!Number.isFinite(data.seconds)||data.seconds<0||data.seconds>143))throw Error('Invalid seek time');
  const target=byTime?Math.max(30000,Math.round(data.seconds*1193182)):null;
  const chapter=byTime?m.frames.findLast(f=>f.time_counts<=target):state.chapters.find(c=>c.id===data.chapter);
  if(!chapter)throw Error('Unknown seek position');
  let frame=await state.seeker.seek(chapter.frame,{validate,cancelled:()=>data.request_id!==latestRequest,
   progress:seconds=>postMessage({type:'progress',request_id:data.request_id,elapsed:seconds,target:byTime?data.seconds:chapter.seconds})});
  if(!frame)return;
  let expected=m.frames[frame.frame-1];
  if(byTime&&target>=controller.minimumTime()&&!frame.exited){frame=controller.renderAt(target,true);expected=null;}
  await sendFrame(frame,expected,byTime,started,data,true);return;
 }
 let target;
 if(realtime){target=controller.frame===0?30000:Math.max(30000,Math.round(data.time_counts));
  const earliest=controller.minimumTime();
  if(target<earliest){await new Promise(resolve=>setTimeout(resolve,(earliest-target)*1000/1193182));target=earliest;}
 }
 const frame=realtime?controller.renderAt(target,true):controller.next();if(!frame)throw new Error('Opening complete; restart to play again');
 const canonical=!realtime||frame.frame===1&&target===30000;
 const expected=canonical?m.frames[frame.frame-1]:null;
 await sendFrame(frame,expected,realtime,started,data,false);
 }catch(e){postMessage({type:'error',request_id:data.request_id,message:e.message,frame:(state?.controller.frame??0)+1});}}
async function sendFrame(frame,expected,realtime,started,data,seeked){
 const {metadata:m,controller,memory}=state;
 const grid=await sha(memory.subarray(0x223d14,0x223d14+0x32f1*4));
 const vga=await sha(frame.indices),paletteHash=await sha(new Uint8Array(frame.palette.flat()));
 if(expected&&(grid!==expected.grid_sha256||vga!==expected.vga_sha256||paletteHash!==expected.palette_sha256||expected.instructions!==undefined&&frame.instructions!==expected.instructions))
  throw new Error(`Opening frame ${frame.frame} differs from oracle`);
 const done=realtime?Boolean(frame.exited):controller.frame===m.frames.length;
 const memoryHash=done?await sha(memory):undefined;
 if(done&&expected&&memoryHash!==m.memory_sha256)throw new Error('Opening final RAM differs from oracle');
 postMessage({type:'frame',request_id:data.request_id,seeked,seed:'opening',frame:frame.frame,time_counts:frame.time_counts,elapsed:frame.seconds,duration:realtime||seeked?undefined:m.target_times.at(-1)/1193182,done,validated:Boolean(expected),validation:expected?'oracle checked':'live computed',memory_sha256:memoryHash,
  indices:frame.indices,palette:frame.palette,seconds:(performance.now()-started)/1000,grid_sha256:grid,vga_sha256:vga,
  palette_sha256:paletteHash,instructions:frame.instructions,scene_time_rows:frame.scene_time_rows,music_order:frame.order,music_row:frame.row,clipped_flare_rows:controller.machine.clippedFlareRows??0},[frame.indices.buffer]);
 }
onmessage=({data})=>{if(!['render','seek'].includes(data.type))return;latestRequest=data.request_id;queue=queue.then(()=>handle(data));};
