import { CONFIG } from './config.js';
const cfg = CONFIG.strings;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const cross = (a,b) => a.x*b.y-a.y*b.x;
const xy = (p,aspect) => ({x:p.x*aspect,y:p.y});

export function projectPointToSegment(point,a,b,aspect=1) {
  const p=xy(point,aspect), v=xy(a,aspect), w=xy(b,aspect), dx=w.x-v.x, dy=w.y-v.y;
  const den=dx*dx+dy*dy, u=den ? clamp(((p.x-v.x)*dx+(p.y-v.y)*dy)/den,0,1) : 0;
  return {u,distance:Math.hypot(p.x-v.x-u*dx,p.y-v.y-u*dy)};
}
// Closest point on string to the movement segment, including a true crossing.
function swept(p,q,a,b,aspect) {
  const P=xy(p,aspect), Q=xy(q,aspect), A=xy(a,aspect), B=xy(b,aspect);
  const r={x:Q.x-P.x,y:Q.y-P.y}, s={x:B.x-A.x,y:B.y-A.y};
  const d=cross(r,s), ap={x:A.x-P.x,y:A.y-P.y};
  if (Math.abs(d)>1e-12) {
    const t=cross(ap,s)/d, u=cross(ap,r)/d;
    if(t>=0 && t<=1 && u>=0 && u<=1) return {u,distance:0};
  }
  const candidates=[projectPointToSegment(p,a,b,aspect),projectPointToSegment(q,a,b,aspect)];
  for (const [node,u] of [[a,0],[b,1]]) candidates.push({u,distance:projectPointToSegment(node,p,q,aspect).distance});
  return candidates.reduce((best,c)=>c.distance<best.distance?c:best);
}
export function createStringField({score,onPluck=()=>{}}) {
  const byId=new Map(), pointers=new Map(); let list=[];
  const idFor=(a,b)=>[a,b].sort((x,y)=>String(x).localeCompare(String(y))).join(':');
  function sync(aspect=1) {
    aspect=Number.isFinite(aspect)&&aspect>0?aspect:1;
    const nodes=new Map(score.nodes.map(n=>[n.id,n])), keep=new Set(), next=[];
    for (const edge of score.edges) {
      const [aId,bId]=edge, a=nodes.get(aId),b=nodes.get(bId);
      if(!finitePoint(a)||!finitePoint(b)||aId===bId) continue;
      const length=Math.hypot((b.x-a.x)*aspect,b.y-a.y);
      if(!Number.isFinite(length)||length<=1e-9) continue;
      const id=idFor(aId,bId); if(keep.has(id)) continue; keep.add(id);
      let s=byId.get(id);
      if(!s){s={id,aId,bId,a,b,length,midi:0,frequency:0,tension:0,energy:0,phase:0,hitU:.5,displacement:0,active:false};byId.set(id,s);}
      Object.assign(s,{aId,bId,a,b,length});
      s.midi=Number.isFinite(score.tuning?.[id])?score.tuning[id]:clamp(cfg.referenceMidi+12*Math.log2(cfg.referenceLength/length),cfg.minMidi,cfg.maxMidi);
      s.frequency=440*2**((s.midi-69)/12);
      s.tension=clamp((length-cfg.minLength)/(cfg.maxLength-cfg.minLength),0,1);
      next.push(s);
    }
    for(const id of byId.keys()) if(!keep.has(id)) byId.delete(id);
    for(const p of pointers.values()) for(const id of p.contacts.keys()) if(!keep.has(id)) p.contacts.delete(id);
    list=next; return list;
  }
  function strike(id,{u=.5,velocity=.6,sign=1}={}) {
    const s=byId.get(id); if(!s) return null;
    u=clamp(Number.isFinite(u)?u:.5,0,1); velocity=clamp(Number.isFinite(velocity)?velocity:.6,0,1);
    s.energy=clamp(s.energy+velocity,0,cfg.maxEnergy); s.phase=sign<0?Math.PI:0; s.hitU=u; s.active=s.energy>0;
    const event={id:s.id,midi:s.midi,frequency:s.frequency,velocity,x:s.a.x+(s.b.x-s.a.x)*u,y:s.a.y+(s.b.y-s.a.y)*u,u,tension:s.tension,length:s.length};
    onPluck(event); return event;
  }
  function hitTest(x,y,aspect=1) {
    if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
    let best=null;
    for(const string of list){const p=projectPointToSegment({x,y},string.a,string.b,aspect); if(p.u<=cfg.endpointMargin||p.u>=1-cfg.endpointMargin||p.distance>cfg.touchRadius)continue;if(!best||p.distance<best.distance)best={string,...p};}
    return best;
  }
  function update(points,timestamp,aspect=1) {
    sync(aspect); const seen=new Set();
    for(const point of points){
      if(!point.active||!finitePoint(point)||point.id==null)continue;
      seen.add(point.id); let p=pointers.get(point.id);
      if(!p){pointers.set(point.id,{point:{x:point.x,y:point.y},time:timestamp,contacts:new Map()});continue;}
      const travel=Math.hypot((point.x-p.point.x)*aspect,point.y-p.point.y), dt=Math.max(1,timestamp-p.time);
      for(const s of list){
        const current=projectPointToSegment(point,s.a,s.b,aspect), ignored=point.ignoreNodes?.includes(s.aId)||point.ignoreNodes?.includes(s.bId);
        let c=p.contacts.get(s.id) || {touching:false,last:-Infinity};
        if(c.touching && (current.distance>cfg.releaseRadius||current.u<=cfg.endpointMargin||current.u>=1-cfg.endpointMargin||ignored))c.touching=false;
        const hit=travel >= (cfg.contactMotionMin ?? .0015) && travel<=cfg.maxSweep&&!ignored ? swept(p.point,point,s.a,s.b,aspect):null;
        if(!c.touching&&hit&&hit.distance<=cfg.touchRadius&&hit.u>cfg.endpointMargin&&hit.u<1-cfg.endpointMargin){
          c.touching=current.distance<=cfg.releaseRadius && current.u>cfg.endpointMargin && current.u<1-cfg.endpointMargin;
          if(timestamp-c.last>=cfg.cooldownMs){
            const speed=travel*1000/dt, velocity=clamp((speed-cfg.minVelocity)/(cfg.maxVelocity-cfg.minVelocity),0,1);
            const direction=cross({x:(s.b.x-s.a.x)*aspect,y:s.b.y-s.a.y},{x:(point.x-p.point.x)*aspect,y:point.y-p.point.y});
            strike(s.id,{u:hit.u,velocity:Math.max(.1,velocity),sign:Math.sign(direction)}); c.last=timestamp;
          }
        }
        p.contacts.set(s.id,c);
      }
      p.point={x:point.x,y:point.y}; p.time=timestamp;
    }
    for(const id of pointers.keys())if(!seen.has(id))pointers.delete(id);
    return list;
  }
  function step(dt) {
    dt=clamp(Number.isFinite(dt)?dt:0,0,60);
    for(const s of list){s.energy*=Math.exp(-cfg.damping*dt);if(s.energy<1e-6)s.energy=0;s.phase=(s.phase+2*Math.PI*cfg.visualHz*dt)%(2*Math.PI);s.displacement=Math.sin(s.phase)*s.energy*cfg.maxDisplacement;s.active=s.energy>0;}
  }
  function silence(){for(const s of list){s.energy=0;s.displacement=0;s.active=false;} pointers.clear();}
  function reset(){silence();byId.clear();list=[];}
  return {sync,update,strike,hitTest,step,silence,reset,get strings(){return list;}};
}
