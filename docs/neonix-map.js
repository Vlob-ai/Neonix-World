import './vendor/jsvectormap/jsvectormap.min.js';
import {bringToLife} from './map-life.js';

const NS='http://www.w3.org/2000/svg';
let activeCleanup=null, mountSequence=0;
export function unmountCityMap(){mountSequence++;activeCleanup?.();activeCleanup=null;}
const polygon=points=>'M'+points.map(p=>p.join(',')).join('L')+'Z';
function inside([x,y],poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)hit=!hit;}return hit;}
function svg(tag,attrs={},parent){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));parent?.append(el);return el;}
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function distanceToSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
const range=value=>`${value.low.toLocaleString()}–${value.high.toLocaleString()}`;
const categories={food:'Food & drink',service:'Services & repair',shop:'Shops & supplies',transport:'Transport'};

export async function mountCityMap(container,{escape,byId,thumbnail}){
  unmountCityMap();const sequence=mountSequence;
  container.innerHTML='<p class="loading">Opening the city survey…</p>';
  let layout,support;
  try{[layout,support]=await Promise.all(['data/neonix-map.json','data/neonix-map-support.json'].map(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Map data unavailable');return response.json();}));}
  catch{if(sequence===mountSequence)container.innerHTML='<div class="empty"><h1>The map could not load.</h1><p>Refresh to reconnect to the city archive.</p></div>';return;}
  if(sequence!==mountSequence)return;
  const districts=new Map(layout.districts.map(d=>[d.id,d]));
  const places=new Map(layout.places.map((p,index)=>[p.id,{...p,index,name:byId.get(p.id)?.name||p.id}]));
  const hubs=new Map(support.hubs.map(h=>[h.id,h]));
  const businesses=new Map();
  // Separate support sites from large venue footprints; keep every point within
  // its assigned borough. Coordinates remain display units, not travel distances.
  for(const hub of support.hubs){const place=places.get(hub.id);if(!place)continue;for(const site of hub.sites){
    const dx=site.dx===0?8:site.dx,dy=site.dy===0?8:site.dy;
    const scale=Math.max(1.15,Math.min((place.footprint[0]/2+15)/Math.abs(dx),(place.footprint[1]/2+13)/Math.abs(dy)));
    let point=[place.point[0]+dx*scale,place.point[1]+dy*scale];
    for(let step=0;!inside(point,districts.get(place.district).points)&&step<20;step++)point=point.map((n,i)=>(n+place.point[i])/2);
    businesses.set(site.id,{...site,point,hubId:hub.id,district:place.district,depth:place.depth});
  }}
  let map,life=null,selected=null,selectedBusiness=null,districtFilter=null,search='',dragStart=null,dragged=false;
  const colors={food:'#ddbd70',service:'#70c9dd',shop:'#be9ad7',transport:'#99beab'};
  container.innerHTML=`<section class="city-atlas">
    <header class="atlas-heading"><div><span class="eyebrow">NEONIX / CARTOGRAPHY</span><h1>The shape of the city.</h1><p>Five boroughs. Eighteen landmarks. The neighborhoods that grow around them.</p></div><span class="atlas-version">LAYOUT STUDY / 01</span></header>
    <div class="atlas-shell"><div class="atlas-main"><div class="atlas-toolbar"><span class="atlas-map-title">Neonix / City survey</span><span class="atlas-draft">PROPOSED GEOGRAPHY</span></div>
    <div class="atlas-stage" data-buildings="on" data-routes="on" data-places="on" data-support="on">
      <div id="neonix-map" class="atlas-canvas" aria-label="Interactive Neonix map. Select a borough or numbered place. The city index provides the same choices." tabindex="0"></div>
      <div class="atlas-readout">OBLIQUE SURVEY<br><span>BOUNDARIES UNDER DEVELOPMENT</span></div>
      <div class="atlas-controls" role="group" aria-label="Map view"><button id="atlas-zoom-in" aria-label="Zoom in">+</button><output class="atlas-zoom-value" aria-label="Map zoom">1×</output><button id="atlas-zoom-out" aria-label="Zoom out">−</button><button data-map-reset aria-label="Show the whole city" title="Show the whole city">⌂</button></div>
      <div class="atlas-key"><span><i class="key-place"></i>Landmark</span><span><i></i>City blocks</span><span><i class="key-road"></i>Proposed routes</span><span><i class="key-business"></i>Local business</span></div>
    </div><div class="atlas-layers" role="group" aria-label="Map layers">${[['buildings','Buildings'],['routes','Routes'],['places','Landmarks'],['support','Local businesses']].map(([id,label])=>`<label><input type="checkbox" data-map-layer="${id}" checked>${label}</label>`).join('')}<small>Drag to move · Scroll to zoom</small></div></div>
    <aside class="atlas-panel" aria-label="City index"><div class="atlas-panel-head"><h2>City index</h2><span>18 LANDMARKS</span></div><label class="atlas-search">⌕<input id="map-search" type="search" placeholder="Find a place or business…" aria-label="Find a place or business"></label>
    <div class="atlas-districts" role="group" aria-label="Filter by borough">${layout.districts.map(d=>`<button data-district="${d.id}" aria-pressed="false"><i style="--district-color:${d.color}"></i>${escape(byId.get(d.id).name)}<span>${layout.places.filter(p=>p.district===d.id).length}</span></button>`).join('')}</div>
    <div class="atlas-selection"></div><h3 class="atlas-list-title">Landmarks <span class="atlas-result-count">18</span></h3><ol class="atlas-places"></ol></aside></div>
    <p class="atlas-caption">Draft map · Borough membership follows the lore. Shapes, streets, footprints and local business names are proposals.<span>Oblique view · Not to scale<br>Underground sites marked ↓</span></p>
    <section class="atlas-neighborhood" aria-label="Neighborhood planning"></section>
    <details class="atlas-method"><summary>How neighborhood sizes and names are proposed</summary><p>${escape(support.assumptions.footfall)}</p><p>${escape(support.assumptions.foodModel.scope)}</p><p>${escape(support.assumptions.foodModel.formula)} ${escape(support.assumptions.supportModel)}</p><p>${escape(support.assumptions.catchment)}</p><p>${escape(support.assumptions.naming.rule)}</p><a href="data/neonix-map.json" download>Download the editable map layout ↓</a><a href="data/neonix-map-support.json" download>Download neighborhood planning data ↓</a></details>
    <p class="atlas-announcement" role="status" aria-live="polite"></p>
  </section>`;
  const q=selector=>container.querySelector(selector);
  const stage=q('.atlas-stage'),canvas=q('#neonix-map');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const abort=new AbortController(),on=(node,event,callback,options={})=>node.addEventListener(event,callback,{...options,signal:abort.signal});
  function announce(text){q('.atlas-announcement').textContent=text;}
  function overviewPanel(){q('.atlas-selection').innerHTML='<span class="eyebrow">A CITY BUILT AROUND ITS PLACES</span><h3>Start with a landmark.</h3><p>Choose a numbered marker or a borough. Smaller colored sites identify proposed food, shops, services and transport around the major destinations.</p>';q('.atlas-neighborhood').innerHTML=`<div class="atlas-neighborhood-heading"><div><span class="eyebrow">THE LIFE AROUND THE LANDMARKS</span><h2>Big places need neighborhoods.</h2><p>${businesses.size} named business proposals support the city’s 18 destinations. Select a landmark to explore its catchment, food capacity and surrounding services.</p></div><span class="atlas-version">PLANNING PROPOSALS</span></div><div class="atlas-hub-examples">${['stonehall-stadium','neonix-university','the-crystal-conservatory'].map(id=>`<button data-place="${id}"><span>${escape(places.get(id).name)}</span><small>${escape(hubs.get(id).scale)}</small><b>Explore neighborhood ↗</b></button>`).join('')}</div>`;}
  function showNeighborhood(id){const hub=hubs.get(id);if(!hub)return;const p=places.get(id);q('.atlas-neighborhood').innerHTML=`<div class="atlas-neighborhood-heading"><div><span class="eyebrow">NEIGHBORHOOD PROPOSAL / ${escape(byId.get(p.district).name)}</span><h2>Around ${escape(p.name)}</h2><p>${escape(hub.notes)}</p></div><span class="atlas-version">ESTIMATES / NOT CANON</span></div>
    <div class="atlas-demand"><div><b>${range(hub.footfall)}</b><span>${escape(hub.footfall.unit)}</span></div><div><b>${range(hub.food)}</b><span>food counters · on-site + nearby</span></div><div><b>${range(hub.support)}</b><span>${escape(hub.support.unit)}</span></div></div><p class="atlas-estimate-note">${escape(hub.food.basis)} Named examples below are a starting set, not the full business inventory.${p.depth?' These supporting sites are below surface with the landmark.':''}</p>
    <div class="atlas-businesses">${hub.sites.map(s=>`<button data-business="${s.id}" aria-pressed="${selectedBusiness===s.id}" style="--business-color:${colors[s.category]}"><span class="eyebrow">${escape(categories[s.category])}${p.depth?' · BELOW SURFACE':''}</span><strong>${escape(s.name)}</strong><span>${escape(s.description)}</span><small>Locate on map ↗</small></button>`).join('')}</div>`;}
  function renderList(){const term=search.toLocaleLowerCase();const matches=p=>!districtFilter||p.district===districtFilter;const main=[...places.values()].filter(p=>matches(p)&&(!term||`${p.name} ${byId.get(p.district).name}`.toLocaleLowerCase().includes(term)));
    const local=term?[...businesses.values()].filter(b=>matches(b)&&`${b.name} ${b.description} ${places.get(b.hubId).name}`.toLocaleLowerCase().includes(term)):[];
    q('.atlas-result-count').textContent=main.length+local.length;
    q('.atlas-places').innerHTML=main.map(p=>`<li><button data-place="${p.id}" aria-pressed="${selected===p.id&&!selectedBusiness}"><b>${String(p.index+1).padStart(2,'0')}</b><span>${escape(p.name)}</span><small>${escape(byId.get(p.district).name)}${p.depth?' · ↓ Below surface':''}</small></button></li>`).join('')+local.map(b=>`<li><button data-business="${b.id}" aria-pressed="${selectedBusiness===b.id}"><b style="color:${colors[b.category]}">◇</b><span>${escape(b.name)}</span><small>${escape(places.get(b.hubId).name)} · ${escape(categories[b.category])}</small></button></li>`).join('')||'<li class="atlas-empty">No matches in this borough. Try another name or show the whole city.</li>';
  }
  function syncSelection(){canvas.classList.toggle('atlas-has-selection',Boolean(selected));for(const button of q('.atlas-districts').querySelectorAll('button'))button.setAttribute('aria-pressed',button.dataset.district===districtFilter);map?.clearSelectedRegions();map?.clearSelectedMarkers();if(districtFilter)map?.setSelectedRegions([districtFilter]);if(selected)map?.setSelectedMarkers([String(places.get(selected).index)]);for(const node of canvas.querySelectorAll('.atlas-support-site')){const b=businesses.get(node.dataset.business);node.classList.toggle('is-active',selectedBusiness===b.id);node.classList.toggle('is-related',selected===b.hubId);node.setAttribute('aria-pressed',String(selectedBusiness===b.id));}renderList();}
  function selectDistrict(id,focus=false){districtFilter=id;selected=null;selectedBusiness=null;const entry=byId.get(id);q('.atlas-selection').innerHTML=`<span class="eyebrow">BOROUGH</span><h3>${escape(entry.name)}</h3><p>${escape(entry.body)}</p><button data-focus="${id}">Focus borough</button> <a class="atlas-lore-link" href="#entry/${id}">Open borough lore ↗</a>`;syncSelection();if(focus)map?.setFocus({region:id,animate:false});q('.atlas-neighborhood').innerHTML=`<div class="atlas-neighborhood-heading"><div><span class="eyebrow">NEIGHBORHOOD PLANNING</span><h2>${escape(entry.name)}</h2><p>Select one of this borough’s landmarks to explore its proposed local businesses and service demand.</p></div></div><div class="atlas-hub-examples">${[...places.values()].filter(p=>p.district===id).map(p=>`<button data-place="${p.id}"><span>${escape(p.name)}</span><small>${escape(hubs.get(p.id).scale)}</small><b>Explore neighborhood ↗</b></button>`).join('')}</div>`;announce(`${entry.name} selected. ${[...places.values()].filter(p=>p.district===id).length} landmarks.`);}
  function selectPlace(id,focus=false,businessId=null){const p=places.get(id);if(!p)return;selected=id;selectedBusiness=businessId;districtFilter=p.district;const business=businesses.get(businessId),entry=byId.get(id),src=thumbnail(entry);
    q('.atlas-selection').innerHTML=`${src?`<figure><img src="${src}" alt="Concept art for ${escape(p.name)}"></figure>`:''}<span class="eyebrow">${business?escape(categories[business.category])+' / PROPOSED BUSINESS':'LANDMARK '+String(p.index+1).padStart(2,'0')}</span><h3>${escape(business?.name||p.name)}</h3><div class="atlas-place-meta">${escape(byId.get(p.district).name)}${p.depth?' · ↓ Below surface':''}</div><p>${escape(business?`${business.description} Around ${p.name}.`:entry.body)}</p><button data-focus="${p.district}">Focus neighborhood</button> <a class="atlas-lore-link" href="#entry/${id}">${business?'Open landmark lore':'Open lore & artwork'} ↗</a>`;
    syncSelection();showNeighborhood(id);if(focus){map?.setFocus({region:p.district,animate:false});canvas.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});}announce(`${business?.name||p.name} selected. Neighborhood proposal shown below the map.`);
  }
  function reset(){selected=null;selectedBusiness=null;districtFilter=null;search='';q('#map-search').value='';map?.setFocus({regions:layout.districts.map(d=>d.id),animate:false});syncSelection();overviewPanel();announce('Whole city shown. All 18 landmarks available.');}
  function decorate(instance){const group=instance.canvas._rootElement.node;
    const terrain=svg('g',{class:'atlas-terrain',fill:'none',stroke:'#315267','stroke-width':.65,opacity:.6},group);group.prepend(terrain);
    for(let ring=0;ring<9;ring++){const x=130-ring*13,y=50-ring*10;svg('path',{d:`M${x},${y+180} Q${x-48},${y+70} ${x+123},${y} Q${x+310},${y-50} ${x+470},${y+80} T${x+820},${y+130}`},terrain);}
    const roads=svg('g',{class:'atlas-roads',fill:'none','stroke-linejoin':'round','stroke-linecap':'round'},group);
    const streets=[];
    for(const d of layout.districts){const bounds={x:Math.min(...d.points.map(p=>p[0])),y:Math.min(...d.points.map(p=>p[1])),maxX:Math.max(...d.points.map(p=>p[0])),maxY:Math.max(...d.points.map(p=>p[1]))};const defs=svg('defs',{},group),clip=svg('clipPath',{id:'atlas-clip-'+d.id},defs);svg('path',{d:polygon(d.points)},clip);
      const grid=svg('g',{'clip-path':`url(#atlas-clip-${d.id})`,stroke:'#7b9171','stroke-width':1.4,opacity:.55},roads);
      for(let x=Math.floor(bounds.x/64)*64;x<bounds.maxX;x+=64){svg('path',{d:`M${x},${bounds.y} L${x+40},${bounds.maxY}`},grid);streets.push([[x,bounds.y],[x+40,bounds.maxY]]);}
      for(let y=Math.floor(bounds.y/55)*55;y<bounds.maxY;y+=55){svg('path',{d:`M${bounds.x},${y} L${bounds.maxX},${y-35}`},grid);streets.push([[bounds.x,y],[bounds.maxX,y-35]]);}
    }
    for(const pts of layout.routes){const d='M'+pts.map(p=>p.join(',')).join('L');svg('path',{d,stroke:'#132727','stroke-width':10},roads);svg('path',{d,stroke:'#d0c571','stroke-width':3.2},roads);svg('path',{d,stroke:'#f0dd8a','stroke-width':.7,opacity:.65},roads);}
    const buildings=svg('g',{class:'atlas-buildings'},group),rng=random(17013);
    for(const d of layout.districts){const clipped=svg('g',{'clip-path':`url(#atlas-clip-${d.id})`},buildings);for(let y=95;y<790;y+=21){for(let x=155;x<1095;x+=21){const p=[x+rng()*9,y+rng()*8];if(!inside(p,d.points)||rng()<.17)continue;if([...places.values()].some(h=>Math.abs(p[0]-h.point[0])<h.footprint[0]/2+14&&Math.abs(p[1]-h.point[1])<h.footprint[1]/2+14))continue;if(streets.some(([a,b])=>distanceToSegment(p,a,b)<4)||layout.routes.some(pts=>pts.slice(1).some((b,i)=>distanceToSegment(p,pts[i],b)<9)))continue;
      const w=7+rng()*12,h=7+rng()*10,z=(d.id==='humanity-central'?12:d.id==='elven-heights'?9:4)+rng()*(d.id==='humanity-central'?25:9),xx=p[0],yy=p[1];
      svg('path',{d:`M${xx},${yy} l${w},0 l7,-${z} l-${w},0 Z`,fill:d.id==='the-gloomscape'?'#385366':'#397d86',stroke:'#7ad6d0','stroke-width':.5,opacity:.85},clipped);
      svg('path',{d:`M${xx+w},${yy} l0,${h} l7,-${z} l0,-${h} Z`,fill:'#20434f',stroke:'#477580','stroke-width':.5},clipped);
      svg('rect',{x:xx,y:yy-z,width:w,height:h,fill:d.id==='the-gloomscape'?'#4b6572':d.id==='dwarf-district'?'#59838a':'#66b2b6',stroke:'#b0eddb','stroke-width':.45,opacity:.72},clipped);
    }}}
    const landmarks=svg('g',{class:'atlas-landmark-footprints','pointer-events':'none'},group);
    for(const p of places.values()){const [x,y]=p.point,[w,h]=p.footprint,color=districts.get(p.district).color;const g=svg('g',{fill:'#12303b',stroke:color,'stroke-width':1.7,opacity:.9},landmarks);
      if(['stadium','dome','park','plaza'].includes(p.form)){svg('ellipse',{cx:x,cy:y,rx:w/2,ry:h/2},g);svg('ellipse',{cx:x,cy:y,rx:w/2-8,ry:h/2-7,fill:'#1c4350','stroke-width':1},g);if(p.form==='stadium')for(let n=0;n<12;n++){const a=n*Math.PI/6;svg('path',{d:`M${x+Math.cos(a)*(w/2-8)},${y+Math.sin(a)*(h/2-7)} L${x+Math.cos(a)*w/2},${y+Math.sin(a)*h/2}`},g);}if(p.form==='dome')svg('path',{d:`M${x-w/2},${y} Q${x},${y-h} ${x+w/2},${y} M${x},${y-h/2} V${y+h/2}`},g);}
      else{svg('rect',{x:x-w/2,y:y-h/2,width:w,height:h,rx:p.form==='underground'?h/2:2,'stroke-dasharray':p.depth?'4 3':'none'},g);if(['foundry','campus','market','yard'].includes(p.form))for(let n=0;n<3;n++)svg('rect',{x:x-w/2+6+n*w/3,y:y-h/2+7,width:w/3-10,height:h-14,fill:'#3c7480','stroke-width':.8},g);}
    }
    const local=svg('g',{class:'atlas-support-group'},group);
    for(const b of businesses.values()){const [x,y]=b.point;const g=svg('g',{class:'atlas-support-site','data-business':b.id,tabindex:0,role:'button','aria-pressed':'false','aria-label':`${b.name}, ${categories[b.category]}, proposed near ${places.get(b.hubId).name}`},local);svg('title',{},g).textContent=b.name;svg('rect',{x:x-6,y:y-5,width:12,height:10,rx:2,fill:colors[b.category],stroke:'#112835','stroke-width':1.5},g);}
    const labels=svg('g',{class:'atlas-district-labels'},group);for(const d of layout.districts){const t=svg('text',{x:d.label[0],y:d.label[1],class:'atlas-svg-label','text-anchor':'middle'},labels);t.textContent=byId.get(d.id).name.toUpperCase();svg('tspan',{x:d.label[0],dy:14},t).textContent=d.subtitle;}
    for(const [code,r] of Object.entries(instance.regions)){const node=r.element.shape.node;node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',byId.get(code).name);}
    for(const [index,marker] of Object.entries(instance._markers)){const p=[...places.values()][Number(index)],node=marker.element.shape.node;node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`${p.index+1}. ${p.name}${p.depth?', below surface':''}`);}
    life?.destroy();life=bringToLife({container,stage,mapEl:canvas,group,layout,byId,reduced});
  }
  globalThis.jsVectorMap.addMap('neonix-v1',{width:layout.width,height:layout.height,paths:Object.fromEntries(layout.districts.map(d=>[d.id,{name:byId.get(d.id).name,path:polygon(d.points)}]))});
  try{map=new globalThis.jsVectorMap({selector:'#neonix-map',map:'neonix-v1',backgroundColor:'transparent',draggable:true,zoomMin:1,zoomMax:6,zoomStep:1.4,zoomOnScroll:true,zoomAnimate:false,zoomButtons:true,zoomInButton:'#atlas-zoom-in',zoomOutButton:'#atlas-zoom-out',bindTouchEvents:true,showTooltip:true,
    regionStyle:{initial:{fill:'#17313c',fillOpacity:.52,stroke:'#547677',strokeWidth:.8},hover:{fill:'#244754',fillOpacity:.7},selected:{fill:'#244951',fillOpacity:.8,stroke:'#d5df9c',strokeWidth:1.6}},
    markerStyle:{initial:{r:10,fill:'#e18064',stroke:'#ffd2a4',strokeWidth:1.2,strokeOpacity:1},hover:{fill:'#f6bc82',cursor:'pointer'},selected:{fill:'#f2e7b2',stroke:'#fff5cf',strokeWidth:2}},
    markerLabelStyle:{initial:{fontFamily:'monospace',fontSize:8,fontWeight:700,fill:'#152227'}},markers:[...places.values()].map(p=>({name:p.name+(p.depth?' · Below surface':''),coords:p.point})),labels:{markers:{render:(_marker,index)=>String(Number(index)+1).padStart(2,'0'),offsets:()=>[-15,0]}},
    onLoaded:decorate,onRegionClick:(_event,code)=>{if(!dragged)selectDistrict(code);},onMarkerClick:(_event,index)=>{if(!dragged)selectPlace([...places.values()][Number(index)].id);},onViewportChange(scale){if(map&&canvas.isConnected)q('.atlas-zoom-value').textContent=(scale/map._baseScale).toFixed(1)+'×';}
  });}catch(error){q('.atlas-canvas').innerHTML='<p class="atlas-empty">The visual map is unavailable. Use the city index to explore each location.</p>';console.error('Neonix map initialization failed',error);}
  on(canvas,'pointerdown',event=>{dragStart=[event.clientX,event.clientY];dragged=false;});on(canvas,'pointermove',event=>{if(dragStart&&Math.hypot(event.clientX-dragStart[0],event.clientY-dragStart[1])>6)dragged=true;});on(window,'pointerup',()=>{dragStart=null;});
  on(container,'click',event=>{const el=event.target.closest('[data-place],[data-business],[data-district],[data-focus],[data-map-reset]');if(!el)return;if(el.dataset.place)selectPlace(el.dataset.place,true);else if(el.dataset.business){if(dragged&&el.closest('svg'))return;const b=businesses.get(el.dataset.business);selectPlace(b.hubId,!el.closest('svg'),b.id);}else if(el.dataset.district)selectDistrict(el.dataset.district,true);else if(el.dataset.focus)map?.setFocus({region:el.dataset.focus,animate:false});else if(el.hasAttribute('data-map-reset'))reset();});
  on(canvas,'keydown',event=>{const target=event.target;if(['Enter',' '].includes(event.key)&&target.matches('.jvm-region,.jvm-marker,.atlas-support-site')){event.preventDefault();if(target.dataset.code)selectDistrict(target.dataset.code);else if(target.dataset.index)selectPlace([...places.values()][Number(target.dataset.index)].id);else if(target.dataset.business){const b=businesses.get(target.dataset.business);selectPlace(b.hubId,false,b.id);}return;}if(target===canvas&&['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')reset();else q(event.key==='-'?'#atlas-zoom-out':'#atlas-zoom-in').click();}});
  on(q('#map-search'),'input',event=>{search=event.target.value.trim();renderList();});
  on(container,'change',event=>{const layer=event.target.dataset.mapLayer;if(layer){stage.dataset[layer]=event.target.checked?'on':'off';if(layer==='support')for(const n of canvas.querySelectorAll('.atlas-support-site'))n.setAttribute('tabindex',event.target.checked?'0':'-1');}});
  const observer=new ResizeObserver(()=>{if(map&&canvas.isConnected){map.updateSize();q('.atlas-zoom-value').textContent=(map.scale/map._baseScale).toFixed(1)+'×';}});observer.observe(canvas);
  activeCleanup=()=>{abort.abort();observer.disconnect();life?.destroy();map?.destroy();};overviewPanel();renderList();
}
