import {CONFIG} from './config.js';
export const edgeKey=(a,b)=>[a,b].sort((x,y)=>String(x).localeCompare(String(y))).join(':');
export function noteForY(y){const n=CONFIG.scale.length*CONFIG.octaves,d=Math.min(n-1,Math.floor((1-Math.max(0,Math.min(1,y)))*n));return CONFIG.rootMidi+CONFIG.scale[d%CONFIG.scale.length]+12*Math.floor(d/CONFIG.scale.length);}
export function noteName(midi){midi=Math.round(midi);return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);}
const scenes=['atlas','loom','crystal','orbit'],voicings=['single','fifth','minor','major','sus2'];
function cleanPatch(p={}){const out={};if(scenes.includes(p.scene))out.scene=p.scene;if(voicings.includes(p.voicing))out.voicing=p.voicing;if(['minor-pentatonic','major-pentatonic','major','natural-minor','whole-tone','chromatic'].includes(p.scale))out.scale=p.scale;if(Number.isInteger(p.instrument)&&p.instrument>0&&p.instrument<=64)out.instrument=p.instrument;if(Number.isInteger(p.rootMidi)&&p.rootMidi>=24&&p.rootMidi<=108)out.rootMidi=p.rootMidi;return out;}
export function createScore(){
 let nodes=[],edges=[],tuning={},patches={},groups=[],nextId=1;
 function prune(){const keys=new Set(edges.map(([a,b])=>edgeKey(a,b)));for(const map of[tuning,patches])for(const k of Object.keys(map))if(!keys.has(k))delete map[k];}
 const api={get nodes(){return nodes},get edges(){return edges},get tuning(){return tuning},get patches(){return patches},get groups(){return groups},
 add(x,y,{connect=true,midi=noteForY(y),...patch}={}){if(nodes.length>=CONFIG.maxNodes||!Number.isFinite(x)||!Number.isFinite(y))return null;const node={id:nextId++,x:Math.max(.02,Math.min(.98,x)),y:Math.max(.02,Math.min(.98,y)),midi:Math.round(midi),...cleanPatch(patch),born:performance.now(),energy:0};if(connect&&nodes.length&&edges.length<CONFIG.maxEdges)edges.push([nodes.at(-1).id,node.id]);nodes.push(node);return node;},
 connect(a,b){if(a===b||!nodes.some(n=>n.id===a)||!nodes.some(n=>n.id===b)||edges.length>=CONFIG.maxEdges||edges.some(e=>e.includes(a)&&e.includes(b)))return false;edges.push([a,b]);return true;},
 setTuning(a,b,midi){if(!Number.isFinite(midi)||midi<24||midi>108||!edges.some(e=>e.includes(a)&&e.includes(b)))return false;tuning[edgeKey(a,b)]=midi;return true;},
 setPatch(a,b,patch){if(!edges.some(e=>e.includes(a)&&e.includes(b)))return false;patches[edgeKey(a,b)]=cleanPatch(patch);return true;},
 clearTuning(a,b){delete tuning[edgeKey(a,b)];},
 move(id,x,y){const n=nodes.find(n=>n.id===id);if(n&&Number.isFinite(x)&&Number.isFinite(y)){n.x=Math.max(.02,Math.min(.98,x));n.y=Math.max(.02,Math.min(.98,y));n.midi=noteForY(y);}return n;},
 nearest(x,y,r=CONFIG.hitRadius){let best=null,d=r;for(const n of nodes){const v=Math.hypot(n.x-x,n.y-y);if(v<d){d=v;best=n;}}return best;},
 remove(id){const before=nodes.length;nodes=nodes.filter(n=>n.id!==id);edges=edges.filter(e=>!e.includes(id));prune();return nodes.length<before;},
 removeEdge(id){const e=edges.find(([a,b])=>edgeKey(a,b)===id);if(!e)return false;edges=edges.filter(edge=>edge!==e);for(const node of e)if(!edges.some(edge=>edge.includes(node)))nodes=nodes.filter(n=>n.id!==node);prune();return true;},
 undo(){const n=nodes.at(-1);if(n)api.remove(n.id);},clear(){nodes=[];edges=[];tuning={};patches={};groups=[];nextId=1;},
 serialize(){return {version:2,nodes:nodes.map(({id,x,y,midi,...rest})=>({id,x,y,midi,...cleanPatch(rest)})),edges:edges.map(e=>[...e]),tuning:{...tuning},patches:Object.fromEntries(Object.entries(patches).map(([k,p])=>[k,{...p}])),groups:groups.map(g=>({...g}))};},
 load(data){
  if(![1,2].includes(data?.version)||!Array.isArray(data.nodes)||!Array.isArray(data.edges)||data.nodes.length>CONFIG.maxNodes||data.edges.length>CONFIG.maxEdges)throw Error('Invalid instrument file');
  const ids=new Set();const ns=data.nodes.map(n=>{if(!Number.isInteger(n.id)||n.id<1||ids.has(n.id)||![n.x,n.y,n.midi].every(Number.isFinite)||n.x<0||n.x>1||n.y<0||n.y>1||!Number.isInteger(n.midi)||n.midi<24||n.midi>108)throw Error('Invalid anchor or note');ids.add(n.id);return {id:n.id,x:n.x,y:n.y,midi:n.midi,...cleanPatch(n),born:0,energy:0};});
  const es=data.edges.map(e=>{if(!Array.isArray(e)||e.length!==2||e[0]===e[1]||!e.every(id=>ids.has(id)))throw Error('Invalid string');return [...e];});const keys=new Set(es.map(([a,b])=>edgeKey(a,b))),ts={},ps={};
  if(data.tuning!==undefined){if(!data.tuning||typeof data.tuning!=='object'||Array.isArray(data.tuning))throw Error('Invalid tuning');for(const[k,midi]of Object.entries(data.tuning)){if(!keys.has(k)||!Number.isFinite(midi)||midi<24||midi>108)throw Error('Invalid string pitch');ts[k]=midi;}}
  if(data.patches!==undefined){if(!data.patches||typeof data.patches!=='object'||Array.isArray(data.patches))throw Error('Invalid materials');for(const[k,p]of Object.entries(data.patches)){if(!keys.has(k)||!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid string material');ps[k]=cleanPatch(p);}}
  const gs=Array.isArray(data.groups)?data.groups.slice(0,12).filter(g=>g&&typeof g.name==='string'&&Number.isFinite(g.x)&&Number.isFinite(g.y)&&g.x>=0&&g.x<=1&&g.y>=0&&g.y<=1).map(({name,x,y})=>({name:name.slice(0,40),x,y})):[];
  nodes=ns;edges=es;tuning=ts;patches=ps;groups=gs;nextId=Math.max(0,...ids)+1;return api;
 }
 };return api;
}
