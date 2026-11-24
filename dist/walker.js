import { Gait } from './gait.js';

const size = 192;
function fullCrop(aspect) { return { cx:aspect/2, cy:.5, side:Math.max(aspect,1) }; }
function subjectCrop(points, aspect, previous) {
  const torso = [5,6,11,12].map(i => points[i]);
  if (torso.some(p => p.visibility < .3)) return null;
  const visible = points.filter(p => p.visibility > .30);
  const xs = visible.map(p => p.x*aspect), ys = visible.map(p => p.y);
  const xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);
  const upper=(points[5].y+points[6].y)/2, lower=(points[11].y+points[12].y)/2;
  const side=Math.min(Math.max(aspect,1), Math.max(.33, (xmax-xmin)*1.48, (ymax-ymin)*1.39, Math.abs(lower-upper)*3.8));
  const blend=(from,to)=>from*.52+to*.48;
  return {cx:blend(previous.cx,(xmin+xmax)/2),cy:blend(previous.cy,(ymin+ymax)/2),side:blend(previous.side,side)};
}

export class Walker {
  constructor(onMotion, onState) {
    this.onMotion = onMotion; this.onState = onState;
    this.gait = new Gait();
    this.session = 0; this.epoch = 0;
    this.frame = document.createElement('canvas');this.frame.width=this.frame.height=size;
    this.context = this.frame.getContext('2d', { alpha:false, willReadFrequently:true });
    this.state = 'off';
  }
  status(value) {
    if (value !== this.state) { this.state=value; this.onState(value); }
  }
  reset() {
    ++this.epoch;
    this.crop=null;this.misses=0;this.gait.reset();this.lastVideoTime=-1;
    this.onMotion(0,0);
  }
  start() {
    if (this.enabled) return;
    this.enabled=true;this.reset();this.status('loading');
    this.lastSample=0;this.interval=82;
    const session=++this.session;
    if (typeof Worker==='undefined') { void this.onMain(session);return; }
    try {
      const worker=new Worker(new URL('./pose-worker.js',import.meta.url));
      this.worker=worker;
      const fail=()=>{
        if (this.worker!==worker || session!==this.session) return;
        worker.terminate();this.worker=null;this.busy=false;this.ready=false;
        this.reset();void this.onMain(session);
      };
      worker.onerror=fail;
      worker.onmessage=({data})=>{
        if(this.worker!==worker || session!==this.session)return;
        if(data.type==='unavailable'){ fail();return; }
        if(data.type==='ready'){ this.ready=true;this.status('search');return; }
        this.busy=false;
        if(data.epoch===this.epoch) this.decode(data.keypoints,data.crop,data.time);
      };
      this.workerFailed=fail;
      worker.postMessage({type:'start'});
    } catch { void this.onMain(session); }
  }
  async onMain(session) {
    this.status('loading');
    try {
      const { createDetector }=await import('./pose-runtime.js');
      if(session!==this.session)return;
      const detector=await createDetector();
      if(session!==this.session){detector.close();return;}
      this.detector=detector;this.ready=true;this.interval=125;this.status('search');
    } catch {if(session===this.session)this.status('unavailable');}
  }
  stop() {
    if(!this.enabled)return;
    this.enabled=this.ready=this.busy=false;++this.session;
    this.worker?.terminate();this.worker=null;this.detector?.close();this.detector=null;
    this.reset();this.status('off');
  }
  decode(raw,crop,time) {
    const points = [];
    for (let i=0;i<17;i++) {
      points.push({x:(crop.cx+(raw[i*3+1]-.5)*crop.side)/this.aspect, y:crop.cy+(raw[i*3]-.5)*crop.side, visibility:raw[i*3+2]});
    }
    const next=subjectCrop(points,this.aspect,crop);
    if(next) {this.crop=next;this.misses=0;}
    else if(++this.misses>=3) this.crop=fullCrop(this.aspect);
    this.receive(next?points:null,time);
  }
  receive(points,time) {
    const {pace,seen}=this.gait.measure(points,this.aspect,time);
    this.onMotion(pace,performance.now());
    this.status(!seen?'search':pace?'walking':'still');
  }
  sample(source,aspect,time) {
    if(!this.ready || this.busy || source.readyState<2 || !source.videoWidth || source.currentTime===this.lastVideoTime || time-this.lastSample<this.interval)return;
    if(!this.aspect || Math.abs(aspect-this.aspect)>.02)this.reset();
    this.aspect=aspect;this.lastVideoTime=source.currentTime;this.lastSample=time;
    const crop=this.crop||fullCrop(aspect);
    // Crop the same field of view as the recording. Letterbox only the model's
    // small square input, keeping its coordinates reversible in portrait too.
    const vh=Math.min(source.videoHeight,source.videoWidth/aspect),vw=vh*aspect;
    const vx=(source.videoWidth-vw)/2,vy=(source.videoHeight-vh)/2;
    const side=crop.side*vh, x=vx+(crop.cx-crop.side/2)*vh, y=vy+(crop.cy-crop.side/2)*vh;
    const left=Math.max(vx,x), top=Math.max(vy,y), right=Math.min(vx+vw,x+side), bottom=Math.min(vy+vh,y+side);
    const ctx=this.context;
    ctx.fillStyle='black';ctx.fillRect(0,0,size,size);
    if(right>left&&bottom>top)ctx.drawImage(source,left,top,right-left,bottom-top,(left-x)*size/side,(top-y)*size/side,(right-left)*size/side,(bottom-top)*size/side);
    const rgba=ctx.getImageData(0,0,size,size).data;
    if(this.worker){
      this.busy=true;
      try{this.worker.postMessage({rgba:rgba.buffer,time,epoch:this.epoch,crop},[rgba.buffer]);}
      catch{this.workerFailed();}
    }else if(this.detector){
      try{
        const begin=performance.now(), result=this.detector.predict(rgba);
        this.interval=Math.max(110,Math.min(260,(performance.now()-begin)*2.5));
        this.decode(result,crop,time);
      }catch{this.ready=false;this.reset();this.status('unavailable');}
    }
  }
}
