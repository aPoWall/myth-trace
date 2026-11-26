import {CONFIG,SCENES} from './config.js';
import {createHandGlove} from './hand-glove.js';
import {noteName} from './score.js';
import {sectorGLSL} from './sector-field.js';
import {createFieldGeometry} from './field-geometry.js';
const VERT=`#version 300 es
in vec2 p;out vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;
const FRAG=`#version 300 es
precision highp float;in vec2 uv;out vec4 color;
uniform vec2 resolution;uniform float time,mode,sourceOn,mirror,sourceAspect,portrait,light,voice,atmosphere;uniform vec2 pointer;uniform sampler2D image;
uniform vec4 uSector,uSectorCenters;uniform float whiteField;
#define uTime time
#define uResolution resolution
${sectorGLSL}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float n=0.,a=.5;for(int i=0;i<5;i++){n+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.03;a*=.5;}return n;}
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
 float paperInk=0.;vec2 q=vec2(uv.x,1.-uv.y);float aspect=resolution.x/resolution.y;
 vec2 p=(q-.5)*vec2(aspect,1.);p+=(pointer-.5)*.012;
 float t=time*.017;
 float nebula=fbm(p*3.2+vec2(t,-t*.5));
 float ribbon=p.y+.22*sin(p.x*2.5+t)+.12*p.x;
 float veil=exp(-abs(ribbon)*5.1)*pow(nebula,2.1);
 if(mode>.5&&mode<1.5){
  float fold=p.y+.18*sin(p.x*3.7+t*1.6)+.13*sin(p.x*1.8-t);
  veil=exp(-abs(fold)*8.)*pow(nebula,1.4)+.24*exp(-abs(fold+.19)*16.)*nebula;
 }
 if(mode>1.5&&mode<2.5){
  float facets=abs(sin(p.x*7.+p.y*4.)*sin(p.y*8.-p.x*2.5));
  veil=(.22+smoothstep(.90,.99,facets)*.8)*pow(nebula,1.7);
 }
 if(mode>2.5){
  vec2 gravity=p*vec2(.72,1.15);float radius=length(gravity),angle=atan(gravity.y,gravity.x);
  float orbit=pow(.5+.5*sin(radius*38.+angle*.7-t*2.6),20.);
  veil=(.11+orbit*.30)*exp(-radius*1.2)*(.5+nebula);
 }
 vec3 tint=mode>2.5?vec3(.25,.28,.56):(mode>1.5?vec3(.22,.51,.44):(mode>.5?vec3(.57,.32,.20):vec3(.25,.40,.53)));
 vec3 sky=vec3(.003,.008,.014)+tint*(veil*.68+pow(nebula,4.)*.22)*light;
 if(sourceOn<.5){
  float flow=p.y+.20*sin(p.x*2.4+t*2.)+.12*cos(p.x*4.1-t*1.3);
  float band=exp(-abs(flow)*5.5),filament=pow(.5+.5*sin(p.x*88.+p.y*62.+nebula*19.-time*.4),18.);
  sky+=tint*(band*(.20+nebula*.27)+filament*band*.10)*light;
 }
 float fibres=pow(.5+.5*sin(p.x*342.+fbm(p*6.)*34.+ribbon*108.),12.);
 sky+=tint*fibres*veil*.055*(1.+voice*3.);sky+=tint*veil*atmosphere*.24;
 if(sourceOn>.5){
  vec2 st=q;float target=aspect/sourceAspect;if(target>1.)st.y=(st.y-.5)/target+.5;else st.x=(st.x-.5)*target+.5;
  st.x=mix(st.x,1.-st.x,mirror);
  vec3 raw=texture(image,st).rgb;
  float gray=lum(raw);paperInk=gray*.45;vec2 px=vec2(1./(sourceAspect*720.),1./720.);
  float gx=lum(texture(image,st+vec2(px.x,0)).rgb)-lum(texture(image,st-vec2(px.x,0)).rgb);
  float gy=lum(texture(image,st+vec2(0,px.y)).rgb)-lum(texture(image,st-vec2(0,px.y)).rgb);
  float relief=clamp(length(vec2(gx,gy))*3.,0.,1.);
  float etch=pow(.5+.5*sin((st.x+st.y*.56)*1440.+gray*160.+atan(gy,gx)*2.+fbm(st*9.)*15.),7.);
  vec3 silver=mix(vec3(gray),raw,.34);silver=pow(max(silver,vec3(0)),vec3(.82))*vec3(.65,.81,.9);
  float vignette=1.-smoothstep(.35,.87,length((q-.5)*vec2(1.,.75)));
  float printGain=mix(.20,.72,portrait)*vignette;
  sky=mix(sky,silver,printGain);
  sky+=tint*(etch*.065+relief*.28)*(1.-portrait*.55)*vignette;
  sky+=tint*veil*.04;
 }
 float sectorInk=kosmodromSector(q,p,max(voice,atmosphere),nebula);
 if(uSector.x>.001){sky*=.32;sky+=vec3(.72,.82,.9)*min(1.,sectorInk)*.54;}
 float vignette=1.-smoothstep(.28,1.05,length(p*vec2(.7,1.)));
 sky*=.38+.62*vignette;
 float grain=hash(gl_FragCoord.xy+floor(time*24.))-.5;
 sky+=grain*(.021+voice*.013)*(.4+min(.6,lum(sky)*4.));
 if(whiteField>.5){float ink=clamp(lum(sky)*1.1+paperInk*.8,0.,.62);sky=mix(vec3(.957,.965,.97),vec3(.12,.20,.26),ink);}
 color=vec4(max(vec3(0),sky),1.);
}`;
function makeBackground(canvas){
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)return null;
 function shader(type,text){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VERT));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0]));
 const loc={};for(const name of ['resolution','time','mode','sourceOn','mirror','sourceAspect','portrait','light','voice','atmosphere','pointer','uSector','uSectorCenters','whiteField'])loc[name]=gl.getUniformLocation(program,name);
 return {draw(state,time){gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(loc.resolution,canvas.width,canvas.height);gl.uniform1f(loc.time,time);gl.uniform1f(loc.mode,SCENES.findIndex(s=>s.id===state.scene));gl.uniform1f(loc.sourceOn,state.source?1:0);gl.uniform1f(loc.mirror,state.mirror?1:0);gl.uniform1f(loc.sourceAspect,state.source?(state.source.videoWidth||state.source.naturalWidth)/(state.source.videoHeight||state.source.naturalHeight):1);gl.uniform1f(loc.portrait,state.portrait);gl.uniform1f(loc.light,state.light);gl.uniform1f(loc.voice,state.voice);gl.uniform1f(loc.atmosphere,state.atmosphere||0);gl.uniform1f(loc.whiteField,state.lightMode?1:0);gl.uniform4f(loc.uSector,state.geometry==='sector'?(state.geometryAmount??.65):0,state.atmosphere||0,Math.min(1,state.hands.length/2),state.reactiveLevel||0);gl.uniform4f(loc.uSectorCenters,state.pointer.x||.5,state.pointer.y||.5,state.hands[0]?.x||.5,state.hands[0]?.y||.5);gl.uniform2f(loc.pointer,state.pointer.x,state.pointer.y);if(state.source){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,state.source);}gl.drawArrays(gl.TRIANGLES,0,6);}};
}
export function createVisual({field,canvas,score,onFallback=()=>{}}){
 let bg;try{bg=makeBackground(field)}catch(error){onFallback(error.message)}if(!bg)onFallback('WebGL2 unavailable · notes and strings remain playable in Canvas');
 const handGlove=createHandGlove(),fieldGeometry=createFieldGeometry();const ctx=canvas.getContext('2d'),stars=new Float32Array(CONFIG.starCount*4);let seed=83;
 const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};for(let i=0;i<stars.length;i++)stars[i]=random();
 const state={scene:'atlas',source:null,mirror:false,portrait:CONFIG.visual.portraitMix,light:CONFIG.visual.skyGain,voice:0,atmosphere:0,pointer:{x:.5,y:.5,visible:false},hands:[],playingId:null,paused:false,showSky:false};
 let w=1,h=1,dpr=1;
 function resize(){w=canvas.clientWidth;h=canvas.clientHeight;dpr=Math.min(devicePixelRatio||1,CONFIG.pixelRatio);for(const c of [field,canvas]){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);}
 const haloCache=new Map();function halo(color){if(haloCache.has(color))return haloCache.get(color);const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d');const g=x.createRadialGradient(48,48,0,48,48,48);g.addColorStop(0,color+'cc');g.addColorStop(.07,color+'66');g.addColorStop(.24,color+'22');g.addColorStop(1,color+'00');x.fillStyle=g;x.fillRect(0,0,96,96);haloCache.set(color,c);return c;}
 function line(x1,y1,x2,y2,alpha,color,width=.65){ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
 function star(x,y,r,a,color){ctx.globalAlpha=a;ctx.drawImage(halo(color),x-r*10,y-r*10,r*20,r*20);ctx.fillStyle=state.lightMode?'#173c51':'#e5f3ff';ctx.fillRect(x-r*.5,y-r*.5,Math.max(.7,r),Math.max(.7,r));}
 function draw(t,dt){
  const time=t*.001,color=state.lightMode?'#284d61':SCENES.find(s=>s.id===state.scene).color;bg?.draw(state,time);
  ctx.clearRect(0,0,w,h);ctx.globalAlpha=1;
  if(!bg){ctx.fillStyle='#03080f';ctx.fillRect(0,0,w,h);if(state.source){ctx.globalAlpha=.25;ctx.drawImage(state.source,0,0,w,h);ctx.globalAlpha=1;}}
  // Authored deterministic sky, distinct from the performer's saved notes.
  for(let i=0;i<(state.showSky?CONFIG.starCount:0);i++){const j=i*4,depth=.3+stars[j+2]*.7;const x=(stars[j]*w+(state.pointer.x-.5)*12*depth),y=stars[j+1]*h;const opacity=(.18+stars[j+3]*.5)*state.light*(.8+.2*Math.sin(time*(.12+stars[j+2]) +i));let radius=.45+Math.pow(stars[j+2],5)*1.7;if(i%17===0){star(x,y,radius,opacity,color);if(state.scene==='atlas'&&i%51===0){line(x-radius*4,y,x+radius*4,y,opacity*.20,color,.45);line(x,y-radius*4,x,y+radius*4,opacity*.20,color,.45);}}else{ctx.globalAlpha=opacity;ctx.fillStyle=i%4===0?'#c3d0e5':'#7f9bab';ctx.fillRect(x,y,radius,radius);}}
  // Sparse survey ticks keep the large field legible.
  ctx.fillStyle='#617e92';ctx.font='8px Menlo,monospace';for(let i=1;i<9;i++){const x=w*i/9;line(x,h*.23,x,h*.23+6,.22,color);line(x,h*.79,x,h*.79+6,.22,color);ctx.globalAlpha=.35;ctx.fillText(String(i).padStart(2,'0'),x+4,h*.23+4);}
  const nodes=score.nodes,edges=score.edges;
  fieldGeometry.draw(ctx,{width:w,height:h,time,mode:state.geometry,amount:state.geometryAmount,lightMode:state.lightMode,drive:state.reactiveLevel||0,pointer:state.pointer});
  const wires=state.stringField?.strings||[];
  for(const edge of edges){const color=state.lightMode?'#284d61':SCENES.find(s=>s.id===(score.patches?.[score.edges&&[...edge].sort((a,b)=>String(a).localeCompare(String(b))).join(':')]?.scene||state.scene)).color;const a=nodes.find(n=>n.id===edge[0]),b=nodes.find(n=>n.id===edge[1]);if(!a||!b)continue;const ax=a.x*w,ay=a.y*h,bx=b.x*w,by=b.y*h,e=Math.max(a.energy,b.energy);const wire=wires.find(s=>(s.aId===a.id&&s.bId===b.id)||(s.aId===b.id&&s.bId===a.id));const focused=wire&&state.stringFocus===wire.id,stretched=wire&&state.stretched?.has(wire.id);line(ax,ay,bx,by,.39+e*.3+((focused||stretched) ? .22 : 0),color,.65);
   if(wire){
    const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,energy=wire.energy;
    const amplitude=Math.sqrt(energy)*CONFIG.strings.maxDisplacement*h;
    if(energy>.001||stretched||focused){
     const baseAlpha=energy*.72+(focused ? .28 : 0)+(stretched ? .2 : 0);
     // Standing modes share the pluck position and damping envelope with the sound.
     for(let strand=-1;strand<=1;strand++){
      ctx.beginPath();for(let i=0;i<=72;i++){
       const u=i/72,envelope=Math.sin(Math.PI*u);
       const wave=amplitude*(Math.sin(wire.phase)*envelope+.30*Math.sin(wire.phase*2)*Math.sin(Math.PI*u*2)*Math.sin(wire.hitU*Math.PI*2)+.13*Math.sin(wire.phase*3)*Math.sin(Math.PI*u*3));
       const prism=(Math.abs(((u*4+wire.phase/(2*Math.PI))%1)*2-1)*2-1)*envelope;
       const response=state.scene==='crystal'?amplitude*prism*.7:state.scene==='orbit'?wave*.48:wave;
       const offset=response+strand*envelope*(1+energy*2.5);
       const x=ax+dx*u+nx*offset,y=ay+dy*u+ny*offset;
       if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.globalAlpha=Math.min(.94,baseAlpha*(strand===0?1:.28));ctx.strokeStyle=strand===0?'#dcecf7':color;ctx.lineWidth=strand===0?1.15:.55;ctx.stroke();
     }
     const u=wire.hitU,x=ax+dx*u,y=ay+dy*u;
     if(energy>.03){
      star(x,y,1.25+energy*1.4,energy,color);
      const radius=4+(1-energy)*24;ctx.globalAlpha=energy*.48;ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(x,y-radius);ctx.lineTo(x+radius*.45,y);ctx.lineTo(x,y+radius);ctx.lineTo(x-radius*.45,y);ctx.closePath();ctx.stroke();
     }
     if(focused||stretched||energy>.25){
      const mx=(ax+bx)*.5,my=(ay+by)*.5;ctx.globalAlpha=.64;ctx.fillStyle=color;ctx.font='8px Menlo,monospace';ctx.fillText(noteName(wire.midi)+' / '+wire.frequency.toFixed(1)+' Hz / L '+wire.length.toFixed(2),mx+nx*17+8,my+ny*17-5);
      for(const [x,y] of [[ax,ay],[bx,by]]){ctx.globalAlpha=.6;ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.strokeRect(x-5,y-5,10,10);}
     }
    }
    if(state.scene==='loom'){
     for(let j=-2;j<=2;j++){
      if(j===0)continue;const bow=j*30*(.3+wire.tension);
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.quadraticCurveTo((ax+bx)/2+nx*bow,(ay+by)/2+ny*bow,bx,by);ctx.globalAlpha=.18+energy*.18;ctx.strokeStyle=color;ctx.lineWidth=.5;ctx.stroke();
     }
    }
   }
   if(e>.15){const f=(time*.35+a.id*.17)%1;star(ax+(bx-ax)*f,ay+(by-ay)*f,.7,e*.6,color);}
  }
  if(state.scene==='crystal'&&nodes.length>1){
   const cx=nodes.reduce((s,n)=>s+n.x,0)/nodes.length*w,cy=nodes.reduce((s,n)=>s+n.y,0)/nodes.length*h;
   const r=Math.min(w,h)*.20,rotation=time*.085,c=Math.cos(rotation),s=Math.sin(rotation);
   const vertices=[[0,-1.3,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1],[0,1.3,0]].map(([x,y,z])=>{
    const rx=x*c-z*s,rz=x*s+z*c,depth=1/(1+rz*.24);return [cx+rx*r*depth,cy+(y+rz*.23)*r*depth,depth];
   });
   const facets=[[0,1,2],[0,2,3],[0,3,4],[0,4,1],[5,1,2],[5,2,3],[5,3,4],[5,4,1]];
   const force=nodes.reduce((a,n)=>Math.max(a,n.energy),0);
   for(const [i,j,k] of facets){const a=vertices[i],b=vertices[j],d=vertices[k];ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(d[0],d[1]);ctx.closePath();ctx.globalAlpha=.015+force*.035;ctx.fillStyle=color;ctx.fill();ctx.globalAlpha=.18+force*.18;ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.stroke();}
   for(const n of nodes){const v=vertices[n.id%vertices.length];line(n.x*w,n.y*h,v[0],v[1],.18,color,.6);}
  }
  if(state.scene==='orbit'){
   const cx=w*.5,cy=h*.46,large=Math.min(w,h)*.34;
   for(let ring=0;ring<3;ring++){ctx.globalAlpha=.10+ring*.025;ctx.strokeStyle=color;ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(cx,cy,large*(1+ring*.33),large*(.35+ring*.08),-.3+ring*.19,0,Math.PI*2);ctx.stroke();}
   for(const n of nodes){
    const r=Math.max(12,38+(n.midi-CONFIG.rootMidi)*3.8),energy=n.energy;
    ctx.globalAlpha=.17+energy*.2;ctx.strokeStyle=color;ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(n.x*w,n.y*h,r,r*.37,-.4,0,Math.PI*2);ctx.stroke();
    const a=time*.12+n.id;star(n.x*w+Math.cos(a)*r,n.y*h+Math.sin(a)*r*.37,.8,.72,color);
    if(energy>.02){ctx.globalAlpha=energy*.27;ctx.beginPath();ctx.ellipse(n.x*w,n.y*h,r+(1-energy)*90,(r+(1-energy)*90)*.37,-.4,0,Math.PI*2);ctx.stroke();}
   }
  }
  // Every wire names its own sounding pitch; endpoint height is not a second note.
  for(const wire of wires){const x=(wire.a.x+wire.b.x)*w*.5,y=(wire.a.y+wire.b.y)*h*.5;ctx.globalAlpha=.70;ctx.font='9px Menlo,monospace';ctx.fillStyle=color;ctx.fillText(noteName(wire.midi),x+9,y-9);}
  for(const group of score.groups||[]){ctx.globalAlpha=.65;ctx.font='10px Menlo,monospace';ctx.fillStyle=color;ctx.fillText(group.name,group.x*w,group.y*h+18);}
  for(const n of nodes){
   n.energy=Math.max(0,n.energy-dt*.55);const x=n.x*w,y=n.y*h,e=n.energy;
   star(x,y,.9+e*1.2,.68,color);ctx.globalAlpha=.66;ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.strokeRect(x-3,y-3,6,6);
   ctx.fillStyle=color;ctx.font='7px Menlo,monospace';ctx.globalAlpha=.47;ctx.fillText(String(n.id).padStart(2,'0'),x+8,y+4);if(!edges.some(e=>e.includes(n.id))){ctx.globalAlpha=.9;ctx.font='12px Menlo,monospace';ctx.fillText(noteName(n.midi),x+12,y-12);ctx.strokeStyle=color;ctx.beginPath();ctx.arc(x,y,7+n.energy*9,0,Math.PI*2);ctx.stroke();}
   if(state.heldNodeIds?.has(n.id)){ctx.globalAlpha=.85;ctx.strokeRect(x-7,y-7,14,14);ctx.fillText('PULL / OPEN TO LOCK',x+10,y+16);}
   else if(n.fixedAt&&t-n.fixedAt<2400){ctx.globalAlpha=Math.max(0,1-(t-n.fixedAt)/2400);ctx.fillText('LOCKED',x+10,y+14);}
  }
  const active=state.editor?.active;
  if(active?.kind==='build'){
   const a=nodes.find(n=>n.id===active.aId);if(a){const ax=a.x*w,ay=a.y*h,bx=active.x*w,by=active.y*h;line(ax,ay,bx,by,.85,color,1);ctx.strokeStyle=color;ctx.globalAlpha=.9;ctx.strokeRect(ax-7,ay-7,14,14);ctx.font='9px Menlo,monospace';ctx.fillStyle=color;ctx.fillText('A / FIXED',ax+12,ay-12);ctx.fillText('B / PULL → OPEN OR S',bx+12,by-12);}
  }
  for(const hand of state.hands){const lm=hand.landmarks;if(!lm)continue;ctx.globalAlpha=1;
   handGlove.draw(ctx,hand,{width:w,height:h,color,time:t,active:active?.id===hand.id,pinchThreshold:state.pinchThreshold||.66,mode:state.handMode||'glove',minimal:state.editor?.mode==='play'||state.lightMode});if(hand.stale)continue;
   const own=active?.id===hand.id;const tip=lm[8],thumb=lm[4];if(state.editor?.mode==='play'){ctx.globalAlpha=1;ctx.fillStyle=color;ctx.beginPath();ctx.arc(tip.x*w,tip.y*h,4,0,Math.PI*2);ctx.fill();continue;}line(tip.x*w,tip.y*h,thumb.x*w,thumb.y*h,.9,own?'#e7f1f6':color,2);ctx.beginPath();ctx.arc(hand.x*w,hand.y*h,24,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,hand.pinch/(state.pinchThreshold||.66)));ctx.globalAlpha=.85;ctx.strokeStyle=hand.pinch>=(state.pinchThreshold||.66)?'#e6f7f9':color;ctx.lineWidth=2;ctx.stroke();ctx.font='8px Menlo,monospace';ctx.fillStyle=color;ctx.fillText('PINCH '+Math.round(hand.pinch*100)+'%',hand.x*w+28,hand.y*h-8);ctx.globalAlpha=.85;ctx.strokeStyle=own?'#edf5fa':color;ctx.beginPath();ctx.arc(hand.x*w,hand.y*h,9+hand.pinch*10,0,Math.PI*2);ctx.stroke();ctx.fillStyle=color;ctx.font='9px Menlo,monospace';ctx.fillText((hand.side||'HAND').toUpperCase()+' / '+(own?'PULL → OPEN OR S':'PLAY'),lm[0].x*w+12,lm[0].y*h+15);
  }
  if(state.pointer.visible&&!state.hands.length){const x=state.pointer.x*w,y=state.pointer.y*h;ctx.globalAlpha=.55;ctx.strokeStyle=color;ctx.lineWidth=.6;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();line(x-14,y,x-10,y,.45,color);line(x+10,y,x+14,y,.45,color);line(x,y-14,x,y-10,.45,color);line(x,y+10,x,y+14,.45,color);}
  ctx.globalAlpha=1;
 }
 function mapPoint(p){const source=state.source;if(!source)return {...p};const a=w/h,sa=(source.videoWidth||source.naturalWidth)/(source.videoHeight||source.naturalHeight),ratio=a/sa;return {...p,x:ratio>1?p.x:(p.x-.5)/ratio+.5,y:ratio>1?(p.y-.5)*ratio+.5:p.y};}
 window.addEventListener('resize',resize);resize();return {state,draw,resize,mapPoint,dispose(){window.removeEventListener('resize',resize);}};
}
