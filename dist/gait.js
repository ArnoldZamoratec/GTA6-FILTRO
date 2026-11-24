// Bilateral leg displacements are measured in torso lengths, independently of
// a camera pan or a change in the subject's size in the picture.
const visible = (point, threshold) => point && point.visibility >= threshold;

function legPair(points, left, right, aspect, torso) {
  if (!visible(points[left],.27) || !visible(points[right],.27)) return null;
  return { x:(points[left].x-points[right].x)*aspect/torso, y:(points[left].y-points[right].y)/torso };
}
function change(a,b) { return a && b ? Math.hypot(a.x-b.x, a.y-b.y) : 0; }

export class Gait {
  constructor() { this.reset(); }
  reset() { this.history=[];this.evidence=0;this.walking=false; }
  measure(points, aspect, time) {
    if (!points || ![5,6,11,12].every(i=>visible(points[i],.30))) {
      this.reset();return {pace:0,seen:false};
    }
    const x=(points[11].x+points[12].x)/2, y=(points[11].y+points[12].y)/2;
    const torso=Math.hypot((x-(points[5].x+points[6].x)/2)*aspect, y-(points[5].y+points[6].y)/2);
    if(torso<.048){this.reset();return {pace:0,seen:false};}
    const feet=legPair(points,15,16,aspect,torso);
    const knees=legPair(points,13,14,aspect,torso);
    if(!feet&&!knees){this.reset();return {pace:0,seen:false};}
    const last=this.history.at(-1);
    if(last && (time-last.time>720 || time<=last.time || Math.hypot((x-last.x)*aspect,y-last.y)>Math.max(.15,torso*.95)))this.reset();
    this.history=this.history.filter(frame=>time-frame.time<=570);
    const ref=this.history.reduce((best,f)=>!best||Math.abs(time-f.time-240)<Math.abs(time-best.time-240)?f:best,null);
    this.history.push({time,feet,knees,x,y});
    if(!ref||time-ref.time<120)return {pace:0,seen:true};
    const speed=Math.max(change(feet,ref.feet)*.88,change(knees,ref.knees))/((time-ref.time)/1000);
    this.evidence=this.evidence*.43+Math.min(4,speed)*.57;
    this.walking = this.evidence > (this.walking ? .29 : .53);
    return {pace:this.walking?Math.min(32,7.5+this.evidence*8):0,seen:true};
  }
}
