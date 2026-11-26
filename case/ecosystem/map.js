const get = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const photos = {
  context:'memory', case:'hands', verify:'wire-gloves', receipt:'memory', apply:'face', edition:'focus',
  input:'hands',tracking:'blue',score:'pigment',capture:'contour',audio:'voice',image:'objects',
  origin:'objects',grammar:'hands',release:'memory',today:'pigment',studies:'focus',wagner:'aftervoice',
  video:'etching',instrument:'face',method:'hands',take:'contour',worker:'objects',reference:'kosmodrom',
  crystal:'focus',mohr:'contour',sector:'kosmodrom',lattice:'focus',trails:'wire-gloves',
  stage:'pigment',router:'objects',sotnik:'focus',diffusion:'etching',whisper:'voice',providers:'aftervoice',
  map:'focus',start:'face',check:'wire-gloves',observe:'hands',publish:'contour'
};
const el = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
const svg = (tag, attrs) => {
  const element = document.createElementNS(svgNS, tag);
  for (const [k,v] of Object.entries(attrs)) element.setAttribute(k,v);
  return element;
};
const href = (v, n) => '#'+v.id+'/'+n.id;
let views, activeView, activeNode;
function actionLink(label,url) {
  const anchor = el('a',label);
  anchor.href = url;
  if (url.endsWith('.excalidraw')) anchor.download='';
  if (url.startsWith('http')) { anchor.target='_blank'; anchor.rel='noopener'; }
  return anchor;
}
function makeNav() {
  get('sections').replaceChildren(...views.map(v => {
    const link = actionLink('',href(v,v.nodes[v.start]));
    link.dataset.section=v.id;
    const img = el('img'); img.src='ecosystem/assets/'+v.picture+'.jpg'; img.alt='';
    link.append(img,el('span',v.name)); return link;
  }));
}
function showView(v) {
  activeView = v;
  const sectionNo=views.indexOf(v)+1;
  get('section-id').textContent='ECOSYSTEM  /  '+String(sectionNo).padStart(2,'0')+' OF '+String(views.length).padStart(2,'0');
  get('title').textContent=v.title; get('intro').textContent=v.intro;
  get('drawing').style.setProperty('--field','url("'+new URL("./assets/"+v.picture+".jpg",import.meta.url).href+'")');
  get('sections').querySelectorAll('a').forEach(link=>{
    if (link.dataset.section===v.id) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  get('nodes').replaceChildren(...v.nodes.map(n => {
    const button=el('button'); button.className='node'; button.type='button';
    button.setAttribute('aria-controls','inspector'); button.dataset.node=n.id;
    button.append(el('strong',n.title),el('small',n.caption));
    button.onclick=()=>{location.hash=href(v,n);};
    return button;
  }));
}
function showNode(v,n) {
  const search = get('work-filter');
  if (activeNode !== n) search.value = '';
  get('library-search').hidden = !n.works;
  const idx=v.nodes.indexOf(n); activeNode=n;
  get('nodes').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.node===n.id)));
  const img=({strings:'wire-gloves',pulse:'kosmodrom',image:'objects',context:'memory',studies:'pigment'})[n.id] || photos[n.id] || v.picture;
  get('photo').src='ecosystem/assets/'+img+'.jpg';
  get('still-label').textContent=img.toUpperCase()+' / STILL';
  get('node-class').textContent=(v.id === 'audio' ? 'Audio library' : 'Studio / '+v.name)+' / '+n.caption;
  get('node-title').textContent=n.title;
  get('description').textContent=n.detail;
  const localLinks=n.links.map(([label,link])=>actionLink(label+(link.endsWith('.excalidraw')?'':' ↗'),link));
  if(n.related) {
    const [page,id]=n.related.split('/');
    const dest=views.find(view=>view.id===page);
    localLinks.push(actionLink(dest.name+' → '+dest.nodes.find(item=>item.id===id).title,'#'+n.related));
  }
  get('actions').replaceChildren(...localLinks);
  const shelf = get('work-shelf');
  shelf.replaceChildren();
  shelf.hidden = !n.works?.length;
  if (n.works?.length) {
    const term = search.value.trim().toLocaleLowerCase();
    const works = term ? v.nodes.flatMap(group => group.works).filter(work => (
      work.title + ' ' + work.action + ' ' + work.status
    ).toLocaleLowerCase().includes(term)) : n.works;
    const heading = el('h2', term ? 'Search results' : n.title);
    const count = el('span', works.length + ' entries');
    const header = el('header');
    header.append(heading, count);
    shelf.append(header);
    for (const work of works) {
      const row = el('article');
      const status = el('small', work.status);
      const title = el('h3', work.title);
      row.append(status, title, el('p', work.action));
      if (work.url) row.append(actionLink('Play instrument ↗', work.url));
      if (work.clip) {
        const player = el('audio');
        player.controls = true;
        player.preload = 'none';
        player.src = work.clip;
        player.setAttribute('aria-label', work.title);
        row.append(player);
      }
      shelf.append(row);
    }
    if (!works.length) shelf.append(el('p', 'No matching works. Try a title, an instrument or a gesture.'));
    const jump = el('button', 'Explore ' + n.works.length + ' entries ↓');
    jump.onclick = () => { shelf.scrollIntoView({block:'start'}); heading.tabIndex = -1; heading.focus({preventScroll:true}); };
    get('actions').append(jump);
  }
  const edges=v.edges.filter(([a,b])=>a===idx || b===idx);
  get('connections').replaceChildren(el('span','LINKS'),...edges.map(([a,b,verb])=>{
    const dest = v.nodes[a===idx?b:a];
    const label=a===idx?verb+' → '+dest.title:dest.title+' → '+verb;
    const link=actionLink(label,href(v,dest));
    link.title=v.nodes[a].title+' → '+verb+' → '+v.nodes[b].title;
    link.setAttribute('aria-label',link.title);
    return link;
  }));
  drawEdges();
}
// Route around intervening nodes. Coordinates come from the rendered layout, including at phone widths.
function drawEdges() {
  if(!activeView || !activeNode) return;
  const v=activeView, layer=get('edges'), field=layer.getBoundingClientRect();
  const boxes=[...get('nodes').children].map(button=>{
    const r=button.getBoundingClientRect();
    return {x:r.x-field.x,y:r.y-field.y,w:r.width,h:r.height,cx:r.x-field.x+r.width/2,cy:r.y-field.y+r.height/2};
  });
  const defs=svg('defs',{});
  for (const [id,color] of [['normal','#92a9b5'],['hot','#dfaa80']]) {
    const end=svg('marker',{id,viewBox:'0 0 7 7',refX:6,refY:3.5,markerWidth:6,markerHeight:6,orient:'auto'});
    end.append(svg('path',{d:'M0 0 L6 3.5 L0 7',fill:'none',stroke:color,'stroke-width':'1.2'}));
    defs.append(end);
  }
  layer.replaceChildren(defs);
  const mid=(boxes[0].cy+boxes[3].cy)/2;
  for (const [a,b,verb] of v.edges) {
    const p=boxes[a],q=boxes[b];
    let path;
    if (Math.abs(p.cy-q.cy)<2 && Math.abs(a-b)===1) {
      const right=q.cx>p.cx;
      path='M '+(right?p.x+p.w:p.x)+' '+p.cy+' H '+(right?q.x-3:q.x+q.w+3);
    } else if (Math.abs(p.cy-q.cy)<2) {
      const lane=p.cy>mid?field.height-19:19, sign=p.cy>mid?1:-1;
      path='M '+p.cx+' '+(p.cy+sign*p.h/2)+' V '+lane+' H '+q.cx+' V '+(q.cy+sign*(q.h/2+3));
    } else {
      const sign=q.cy>p.cy?1:-1, sy=p.cy+sign*p.h/2, ey=q.cy-sign*(q.h/2+3);
      const lane=mid+((a+b)%3-1)*7;
      path='M '+p.cx+' '+sy+' V '+lane+' H '+q.cx+' V '+ey;
    }
    const hot=v.nodes[a]===activeNode || v.nodes[b]===activeNode;
    const wire=svg('path',{d:path,class:'wire'+(hot?' active':''),'marker-end':'url(#'+(hot?'hot':'normal')+')'});
    const title=svg('title',{}); title.textContent=v.nodes[a].title+' → '+verb+' → '+v.nodes[b].title;wire.append(title);
    layer.append(wire);
  }
}
function route() {
  const [key,id]=location.hash.slice(1).split('/');
  const v=views.find(part=>part.id===key) || views[0];
  const n=v.nodes.find(item=>item.id===id) || v.nodes[v.start];
  if(v!==activeView) showView(v);
  showNode(v,n);
  document.title=v.name+' · '+n.title+' | Myth Trace';
}
try {
  const response=await fetch('ecosystem/map.json');
  if(!response.ok) throw new Error('HTTP '+response.status);
  const data=await response.json();views=data.views;
  get('date').textContent='Edition / '+data.date;
  makeNav();route();
  get('library-search').onsubmit = event => event.preventDefault();
  get('work-filter').oninput = () => showNode(activeView,activeNode);
  window.addEventListener('hashchange',route);
  new ResizeObserver(drawEdges).observe(get('drawing'));
} catch(error) {
  get('load-status').textContent='Map data unavailable · '+error.message;
}
