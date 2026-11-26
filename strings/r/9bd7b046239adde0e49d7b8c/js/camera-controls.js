export function createCameraControls({root,tracker,onStart=()=>{},onStop=()=>{},onSelect=()=>{}}) {
  let choice='auto-mac', devices=[], disposed=false, error='';
  root.innerHTML=`<div class="camera-controls-row"><label>CAMERA <select data-camera-select aria-label="Camera source"></select></label><button type="button" data-camera-mac>BUILT-IN</button><button type="button" data-camera-iphone>IPHONE</button><button type="button" data-camera-refresh>REFRESH</button><button type="button" data-camera-start>START</button><button type="button" data-camera-stop>STOP</button></div><div data-camera-info role="status" aria-live="polite"></div>`;
  const $=s=>root.querySelector(s), select=$('[data-camera-select]');
  function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
  function render(){
    if(disposed)return;
    const state=tracker.getState(), inventory=devices.length?devices:(state.devices||[]);
    select.replaceChildren(option('auto-mac','Built-in / auto'),option('iphone','iPhone'));
    inventory.forEach((d,i)=>{if(d.deviceId)select.append(option(d.deviceId,d.label||`Camera ${i+1} · name after permission`));});
    if(![...select.options].some(o=>o.value===choice))choice='auto-mac';
    select.value=choice;
    const known=inventory.some(d=>d.label), phone=inventory.some(d=>d.phone && !/camo|\bobs\b/i.test(d.label));
    $('[data-camera-iphone]').disabled=known&&!phone;
    $('[data-camera-start]').disabled=!!state.active||state.state==='starting';
    $('[data-camera-stop]').disabled=!state.active&&state.state!=='starting';
    $('[data-camera-mac]').setAttribute('aria-pressed',String(choice==='auto-mac'));
    $('[data-camera-iphone]').setAttribute('aria-pressed',String(choice==='iphone'));
    const details=[];
    if(state.active){details.push(state.cameraLabel||'Camera');if(state.width&&state.height)details.push(`${state.width} × ${state.height}`);if(state.delegate)details.push(state.delegate);}
    else details.push(({idle:'Camera off',starting:'Starting camera',searching:'Camera on · show your hands',tracking:'Hands detected',unavailable:'Camera unavailable · check access or select a device'}[state.state] || 'Camera off'));
    if(!known)details.push('Device names appear after camera permission');
    else if(!phone)details.push('iPhone not found');
    if(error)details.push(error);
    $('[data-camera-info]').textContent=details.join(' · ');
  }
  async function refresh(){try{devices=await tracker.getDevices();error='';}catch{error='Could not refresh camera list';}render();return devices;}
  function change(){choice=select.value;onSelect(choice);render();}
  function click(event){const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;
    if(button.hasAttribute('data-camera-refresh'))void refresh();
    else if(button.hasAttribute('data-camera-stop'))onStop();
    else if(button.hasAttribute('data-camera-start'))onStart(choice);
    else if(button.hasAttribute('data-camera-mac')||button.hasAttribute('data-camera-iphone')){choice=button.hasAttribute('data-camera-mac')?'auto-mac':'iphone';render();onStart(choice);}
  }
  const deviceChange=()=>{void refresh();};
  root.addEventListener('click',click);select.addEventListener('change',change);navigator.mediaDevices?.addEventListener?.('devicechange',deviceChange);render();
  return {refresh,render,getChoice:()=>choice,dispose(){if(disposed)return;disposed=true;root.removeEventListener('click',click);select.removeEventListener('change',change);navigator.mediaDevices?.removeEventListener?.('devicechange',deviceChange);root.replaceChildren();}};
}
