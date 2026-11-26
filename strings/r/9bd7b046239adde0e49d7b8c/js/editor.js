import {CONFIG} from './config.js';
import {edgeKey} from './score.js';
export function createEditor({score,onChange=()=>{},onCommit=()=>{},onCancel=()=>{},quantize=midi=>midi,aspect=()=>1}={}){
 let mode='play',active=null,history=[];
 const snapshot=()=>score.serialize();
 function changed(){onChange(getState());}
 function retune(a,b,reference){const length=Math.hypot((b.x-a.x)*aspect(),b.y-a.y);if(length<1e-6)return;const midi=Math.max(CONFIG.strings.minMidi,Math.min(CONFIG.strings.maxMidi,(reference?.midi??CONFIG.strings.referenceMidi)+12*Math.log2((reference?.length??CONFIG.strings.referenceLength)/length)));const tuned=quantize(midi);if(tuned===null)score.clearTuning(a.id,b.id);else score.setTuning(a.id,b.id,tuned);}
 function checkpoint(data=snapshot()){history.push(data);if(history.length>24)history.shift();}
 function cancel(reason='cancel'){if(!active)return;score.load(active.before);active=null;onCancel(reason);changed();}
 function setMode(next){if(!['play','build','tune','note','delete'].includes(next))return;cancel();mode=next;changed();}
 function begin(id,x,y){
  if(active||['play','note','delete'].includes(mode))return false;const before=snapshot();
  if(mode==='build'){const a=score.add(x,y,{connect:false});if(!a)return false;active={id,kind:'build',a,b:null,x,y,before};}
  else{const node=score.nearest(x,y);if(!node)return false;const bases={};for(const[a,b]of score.edges){if(a!==node.id&&b!==node.id)continue;const A=score.nodes.find(n=>n.id===a),B=score.nodes.find(n=>n.id===b),length=Math.hypot((B.x-A.x)*aspect(),B.y-A.y),key=edgeKey(a,b);bases[key]={length,midi:score.tuning[key]??CONFIG.strings.referenceMidi+12*Math.log2(CONFIG.strings.referenceLength/length)};}active={id,kind:'tune',node,bases,before,x,y};}
  changed();return true;
 }
 function move(id,x,y){if(!active||active.id!==id)return false;active.x=x;active.y=y;
  if(active.kind==='build'){
   if(!active.b&&Math.hypot((x-active.a.x)*aspect(),y-active.a.y)>=CONFIG.strings.minLength){active.b=score.add(x,y,{connect:false});if(active.b)score.connect(active.a.id,active.b.id);}
   if(active.b){score.move(active.b.id,x,y);retune(active.a,active.b);}
  }else{score.move(active.node.id,x,y);for(const[a,b]of score.edges)if(a===active.node.id||b===active.node.id)retune(score.nodes.find(n=>n.id===a),score.nodes.find(n=>n.id===b),active.bases[edgeKey(a,b)]);}
  changed();return true;
 }
 function end(id,{reason='release'}={}){if(!active||active.id!==id)return false;if(reason!=='release'){cancel(reason);return false;}
  const draft=active;if(draft.kind==='build'&&!draft.b){cancel('short');return false;}
  checkpoint(draft.before);const now=performance.now();if(draft.kind==='build'){draft.a.fixedAt=now;draft.b.fixedAt=now;}else draft.node.fixedAt=now;
  const nodeId=draft.node?.id;const edgeIds=draft.kind==='build'?[edgeKey(draft.a.id,draft.b.id)]:score.edges.filter(e=>e.includes(draft.node.id)).map(([a,b])=>edgeKey(a,b));
  active=null;onCommit({kind:draft.kind,edgeIds,nodeId});changed();return true;
 }
 function commit(){return active ? end(active.id,{reason:'release'}) : false;}
 function undo(){cancel();const data=history.pop();if(data)score.load(data);changed();return !!data;}
 function getState(){return {mode,active:active?{id:active.id,kind:active.kind,aId:active.a?.id,bId:active.b?.id,nodeId:active.node?.id,x:active.x,y:active.y}:null,history:history.length};}
 return {setMode,begin,move,end,commit,cancel,checkpoint,undo,getState};
}
