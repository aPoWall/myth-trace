const status=document.getElementById('boot-status');
function failed(message){document.documentElement.classList.remove('ready');status.replaceChildren();const text=document.createElement('p');text.textContent='This build could not start: '+message;const link=document.createElement('a');link.href='/?instrument=strings';link.textContent='Open the current complete build';link.style.color='#c4e6f7';status.append(text,link);}
try{
 await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(link=>link.sheet?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('stylesheet unavailable or timed out')),4000);link.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});link.addEventListener('error',()=>{clearTimeout(timer);reject(Error('stylesheet unavailable'));},{once:true});})));
 if(getComputedStyle(document.querySelector('.workshop')).display!=='flex')throw Error('incomplete stylesheet');
 await import('./main.js');
 document.documentElement.classList.add('ready');
}catch(error){failed(error.message);}
window.addEventListener('error',event=>{if(event.error)failed(event.error.message);});
