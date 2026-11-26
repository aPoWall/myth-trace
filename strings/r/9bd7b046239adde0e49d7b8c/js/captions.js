import {CONFIG} from './config.js';
const MAX_FILE=250000,MAX_CUES=500,MAX_TEXT=240,MAX_EVENTS=128;
function clean(value){return String(value||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[e]).replace(/\s+/g,' ').trim().slice(0,MAX_TEXT);}
function timestamp(text){if(!/^\d{2,}:\d{2}(?::\d{2})?[.,]\d{3}$/.test(text))throw Error('Invalid caption time');const parts=text.replace(',','.').split(':').map(Number),seconds=parts.pop(),minutes=parts.pop(),hours=parts.pop()||0;if(seconds>=60||minutes>=60||hours>23)throw Error('Invalid caption time');return hours*3600+minutes*60+seconds;}
function validated(cues){if(!Array.isArray(cues)||cues.length>MAX_CUES)throw Error('Caption cue limit exceeded');return cues.map(c=>{if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>86400)throw Error('Invalid caption time range');return {start:c.start,end:c.end,text:clean(c.text)};}).filter(c=>c.text).sort((a,b)=>a.start-b.start||a.end-b.end);}
export function parseTimedText(text){if(typeof text!=='string'||text.length>MAX_FILE)throw Error('Caption file too large');const cues=[];for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)){const lines=block.trim().split('\n'),i=lines.findIndex(l=>l.includes('-->'));if(i<0||/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0]))continue;const timing=lines[i].trim().split(/\s+-->\s+/);if(timing.length!==2)throw Error('Invalid caption timing');const start=timestamp(timing[0]),end=timestamp(timing[1].split(/\s+/)[0]);cues.push({start,end,text:lines.slice(i+1).join(' ')});if(cues.length>MAX_CUES)throw Error('Caption cue limit exceeded');}return validated(cues);}
export function captionAt(cues,time){if(!Number.isFinite(time)||time<0)return '';return cues.filter(c=>time>=c.start&&time<c.end).slice(0,3).map(c=>clean(c.text)).filter(Boolean).join(' / ');}
function format(seconds){const ms=Math.round(seconds*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');}
export function createCaptionTrack({now=()=>performance.now()}={}){
 let enabled=false,mode='events',cues=[],events=[],playback=null,sampleId=null;
 return {
  setEnabled(value){enabled=!!value;},setMode(value){if(['events','sample'].includes(value))mode=value;},setCues(value,options={}){cues=validated(value);sampleId=typeof options.sampleId==='string'?options.sampleId.slice(0,128):null;playback=null;},
  emit(text,kind='instrument'){const value=clean(text);if(!value)return;events.push({time:now(),kind:String(kind).slice(0,24),text:value});events=events.slice(-MAX_EVENTS);},
  setSamplePlayback(data){const {id=null,start,end,rate,timeMs=now(),reverse=false}=data||{};playback=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&start>=0&&Number.isFinite(rate)&&rate>0&&Number.isFinite(timeMs)?{id,start,end,rate:Math.min(8,rate),reverse:!!reverse,timeMs}:null;},
  clear(){events=[];playback=null;},stopSample(){playback=null;},
  getText(){if(!enabled)return '';if(mode==='events'){const e=events.at(-1);return e&&now()-e.time>=0&&now()-e.time<2000?e.text:'';}if(!playback||(sampleId&&sampleId!==playback.id))return '';const elapsed=(now()-playback.timeMs)*.001;if(elapsed<0||elapsed>=CONFIG.samples.maxTriggerSeconds)return '';const position=playback.reverse?playback.end-elapsed*playback.rate:playback.start+elapsed*playback.rate;if(position<playback.start||position>=playback.end)return '';return captionAt(cues,position);},
  getEvents:()=>events.map(e=>({...e})),getState:()=>({enabled,mode,sampleId,cueCount:cues.length,eventCount:events.length,playing:!!playback}),
  serialize:()=>({enabled,mode,sampleId,cues:cues.map(c=>({...c}))}),
  restore(data){events=[];playback=null;enabled=!!data?.enabled;mode=['events','sample'].includes(data?.mode)?data.mode:'events';sampleId=typeof data?.sampleId==='string'?data.sampleId.slice(0,128):null;cues=validated(data?.cues||[]);},
  exportVtt(){return 'WEBVTT\n\n'+cues.map((c,i)=>`${i+1}\n${format(c.start)} --> ${format(c.end)}\n${c.text}\n`).join('\n');},
 };
}
