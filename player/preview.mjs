import {MusicPlayback} from '../js/music-playback.mjs';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),selector=document.querySelector('#scene');
const play=document.querySelector('#play'),step=document.querySelector('#step'),restart=document.querySelector('#restart');
const previous=document.querySelector('#previous'),next=document.querySelector('#next');
const gate=document.querySelector('#gate'),start=document.querySelector('#start'),hud=document.querySelector('#hud'),timeDisplay=document.querySelector('#time');
const timeline=document.querySelector('#timeline'),statsToggle=document.querySelector('#stats-toggle'),geekPanel=document.querySelector('#geek-panel');
const loading=document.querySelector('#loading'),loadingText=document.querySelector('#loading-text'),notice=document.querySelector('#notice');
let scrubbing=false,lastStats=0,presentedTimes=[];
let worker,busy=false,seeking=false,starting=false,mode='paused',pending=null,failed=false,ended=false,frame=0,requestId=0,chapters=[],computeTimer;
let computeFps='— FPS',frameCosts=[];
let playhead=0,lastElapsed=0;
const audioStatus=document.querySelector('#audio-status'),mute=document.querySelector('#mute');
const music=new MusicPlayback(new URL('./audio-worker.mjs?v=music-1',import.meta.url),{
 muted:new URLSearchParams(location.search).get('mute')==='1',
 onProgress:percent=>{audioStatus.textContent=`Preparing original music… ${percent}%`;start.textContent=`Preparing · ${percent}%`;},
 onReady:()=>{audioStatus.textContent='Original music ready';controls();},
 onError:e=>{music.pause();failed=true;mode='paused';audioStatus.textContent=`Sound stopped: ${e.message}`;controls();}
});
window.gammaMusic=music;mute.checked=music.muted;mute.onchange=()=>music.setMuted(mute.checked);
const stamp=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
function demoTime(){return mode==='playing'?music.position():playhead;}
function title(visible){gate.hidden=!visible;hud.hidden=visible;status.hidden=visible;geekPanel.hidden=visible||!statsToggle.checked;loading.hidden=true;}
function updateStats(force=false){
 geekPanel.hidden=!gate.hidden||!statsToggle.checked;if(geekPanel.hidden)return;
 const now=performance.now();if(!force&&now-lastStats<250)return;lastStats=now;
 presentedTimes=presentedTimes.filter(t=>t>now-1000);
 const data=window.gammaPreviewResult,audio=music.diagnostics();
 document.querySelector('#stats').textContent=`${mode==='playing'?presentedTimes.length:0} FPS displayed · ${computeFps} compute`;
 document.querySelector('#player-details').textContent=data?`Frame ${data.frame.toLocaleString()} · update ${(data.seconds*1000).toFixed(1)} ms · 320 × 160 active pixels`:'Preparing renderer…';
 document.querySelector('#audio-details').textContent=`Audio ${audio.context_state??'ready'} · 48,000 Hz · output latency ${((audio.output_latency??audio.base_latency??0)*1000).toFixed(1)} ms · ${audio.muted?'muted':'sound on'}`;
 document.querySelector('#tracker-details').textContent=data?`Graphics behind audio: ${((audio.position-data.elapsed)*1000).toFixed(1)} ms · order ${data.music_order??'—'} / row ${data.music_row??'—'} · ${Number(data.instructions??0).toLocaleString()} instructions`:'';
}
statsToggle.onchange=()=>updateStats(true);
function controls(){
 play.textContent=mode==='playing'?'Pause':starting?'Starting…':'Play';play.disabled=failed||ended||seeking||starting||!music.prepared||!worker;
 start.disabled=play.disabled||!window.gammaPreviewResult;
 start.textContent=failed?'Unable to start':!music.prepared?'Preparing music…':!window.gammaPreviewResult?'Preparing graphics…':'Start intro';
 step.disabled=failed||ended||busy||starting||!worker||mode==='playing';
 previous.disabled=!chapters.length||selector.selectedIndex<=0;
 next.disabled=!chapters.length||selector.selectedIndex>=chapters.length-1;
 timeline.disabled=failed||!worker;document.querySelector('#backward').disabled=failed||!worker;document.querySelector('#forward').disabled=failed||!worker;
 loading.hidden=!gate.hidden||!seeking;notice.hidden=!failed;if(failed)notice.textContent=status.textContent;
 updateStats();
}
function compute(){
 if(busy||failed||ended)return;
 const time=mode==='playing'?demoTime():lastElapsed+.05;
 if(mode==='playing'&&time<lastElapsed){clearTimeout(computeTimer);computeTimer=setTimeout(()=>{if(mode==='playing')compute();},Math.max(1,Math.min(10,(lastElapsed-time)*1000)));return;}
 busy=true;controls();status.textContent=`Computing frame ${frame+1}…`;
 worker.postMessage({type:'render',request_id:requestId,clock:'realtime',time_counts:Math.round(time*1193182)});
}
function show(data){
 const audioTime=music.position(),wasPlaying=mode==='playing';
 if(data.seeked){playhead=data.elapsed;frameCosts=[];}
 if(data.seconds>0&&!data.seeked){frameCosts.push(data.seconds);if(frameCosts.length>10)frameCosts.shift();computeFps=`${(frameCosts.length/frameCosts.reduce((a,b)=>a+b,0)).toFixed(1)} FPS`;}
 const rgba=new Uint8ClampedArray(320*240*4);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
 for(let i=0;i<data.indices.length;i++){const rgb=data.palette[data.indices[i]],p=(i+320*40)*4;for(let c=0;c<3;c++)rgba[p+c]=(rgb[c]<<2)|(rgb[c]>>4);}
 canvas.getContext('2d').putImageData(new ImageData(rgba,320,240),0,0);frame=data.frame;lastElapsed=data.elapsed??0;ended=Boolean(data.done);
 if(ended){music.pause();mode='paused';}if(mode!=='playing'){playhead=lastElapsed;music.seek(lastElapsed);}
 const chapter=chapters.findLast(c=>c.seconds<=lastElapsed+.000001)??chapters[0];if(chapter)selector.value=chapter.id;
 const seconds=Math.round(lastElapsed);timeDisplay.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} / 2:23`;
 if(!scrubbing)timeline.value=String(Math.min(143,lastElapsed));
 status.textContent=`${chapter?.title??'Gamma'} · ${lastElapsed.toFixed(2)} s · frame ${frame} · ${data.validation}${ended?' · complete':''}`;
 window.gammaPreviewResult={...data,indices:undefined,palette:undefined,audio_time:audioTime,presentation_lag_ms:(audioTime-lastElapsed)*1000};controls();
 if(wasPlaying)presentedTimes.push(performance.now());updateStats();
 if(wasPlaying){window.gammaAVTrace??=[];window.gammaAVTrace.push({wall:performance.now(),audio_time:audioTime,frame_time:lastElapsed,lag_ms:(audioTime-lastElapsed)*1000,frame,seeked:data.seeked});}
 window.gammaPreviewTrace??=[];window.gammaPreviewTrace.push({...window.gammaPreviewResult,wall:performance.now()});
 if(mode==='playing')compute();
}
function reset(){
 worker?.terminate();worker=new Worker(new URL('./opening-worker.mjs?v=chapters-1',import.meta.url),{type:'module'});requestId++;
 clearTimeout(computeTimer);music.seek(0);
 scrubbing=false;timeline.value='0';presentedTimes=[];
 busy=false;seeking=false;starting=false;pending=null;failed=false;ended=false;frame=0;mode='step';playhead=0;lastElapsed=0;frameCosts=[];computeFps='— FPS';window.gammaPreviewResult=null;window.gammaPreviewTrace=[];window.gammaAVTrace=[];
 selector.value=chapters[0].id;
 worker.onmessage=async({data})=>{
  if(data.request_id!==requestId)return;
  if(data.type==='progress'){const percent=Math.min(100,Math.round(data.elapsed/data.target*100));status.textContent=`Seeking… ${percent}%`;loadingText.textContent=status.textContent;return;}
  busy=false;seeking=false;
  if(data.type==='error'){music.pause();failed=true;mode='paused';status.textContent=`Stopped at frame ${data.frame}: ${data.message}. Restart or choose another section.`;controls();return;}
  if(data.seeked&&mode==='playing')try{await music.play(data.elapsed);if(data.request_id!==requestId)return;}catch(e){music.pause();failed=true;mode='paused';status.textContent=`Sound stopped: ${e.message}`;controls();return;}
  if(mode==='paused'){pending=data;status.textContent='Paused.';controls();return;}
  if(mode==='step')mode='paused';show(data);
 };
 worker.onerror=e=>{music.pause();busy=false;seeking=false;failed=true;mode='paused';status.textContent=`Stopped: ${e.message}`;controls();};
 compute();
}
function beginSeek(target,label){
 requestId++;const playing=mode==='playing';clearTimeout(computeTimer);music.pause();starting=false;busy=true;seeking=true;pending=null;failed=false;ended=false;
 scrubbing=false;presentedTimes=[];
 mode=playing?'playing':'step';frameCosts=[];computeFps='— FPS';window.gammaPreviewTrace=[];
 status.textContent=`Seeking to ${label}…`;loadingText.textContent=status.textContent;controls();
 worker.postMessage({type:'seek',request_id:requestId,...target});
}
function seek(){beginSeek({chapter:selector.value},selector.selectedOptions[0].text);}
function seekSeconds(seconds){const target=Math.max(0,Math.min(143,Number(seconds)));if(!Number.isFinite(target))return;timeline.value=String(target);beginSeek({seconds:target},stamp(target));}
timeline.onpointerdown=()=>{scrubbing=true;};
timeline.oninput=()=>{scrubbing=true;timeDisplay.textContent=`${stamp(Number(timeline.value))} / 2:23`;};
timeline.onchange=()=>seekSeconds(timeline.value);
timeline.onpointercancel=()=>{scrubbing=false;timeline.value=String(lastElapsed);};
document.querySelector('#backward').onclick=()=>seekSeconds(demoTime()-15);
document.querySelector('#forward').onclick=()=>seekSeconds(demoTime()+15);
selector.onchange=seek;restart.onclick=reset;
previous.onclick=()=>{selector.selectedIndex--;seek();};next.onclick=()=>{selector.selectedIndex++;seek();};
play.onclick=async()=>{
 if(!gate.hidden)title(false);
 if(mode==='playing'){clearTimeout(computeTimer);playhead=music.pause();mode='paused';status.textContent='Paused.';controls();return;}
 const request=requestId;starting=true;controls();
 try{const started=await music.play(Math.max(playhead,lastElapsed));if(!started||request!==requestId)return;
  starting=false;mode='playing';controls();if(pending){const data=pending;pending=null;show(data);}else compute();
 }catch(e){music.pause();starting=false;failed=true;mode='paused';status.textContent=`Sound stopped: ${e.message}`;controls();}
};
step.onclick=()=>{if(pending){const data=pending;pending=null;show(data);}else{mode='step';compute();}};
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('#shell').requestFullscreen();}catch(e){notice.textContent=`Fullscreen unavailable: ${e.message}`;notice.hidden=false;}}
document.addEventListener('fullscreenchange',()=>{const active=!!document.fullscreenElement,button=document.querySelector('#fullscreen');button.textContent=active?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-pressed',String(active));updateStats(true);});
start.onclick=()=>{if(!start.disabled){title(false);play.click();play.focus({preventScroll:true});}};
document.querySelector('#home').onclick=()=>{title(true);reset();start.focus({preventScroll:true});};
document.querySelector('#fullscreen').onclick=fullscreen;canvas.ondblclick=fullscreen;
document.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.altKey||e.metaKey||['SELECT','INPUT'].includes(document.activeElement.tagName))return;
 if(e.code==='Space'&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();if(!gate.hidden){if(!start.disabled)start.click();}else if(!play.disabled)play.click();}
 if(!gate.hidden)return;
 if(e.code==='ArrowLeft'&&!previous.disabled){e.preventDefault();previous.click();}
 if(e.code==='ArrowRight'&&!next.disabled){e.preventDefault();next.click();}
 if(e.code==='KeyF'){e.preventDefault();fullscreen();}
 if(e.code==='Escape'&&!document.fullscreenElement)document.querySelector('#home').click();
});
async function initialize(){
 title(new URLSearchParams(location.search).get('player')!=='1');
 music.prepare().catch(()=>{});
 const response=await fetch(new URL('./assets/chapters.json',import.meta.url));if(!response.ok)throw Error('Cannot load chapters');
 chapters=(await response.json()).chapters;selector.replaceChildren(...chapters.map(c=>new Option(`${stamp(c.seconds)} — ${c.title}`,c.id)));
 document.querySelector('#seek-marks').replaceChildren(...chapters.map(c=>{const o=document.createElement('option');o.value=String(c.seconds);o.label=c.title;return o;}));
 selector.disabled=false;restart.disabled=false;reset();
}
initialize().catch(e=>{failed=true;status.textContent=e.message;controls();});
