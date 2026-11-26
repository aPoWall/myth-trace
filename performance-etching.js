import { CONFIG, clamp, lerp } from './config.js';

const score = CONFIG.shaperDemo;
const TAU = Math.PI * 2;
const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// One authored pose in wrist-space. Live hands use the same engraver with their 21 measured points.
const openHand = [[0,0], [.18,-.18],[.32,-.28],[.43,-.34],[.51,-.39],
  [.15,-.48],[.22,-.69],[.27,-.84],[.31,-.96],
  [.015,-.55],[.035,-.79],[.06,-.96],[.09,-1.07],
  [-.11,-.51],[-.15,-.71],[-.165,-.85],[-.17,-.96],
  [-.22,-.42],[-.295,-.58],[-.32,-.69],[-.33,-.77]];
const mixPoint = (a,b,t) => ({x:lerp(a.x,b.x,t), y:lerp(a.y,b.y,t)});
const length = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const valid = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);

export function rehearsalCurls(timeMs) {
  const phase = timeMs / score.gloveBeatMs;
  const step = Math.floor(phase) % score.gloveSteps.length;
  const active = score.gloveSteps[step];
  const envelope = Math.min(1, (phase % 1) * 7) * clamp((.94 - phase % 1) * 4);
  return ['left','right'].map((side,h) => Object.fromEntries(fingers.map((finger,f) =>
    [finger, h * 5 + f === active ? envelope : 0])));
}

function scoreHand(side, width, height, time, pointer, curls) {
  const right = side === 1;
  const flip = right ? -1 : 1;
  const unit = Math.min(width * .36, height * .48);
  const tilt = flip * (.32 + .09 * Math.sin(time * .57 + side));
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  const x = width * (right ? .72 : .28) + ((pointer?.x ?? .5) - .5) * unit * .24;
  const y = height * (right ? .65 : .69) + unit * (.045 * Math.cos(time * .67 + side * 2) + ((pointer?.y ?? .5) - .5) * .19);
  return openHand.map(([px,py],i) => {
    if (i) {
      const finger = Math.floor((i - 1) / 4), joint = ((i - 1) % 4) / 3;
      py += curls[fingers[finger]] * joint * joint * .37;
      px += (.03 + .045 * Math.sin(time * .81 + finger + side)) * joint + .10 * curls[fingers[finger]] * joint;
    }
    px *= flip;
    return { x: x + unit * (px * ca - py * sa), y: y + unit * (px * sa + py * ca) };
  });
}

// Smooth joint interpolation is shared by the reflected strands, the suspended
// grains and the moving glint. All three follow the same measured finger.
function sampleFinger(points, t) {
  const section = Math.min(2, Math.floor(t * 3)), u = t * 3 - section;
  const a = points[Math.max(0,section-1)], b = points[section], c = points[section+1], d = points[Math.min(3,section+2)];
  const axis = key => .5 * (2*b[key] + (-a[key]+c[key])*u
    + (2*a[key]-5*b[key]+4*c[key]-d[key])*u*u + (-a[key]+3*b[key]-3*c[key]+d[key])*u*u*u);
  return {x:axis('x'), y:axis('y')};
}

function drawGlove(ctx, p, curls, detail, seconds, material) {
  const span = length(p[5],p[17]);
  if (span < 3) return;
  const dust = material !== 'silk', silk = material !== 'dust';
  const low = detail < score.engraving.strands;
  const steps = low ? 16 : 24;
  const wrist = p[0], axis = mixPoint(p[9],p[13],.5);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // A veil through the palm leaves the camera visible between the fingers.
  ctx.strokeStyle = dust ? 'rgba(144,192,209,.17)' : 'rgba(144,192,209,.32)';
  ctx.lineWidth = Math.max(.6,span*.003);
  ctx.beginPath();
  const threads = low ? 14 : 26;
  for (let i=0;i<threads;i++) {
    const k=i/(threads-1), f=Math.min(3,Math.floor(k*3.999));
    const a=mixPoint(wrist,axis,.03+.09*Math.sin(i*2.7));
    const base=mixPoint(p[17-4*f],p[17-4*Math.min(3,f+1)],k*3.999-f);
    const dx=(k-.5)*(p[5].x-p[17].x), dy=(k-.5)*(p[5].y-p[17].y);
    ctx.moveTo(a.x+dx*.33,a.y+dy*.33);
    ctx.quadraticCurveTo(axis.x+dx*.80,axis.y+dy*.80,base.x,base.y);
  }
  ctx.stroke();
  for (let f=0;f<5;f++) {
    const joints = p.slice(1+4*f,5+4*f), curl = curls?.[fingers[f]] || 0;
    const curve = Array.from({length:steps+1},(_,i)=>sampleFinger(joints,i/steps));
    const sections = curve.map((point,i)=>{
      const before=curve[Math.max(0,i-1)],after=curve[Math.min(steps,i+1)];
      const l=length(before,after)||1, t=i/steps;
      const r=span*(f===4?.070:.084)*(1-.49*t)*(.48+.52*Math.sin(Math.PI*(.19+.78*t)));
      return {x:point.x,y:point.y,nx:-(after.y-before.y)/l,ny:(after.x-before.x)/l,r};
    });
    if (silk) {
      const end=curve[steps], start=curve[0];
      const veil=ctx.createLinearGradient(start.x,start.y,end.x,end.y);
      veil.addColorStop(0,'rgba(49,92,122,.12)');
      veil.addColorStop(.44,'rgba(99,160,184,.24)');
      veil.addColorStop(.76,curl>.4?'rgba(234,167,119,.44)':'rgba(169,207,222,.32)');
      veil.addColorStop(1,'rgba(120,176,202,.13)');
      ctx.beginPath();
      for (let i=0;i<sections.length;i++) {
        const v=sections[i],x=v.x+v.r*v.nx,y=v.y+v.r*v.ny;
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      for (let i=steps;i>=0;i--) {
        const v=sections[i];ctx.lineTo(v.x-v.r*v.nx,v.y-v.r*v.ny);
      }
      ctx.closePath();ctx.fillStyle=veil;ctx.fill();
      // Strands rotate through the tube. A moving reflection crosses only a few at a time.
      for (let band=0;band<3;band++) {
        ctx.beginPath();
        const count=low ? 8 : 13;
        for (let j=band;j<count;j+=3) {
          const phase=TAU*j/count;
          sections.forEach((v,i)=>{
            const k=i/steps;
            const offset=v.r*Math.sin(phase+k*2.2+.22*Math.sin(seconds*.71+k*5+f));
            const x=v.x+offset*v.nx,y=v.y+offset*v.ny;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          });
        }
        ctx.lineWidth=Math.max(.65,span*(band===1?.006:.003));
        ctx.strokeStyle=band===1?'rgba(181,218,230,.65)':band===2?'rgba(221,173,140,.40)':'rgba(98,151,179,.53)';
        ctx.stroke();
      }
    }
    if (dust) {
      ctx.fillStyle = 'rgba(174,209,221,.68)';
      const grains=low ? 56 : 112;
      for(let i=0;i<grains;i++) {
        const k=(i*.618034+seconds*.035+f*.23)%1,v=sections[Math.floor(k*steps)];
        const phi=i*2.39996+seconds*.32+f;
        const radius=v.r*(.28+1.12*(i%13)/13);
        const size=Math.max(.75,span*(.003+(i%7)*.001));
        ctx.fillRect(v.x+v.nx*radius*Math.cos(phi),v.y+v.ny*radius*Math.cos(phi),size,size);
      }
    }
    const tip=p[4+f*4],radius=Math.max(2,span*(.025+curl*.045));
    const glow=ctx.createRadialGradient(tip.x,tip.y,0,tip.x,tip.y,radius*3);
    glow.addColorStop(0,curl>.4?'rgba(255,215,166,.92)':'rgba(210,240,251,.84)');
    glow.addColorStop(.24,curl>.4?'rgba(226,153,95,.41)':'rgba(131,194,225,.35)');
    glow.addColorStop(1,'rgba(40,70,95,0)');
    ctx.fillStyle=glow;ctx.fillRect(tip.x-radius*3,tip.y-radius*3,radius*6,radius*6);
    if (!dust) continue;
    // A soft downward spill responds continuously to each calibrated bend.
    ctx.fillStyle=curl>.4?'rgba(243,192,145,.66)':'rgba(158,195,216,.44)';
    const count=Math.floor((low?13:24)*(1+curl));
    for(let i=0;i<count;i++) {
      const t=(i*.618034+seconds*(.28+.18*curl)+f*.21)%1;
      const x=tip.x+Math.sin(i*2.41+t*3+seconds*.5)*span*(.015+.14*t);
      const y=tip.y+span*t*t*(.38+1.12*curl);
      const size=Math.max(.6,(1-t)*span*.016);
      ctx.fillRect(x,y,size,size);
    }
  }
  ctx.restore();
}

function drawGloves(ctx, width, height, seconds, hands, controls, detail) {
  const live=hands.filter(h=>h.landmarks?.length===21 && h.landmarks.every(valid));
  const curls = rehearsalCurls((controls.demoMix?.elapsed ?? seconds*1000));
  const scored = !live.length;
  const suits = scored ? [0,1].map(side => ({p:scoreHand(side,width,height,seconds,controls.pointer,curls[side]),c:curls[side]}))
    : live.map(h => ({p:h.landmarks.map(v=>({x:v.x*width,y:v.y*height})),
      c:controls.fingerRanges?.[h.handedness.toLowerCase()]?.curls}));
  if (suits.length === 2) {
    for (let i=0;i<5;i++) {
      const a=suits[0].p[4+i*4], b=suits[1].p[4+i*4];
      const energy=Math.max(suits[0].c?.[fingers[i]] || 0,suits[1].c?.[fingers[i]] || 0);
      const sag=Math.min(height*.16,length(a,b)*.24) * (.2+i*.14) * (1-.7*energy);
      ctx.beginPath(); ctx.moveTo(a.x,a.y);
      ctx.bezierCurveTo(lerp(a.x,b.x,.34),a.y+sag,lerp(a.x,b.x,.67),b.y+sag,b.x,b.y);
      ctx.strokeStyle=energy>.45?'rgba(234,177,128,.60)':'rgba(145,181,198,.15)'; ctx.lineWidth=energy>.45?1.4:.75; ctx.stroke();
    }
  }
  for (const suit of suits) drawGlove(ctx,suit.p,suit.c,detail,seconds,controls.gloveMaterial || 'composite');
  return {source:scored?'score hands':'fingers',segments:suits.length*19};
}

function drawAftervoice(ctx,width,height,t,face,controls,drive,low) {
  const mouth=face?.features?.mouth;
  const centre=mouth || {x:.5+((controls.pointer?.x??.5)-.5)*.28,y:.48+((controls.pointer?.y??.5)-.5)*.16};
  const left=face?.features?.['eye.l'],right=face?.features?.['eye.r'];
  const span=left && right ? Math.hypot((left.x-right.x)*width,(left.y-right.y)*height) : 0;
  const size=span ? Math.min(width*.47,Math.max(span*1.35,width*.09)) : Math.min(width*.40,height*.61);
  const rings=low?score.engraving.detailRings:score.engraving.lipRings;
  const samples=low?score.engraving.detailPoints:score.engraving.lipPoints;
  const opening=.25+drive*.54;
  ctx.translate(centre.x*width,centre.y*height);
  const angle = span ? Math.atan2((right.y-left.y)*height,(right.x-left.x)*width) : -.14;
  ctx.rotate(Math.atan2(Math.sin(2*angle),Math.cos(2*angle))/2);
  for (let r=0;r<rings;r++) {
    const k=r/(rings-1), radius=.13+.87*k;
    ctx.beginPath();
    for(let i=0;i<=samples;i++) {
      const a=TAU*i/samples, s=Math.sin(a), c=Math.cos(a);
      const fold=Math.sin(3*a+5*k-t*.51)*(.074+.052*drive)+.038*Math.sin(7*a-3*k+t*.27);
      const x=size*radius*(c*(1+fold)+.09*s*s);
      const y=size*radius*(s*(opening+.29*k+.14*Math.cos(2*a+k*4))+.20*c*c+fold);
      if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    }
    const highlight=.28+.64*Math.pow(.5+.5*Math.cos(k*11-t*.33),2);
    ctx.strokeStyle=r%13===1?`rgba(218,162,122,${highlight})`:`rgba(151,192,209,${highlight})`;
    ctx.lineWidth=r%13===1?1.25:.84;ctx.stroke();
  }
  return {source:mouth?'mouth':'score field',segments:rings*samples};
}

export function paintPerformanceEtching({ctx,width,height,time,controls,hands,face,id,strength}) {
  const mix=controls.demoMix;
  const seconds=(mix?.elapsed ?? time)*.001*(controls.reducedMotion ? .22 : 1);
  const low=controls.quality?.dprScale<.8 || width<550;
  ctx.save();
  ctx.globalAlpha*=clamp(strength);
  const state=id==='wire-gloves'
    ? drawGloves(ctx,width,height,seconds,hands,controls,low?17:score.engraving.strands)
    : drawAftervoice(ctx,width,height,seconds,face,controls,clamp(Math.max(face?.blendshapes?.jawOpen || 0,
      mix?.voiceEnergy || 0,controls.roomMusicFrame?.rawRms*4 || 0,.10+.09*Math.sin(seconds*.79))),low);
  ctx.restore();
  return state;
}
