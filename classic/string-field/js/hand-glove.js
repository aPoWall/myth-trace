// Wire Gloves technique adapted from MythTrace/performance-etching.js. Geometry
// follows only the 21 supplied measured points; no inferred hand is generated.
const TAU=Math.PI*2;
const FINGERS=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
const valid=points=>Array.isArray(points)&&points.length===21&&points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function sample(p,t){
 const section=Math.min(2,Math.floor(t*3)),u=t*3-section,a=p[Math.max(0,section-1)],b=p[section],c=p[section+1],d=p[Math.min(3,section+2)];
 const axis=k=>.5*(2*b[k]+(-a[k]+c[k])*u+(2*a[k]-5*b[k]+4*c[k]-d[k])*u*u+(-a[k]+3*b[k]-3*c[k]+d[k])*u*u*u);
 return {x:axis('x'),y:axis('y')};
}
export function createHandGlove(){
 function draw(ctx,hand,{width,height,color='#b9dbe9',time=0,active=false,pinchThreshold=.66,mode='glove',minimal=false}={}){
  if(minimal&&mode==='glove')mode='joints';
  const raw=mode==='raw'&&valid(hand?.rawLandmarks)?hand.rawLandmarks:hand?.landmarks;
  if(!ctx||!valid(raw)||!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)return null;
  const p=raw.map(q=>({x:q.x*width,y:q.y*height,z:Number.isFinite(q.z)?q.z:0}));
  const order=FINGERS.map((ids,i)=>({i,z:ids.reduce((sum,id)=>sum+p[id].z,0)/ids.length})).sort((a,b)=>b.z-a.z||a.i-b.i).map(v=>v.i);
  const span=Math.max(3,dist(p[5],p[17]),dist(p[0],p[9])*.35);const stale=Boolean(hand.stale);const quality=Number.isFinite(hand.quality)?Math.max(.2,Math.min(1,hand.quality)):1;
  const fade=Number.isFinite(hand.fade)?Math.max(0,Math.min(1,hand.fade)):stale&&Number.isFinite(hand.ageMs)?Math.max(.22,.55*(1-Math.max(0,hand.ageMs)/340)):(stale?.34:1);
  ctx.save();ctx.globalAlpha*=quality*fade;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.fillStyle=color;
  if(mode==='raw'){
   for(const point of p){ctx.beginPath();ctx.arc(point.x,point.y,Math.max(1.5,span*.018),0,TAU);ctx.fill();}
  } else {
   // Wrist-to-MCP connections are included in all 20 digit segments.
   ctx.lineWidth=Math.max(.65,span*.004);ctx.globalAlpha*=.55;
   ctx.beginPath();for(const ids of FINGERS){ctx.moveTo(p[0].x,p[0].y);ctx.lineTo(p[ids[0]].x,p[ids[0]].y);}ctx.stroke();
   if(mode==='joints'){
    for(const ids of FINGERS){ctx.beginPath();ctx.moveTo(p[ids[0]].x,p[ids[0]].y);for(const id of ids.slice(1))ctx.lineTo(p[id].x,p[id].y);ctx.stroke();}
   }else{
    // Palm veil joins only measured wrist/MCP anchors.
    ctx.beginPath();for(let i=0;i<15;i++){const t=i/14, pos=t*3, j=Math.min(2,Math.floor(pos)),v=pos-j,ids=[5,9,13,17], base=mix(p[ids[j]],p[ids[j+1]],v),start=mix(p[0],p[9],.04+t*.1),control=mix(start,base,.55);ctx.moveTo(start.x,start.y);ctx.quadraticCurveTo(control.x,control.y,base.x,base.y);}ctx.stroke();
    ctx.globalAlpha/=.55;
    for(const fi of order){
     const joints=FINGERS[fi].map(i=>p[i]),steps=18,sections=[];
     for(let i=0;i<=steps;i++){const t=i/steps,point=sample(joints,t),before=sample(joints,Math.max(0,t-.02)),after=sample(joints,Math.min(1,t+.02)),d=dist(before,after)||1;sections.push({x:point.x,y:point.y,nx:-(after.y-before.y)/d,ny:(after.x-before.x)/d,r:span*(fi===4?.070:.084)*(1-.49*t)*(.48+.52*Math.sin(Math.PI*(.19+.78*t)))});}
     const gradient=ctx.createLinearGradient(joints[0].x,joints[0].y,joints[3].x,joints[3].y);gradient.addColorStop(0,'rgba(49,92,122,.12)');gradient.addColorStop(.45,'rgba(99,160,184,.24)');gradient.addColorStop(.76,'rgba(169,207,222,.32)');gradient.addColorStop(1,'rgba(120,176,202,.13)');
     ctx.beginPath();sections.forEach((v,i)=>{const x=v.x+v.r*v.nx,y=v.y+v.r*v.ny;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});for(let i=steps;i>=0;i--){const v=sections[i];ctx.lineTo(v.x-v.r*v.nx,v.y-v.r*v.ny);}ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
     for(let band=0;band<3;band++){ctx.beginPath();for(let j=band;j<12;j+=3){const phase=TAU*j/12;sections.forEach((v,i)=>{const k=i/steps,offset=v.r*Math.sin(phase+k*2.2);const x=v.x+offset*v.nx,y=v.y+offset*v.ny;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});}ctx.lineWidth=Math.max(.55,span*(band===1?.005:.0025));ctx.strokeStyle=band===1?'rgba(181,218,230,.65)':'rgba(98,151,179,.48)';ctx.stroke();}
     // Each ring is centered on an actual landmark, including fingertips.
     for(const joint of joints){ctx.beginPath();ctx.arc(joint.x,joint.y,Math.max(1.5,span*.025),0,TAU);ctx.lineWidth=Math.max(.6,span*.003);ctx.strokeStyle='rgba(205,231,240,.7)';ctx.stroke();}
     const tip=joints[3],radius=Math.max(3,span*.09),glow=ctx.createRadialGradient(tip.x,tip.y,0,tip.x,tip.y,radius);glow.addColorStop(0,'rgba(210,240,251,.6)');glow.addColorStop(1,'rgba(40,70,95,0)');ctx.fillStyle=glow;ctx.fillRect(tip.x-radius,tip.y-radius,radius*2,radius*2);
    }
   }
   // Wrist and every measured joint remain identifiable in either geometry mode.
   if(mode==='joints')ctx.globalAlpha/=.55;
   ctx.fillStyle=color;for(const point of p){ctx.beginPath();ctx.arc(point.x,point.y,Math.max(1.1,span*.012),0,TAU);ctx.fill();}
  }
  if(stale){ctx.font='9px Menlo, monospace';ctx.fillStyle=color;ctx.fillText('HOLD',p[0].x+8,p[0].y+14);}
  const orient=hand.orientation || hand.palmOrientation;
  let label='';
  if(orient && typeof orient==='object'){
    const view=({'edge-on':'EDGE',oblique:'TURN','face-on':'FACE'})[orient.view];
    const facing=String(orient.facing||'').toUpperCase();
    const side=['PALM','BACK'].includes(facing)?facing:'';
    label=view ? [view,side].filter(Boolean).join(' / ') : side;
  }else if(typeof orient==='string' && ['PALM','BACK','EDGE'].includes(orient.toUpperCase())) label=orient.toUpperCase();
  if(label&&!minimal){ctx.font='9px Menlo, monospace';ctx.fillStyle=color;ctx.fillText(`EST. ${label}`,p[0].x+8,p[0].y+25);}
  ctx.restore();return {joints:21,segments:20,mode,stale,fingerOrder:order};
 }
 return {draw,dispose(){}};
}
