import {BEAT_PRESETS,createRhythm} from './rhythm.js';
import {SAMPLE_LIBRARY} from './sample-library.js';
import {saveLocalSample,readLocalSample} from './sample-store.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createPerformance({audio,arm,notify,onPulse=()=>{}}){
 const $=id=>document.getElementById(id);
 let sample={id:SAMPLE_LIBRARY[0]?.id||'',name:'',slice:0,rate:1,reverse:false,mode:'off',volume:.5},generation=0,loading=null,disposed=false;
 const rhythm=createRhythm({audio,onPulse:p=>{if(disposed)return;document.querySelectorAll('#beat-grid span').forEach((el,i)=>el.classList.toggle('current',i===p.step));$('beat-status').textContent=`BAR ${p.bar+1} / STEP ${String(p.step+1).padStart(2,'0')}`;if(sample.mode==='beat'&&p.step%4===0)trigger((p.bar*4+p.step/4)%8);onPulse(p);}});
 for(const item of BEAT_PRESETS){const o=new Option(item.name,item.id);$('beat-preset').add(o);}
 for(const item of SAMPLE_LIBRARY)$('sample-select').add(new Option(item.name,item.id));
 for(let i=0;i<16;i++){const el=document.createElement('span');el.textContent=String(i+1).padStart(2,'0');$('beat-grid').append(el);}
 for(let i=0;i<8;i++){const b=document.createElement('button');b.type='button';b.textContent=String(i+1).padStart(2,'0');b.setAttribute('aria-label','Play slice '+(i+1));b.onclick=()=>void playSlice(i);$('sample-pads').append(b);}
 function source(){return SAMPLE_LIBRARY.find(s=>s.id===sample.id);}
 function render(){
  const r=rhythm.getState();$('beat-preset').value=r.preset;$('beat-bpm').value=r.bpm;$('beat-density').value=r.density;$('beat-swing').value=r.swing;$('beat-volume').value=r.volume;
  $('beat-start').disabled=r.preset==='off';$('beat-start').textContent=r.playing?'STOP RHYTHM':'START RHYTHM';$('beat-start').setAttribute('aria-pressed',String(r.playing));
  $('beat-bpm-value').textContent=r.bpm+' BPM';$('beat-density-value').textContent=Math.round(r.density*100)+'%';$('beat-swing-value').textContent=Math.round(r.swing*100)+'%';
  if(!r.playing){$('beat-status').textContent='RHYTHM STOPPED · strings remain free';document.querySelectorAll('#beat-grid span').forEach(el=>el.classList.remove('current'));}
  $('sample-select').value=sample.id;$('sample-mode').value=sample.mode;$('sample-rate').value=sample.rate;$('sample-reverse').checked=sample.reverse;$('sample-volume').value=sample.volume;$('sample-rate-value').textContent=sample.rate.toFixed(2)+'×';
  [...$('sample-pads').children].forEach((b,i)=>b.setAttribute('aria-pressed',String(sample.slice===i)));
  const info=audio.getSampleInfo(sample.id),s=source();
  $('sample-status').textContent=info?`${info.name} · ${info.duration.toFixed(2)} s · 8 slices`:sample.name?sample.name+' · press LOAD':(s?.name||'Choose a sample')+' · press LOAD';
  $('sample-credit').textContent=s?`${s.credit} · ${s.license}`:'Your local file · retained in this browser';$('sample-source').hidden=!s;$('sample-source').href=s?.sourceUrl||'#';
  paint(info);
 }
 function paint(info){const c=$('sample-wave'),ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#a4c3d3';ctx.lineWidth=1;const peaks=info?.peaks||[];ctx.fillStyle='#b7cbd71a';ctx.fillRect(sample.slice*w/8,0,w/8,h);ctx.beginPath();for(let i=0;i<peaks.length;i++){const x=i*w/peaks.length,a=Math.max(1,Number(peaks[i])*(h*.42));ctx.moveTo(x,h/2-a);ctx.lineTo(x,h/2+a);}ctx.stroke();ctx.strokeStyle='#b7cbd735';ctx.beginPath();for(let i=0;i<=8;i++){ctx.moveTo(i*w/8,0);ctx.lineTo(i*w/8,h);}ctx.stroke();if(!peaks.length){ctx.fillStyle='#8299a8';ctx.font='10px Menlo,monospace';ctx.fillText('LOAD AUDIO / EIGHT SLICES',12,h/2+4);}}
 async function ensureLoaded(){
  if(audio.getSampleInfo(sample.id))return true;
  if(loading)return loading;
  const id=sample.id,ticket=generation;
  loading=(async()=>{try{
   if(!await arm())return false;
   const s=SAMPLE_LIBRARY.find(s=>s.id===id),local=s?null:await readLocalSample(id);
   if(!s&&!local)throw Error('Local audio missing · choose the original file again');
   const info=await audio.loadSample(s?{id,url:s.url,name:s.name}:{id,blob:local.blob,name:local.name});
   if(ticket!==generation||disposed)return false;
   sample.name=info.name;render();return true;
  }catch(e){notify('Sample could not load · '+e.message);return false;}finally{loading=null;}})();return loading;
 }
 function trigger(slice=sample.slice){if(disposed||!audio.getSampleInfo(sample.id))return false;sample.slice=clamp(Math.floor(slice),0,7);const ok=audio.triggerSample({id:sample.id,start:sample.slice/8,end:(sample.slice+1)/8,rate:sample.rate,reverse:sample.reverse,velocity:.65});render();return ok;}
 async function playSlice(i){const ticket=generation;if(await ensureLoaded()&&ticket===generation&&!disposed)trigger(i);}
 $('beat-preset').onchange=e=>{rhythm.setPreset(e.target.value);render();};
 for(const [id,set] of [['beat-bpm','setBpm'],['beat-density','setDensity'],['beat-swing','setSwing'],['beat-volume','setVolume']])$(id).oninput=e=>{rhythm[set](Number(e.target.value));render();};
 $('beat-start').onclick=async()=>{if(rhythm.getState().playing)rhythm.stop();else{const ticket=generation;if(await arm()&&ticket===generation&&!disposed)await rhythm.start();}render();};
 $('sample-select').onchange=e=>{generation++;audio.sampleStop();sample.id=e.target.value;sample.name='';sample.mode='off';render();};
 $('sample-load').onclick=()=>void ensureLoaded();$('sample-play').onclick=()=>void playSlice(sample.slice);$('sample-stop').onclick=()=>{generation++;audio.sampleStop();sample.mode='off';render();notify('Sample stopped · automatic chop disabled');};
 $('sample-mode').onchange=async e=>{const value=e.target.value,ticket=generation;sample.mode='off';if(value==='off'||await ensureLoaded()){if(ticket===generation)sample.mode=value;}render();};
 $('sample-rate').oninput=e=>{sample.rate=Number(e.target.value);render();};$('sample-volume').oninput=e=>{sample.volume=Number(e.target.value);audio.setSampleVolume(sample.volume);render();};$('sample-reverse').onchange=e=>{sample.reverse=e.target.checked;render();};
 $('sample-import').onclick=()=>$('audio-file').click();$('audio-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;generation++;audio.sampleStop();sample.mode='off';try{const local=await saveLocalSample(file);sample.id=local.id;sample.name=local.name;addLocalOption(local);render();await ensureLoaded();notify('Local audio saved in this browser · exported sessions keep its reference');}catch(err){notify('Could not import audio · '+err.message);}finally{e.target.value='';}};
 function addLocalOption(item){if(![...$('sample-select').options].some(o=>o.value===item.id))$('sample-select').add(new Option(item.name+' / LOCAL',item.id));}
 function stop(){generation++;rhythm.stop();audio.sampleStop();render();}
 function restore(data={}){stop();if(data.rhythm)rhythm.restore(data.rhythm);const s=data.sample;if(s&&typeof s==='object'){if(SAMPLE_LIBRARY.some(v=>v.id===s.id)||/^local-[a-f0-9]{24}$/.test(s.id)){sample.id=s.id;sample.name=String(s.name||'Local sample').slice(0,120);if(s.id.startsWith('local-'))addLocalOption(sample);}if(Number.isFinite(s.slice))sample.slice=clamp(Math.floor(s.slice),0,7);if(Number.isFinite(s.rate))sample.rate=clamp(s.rate,.5,2);if(Number.isFinite(s.volume))sample.volume=clamp(s.volume,0,1);sample.reverse=!!s.reverse;sample.mode='off';}audio.setSampleVolume(sample.volume);render();}
 render();audio.setSampleVolume(sample.volume);
 return {stop,restore,onStrike(event){if(sample.mode==='string')trigger(clamp(Math.floor(event.u*8),0,7));},serialize(){const {playing,step,bar,...r}=rhythm.getState();return {rhythm:r,sample:{...sample,mode:'off'}};},getState:()=>({rhythm:rhythm.getState(),sample:{...sample},loading:!!loading}),get busy(){const m=audio.getMetrics();return rhythm.getState().playing||m.sampleVoices>0||!!loading;},dispose(){stop();disposed=true;rhythm.dispose();},render};
}
