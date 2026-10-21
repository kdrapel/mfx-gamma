// A bounded 145 s buffer is synthesized by our own worker from original code
// and samples. Web Audio plays it independently of graphics/main-thread stalls.
// No WAV, recorded soundtrack, oracle PCM or external player is loaded.
export class MusicPlayback{
 constructor(workerUrl,{muted=false,onProgress=()=>{},onReady=()=>{},onError=()=>{}}={}){
  this.workerUrl=workerUrl;this.muted=muted;this.onProgress=onProgress;this.onReady=onReady;this.onError=onError;
  this.offset=0;this.lastPosition=0;this.generation=0;this.prepared=false;
 }
 prepare(){
  if(this.preparing)return this.preparing;
  this.preparing=new Promise((resolve,reject)=>{
   const worker=this.worker=new Worker(this.workerUrl,{type:'module'});
   const fail=error=>{worker.terminate();this.onError(error);reject(error);};
   worker.onerror=e=>fail(Error(e.message));
   worker.onmessage=({data})=>{
    if(data.type==='progress'){this.onProgress(data.percent);return;}
    if(data.type==='error'){fail(Error(data.message));return;}
    if(data.type!=='ready')return;
    this.buffer=new AudioBuffer({numberOfChannels:2,length:data.length,sampleRate:data.sample_rate});
    this.buffer.copyToChannel(data.left,0);this.buffer.copyToChannel(data.right,1);
    this.info={...data,left:undefined,right:undefined};this.prepared=true;worker.terminate();this.worker=null;
    this.onReady(this.info);resolve(this.info);
   };
   worker.postMessage({type:'prepare',duration:145});
  });return this.preparing;
 }
 audibleContextTime(){
  const c=this.context,t=c.getOutputTimestamp?.();
  if(t?.performanceTime>0&&t.contextTime>0)
   return Math.min(c.currentTime,t.contextTime+Math.max(0,performance.now()-t.performanceTime)/1000);
  return Math.max(0,c.currentTime-(c.outputLatency||c.baseLatency||0));
 }
 position(){
  if(!this.source||this.context.state!=='running')return this.lastPosition;
  const position=this.offset+Math.max(0,this.audibleContextTime()-this.startedAt);
  this.lastPosition=Math.min(this.buffer.duration,Math.max(this.lastPosition,position));return this.lastPosition;
 }
 pause(){
  const position=this.position();this.generation++;
  if(this.source){this.source.onended=null;this.source.stop();this.source.disconnect();this.source=null;}
  this.offset=position;this.lastPosition=position;return position;
 }
 seek(position){this.pause();this.offset=this.lastPosition=Math.max(0,Math.min(this.buffer?.duration??145,position));}
 async play(position=this.offset){
  if(!this.prepared)throw Error('Soundtrack not prepared');
  this.seek(position);const generation=this.generation;
  if(!this.context){
   this.context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
   this.gain=this.context.createGain();this.gain.gain.value=this.muted?0:1;this.gain.connect(this.context.destination);
  }
  await this.context.resume();if(generation!==this.generation)return false;
  const source=this.source=this.context.createBufferSource();source.buffer=this.buffer;source.connect(this.gain);
  this.startedAt=this.context.currentTime+.03;this.lastPosition=this.offset;
  source.onended=()=>{if(this.source===source){this.source=null;this.offset=this.lastPosition=this.buffer.duration;}};
  source.start(this.startedAt,this.offset);return true;
 }
 setMuted(muted){this.muted=muted;if(this.gain)this.gain.gain.setValueAtTime(muted?0:1,this.context.currentTime);}
 get playing(){return Boolean(this.source);}
 diagnostics(){return {ready:this.prepared,playing:this.playing,position:this.position(),context_state:this.context?.state,
  context_time:this.context?.currentTime,output_time:this.context?this.audibleContextTime():null,
  base_latency:this.context?.baseLatency,output_latency:this.context?.outputLatency,muted:this.muted,profile:this.info?.profile};}
}
