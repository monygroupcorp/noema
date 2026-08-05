/* ============ noema shell — shared identity + nav + icons + font logic ============ */
const IDENTS = [
  { id:'studio', name:'studio', role:'monyrth', tier:'identified', chipCls:'named', chipColor:'#cdd2ff', glyph:'S',
    bal:'214 credits',
    can:['identity','prompts','outputs'], cant:[],
    redact:[['who','studio · monyrth','v'],['prompt','“…neon temple, dusk”','v'],['output','flux-schnell.png','v'],['cost','$0.043 · 12 GPU-min','v']],
    note:'<b>Identified.</b> You’re signed in. We keep your work and your galaxy.',
    dest:'posting as <b style="color:var(--text)">studio</b>' },
  { id:'ghost', name:'untitled', role:'bearer purse', tier:'anon', chipCls:'masked', glyph:'◷',
    bal:'purse · 38 credits',
    can:['prompts','outputs'], cant:['identity'],
    redact:[['who','▮▮▮▮▮▮','block'],['prompt','“…neon temple, dusk”','v'],['output','flux-schnell.png','v'],['cost','$0.043 · 12 GPU-min','v']],
    note:'<b>Anonymous.</b> A bearer purse — no name is attached. We see the work, never who you are.',
    dest:'posting <b style="color:var(--text)">anonymously</b> — no identity attached' },
  { id:'vault', name:'private', role:'sealed tunnel', tier:'tee', chipCls:'sealed', glyph:'∅',
    bal:'tee · metered',
    can:['the meter'], cant:['identity','prompts','outputs'],
    redact:[['who','▮▮▮▮▮▮','block'],['prompt','▮▮▮▮▮▮▮▮▮▮','block'],['output','▮▮▮▮▮▮','block'],['cost','$0.043 · 12 GPU-min','v']],
    note:'<b>Private.</b> Runs in a sealed pod over your own tunnel. We receive only the meter — never the work itself.',
    dest:'<b style="color:var(--text)">sealed</b> to your private tunnel — we can’t read this' },
];
const TIERLABEL = { identified:'identified', anon:'anonymous', tee:'private' };

let current = localStorage.getItem('noema-ident') || 'studio';
const $ = s => document.querySelector(s);
const setHTML = (sel,html) => { const el=$(sel); if(el) el.innerHTML=html; };
const setTXT  = (sel,txt)  => { const el=$(sel); if(el) el.textContent=txt; };
const showEl  = (sel,on)   => { const el=$(sel); if(el) el.style.display = on?'flex':'none'; };
const list = (arr,fb) => arr.length ? arr.join(' · ') : fb;
const ic = (name,cls) => `<i data-lucide="${name}"${cls?` class="${cls}"`:''}></i>`;

/* ---------- Lucide icons (loaded once; redrawn after dynamic renders) ---------- */
function drawIcons(){ if(window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
function loadIcons(){
  if(window.lucide){ drawIcons(); return; }
  if(window.__lucideLoading) return; window.__lucideLoading = true;
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js';
  s.onload = drawIcons;
  document.head.appendChild(s);
}

/* identity chip: named = letter avatar · anon = venetian-mask · tee = eye-off (blindness, not a shield) */
function chipHTML(d){
  if(d.chipCls==='named') return `<span class="chip named" style="background:${d.chipColor}">${d.glyph}</span>`;
  const name = d.chipCls==='masked' ? 'venetian-mask' : 'eye-off';
  return `<span class="chip ${d.chipCls}">${ic(name)}</span>`;
}

/* ---------- rail / nav (generated → identical chrome on every page) ---------- */
const NAV = [
  { sec:'Create', items:[
    {href:'index.html',   ico:'message-square',     label:'Chat',    key:'⌘1'},
    {href:'card.html',    ico:'sliders-horizontal', label:'Cards',   key:'⌘2'},
    {href:'catalog.html', ico:'layout-grid',        label:'Catalog', key:'⌘3'},
    {href:'canvas.html',  ico:'workflow',           label:'Canvas',  key:'⌘4'},
  ]},
  { sec:'Remember', items:[
    {href:'space.html',   ico:'sparkles',   label:'Space',  key:'⌘5'},
    {href:'trace.html',   ico:'footprints', label:'Traces'},
  ]},
  { sec:'You', items:[
    {ico:'circle-user', label:'Account', menu:[
      {href:'vault.html',   ico:'key-round',    label:'Vault'},
      {href:'profile.html', ico:'palette',      label:'Profile'},
      {href:'status.html',  ico:'receipt-text', label:'Ledger'},
    ]},
  ]},
];
const curFile = () => (location.pathname.split('/').pop() || 'index.html');

/* the altitude "webring" — explicit level-stepping, beside the identity control */
const ALT = [
  {href:'index.html',  label:'chat'},
  {href:'card.html',   label:'card'},
  {href:'canvas.html', label:'canvas'},
  {href:'space.html',  label:'space'},
];
function mountAltitude(){
  const me = $('#me'); if(!me || $('.altitude')) return;
  const here = curFile();
  const idx = ALT.findIndex(a=>a.href===here);
  const i = idx<0 ? 0 : idx;
  const prev = ALT[(i-1+ALT.length)%ALT.length].href;
  const next = ALT[(i+1)%ALT.length].href;
  const ring = ALT.map(a=>`<a class="alt-step ${a.href===here?'on':''}" href="${a.href}">${a.label}</a>`).join('<span class="alt-dot">·</span>');
  const el = document.createElement('div'); el.className='altitude';
  el.innerHTML = `<a class="alt-nav" href="${prev}" title="up a level">${ic('chevron-left')}</a>`
    + `<span class="alt-ring">${ring}</span>`
    + `<a class="alt-nav" href="${next}" title="down a level">${ic('chevron-right')}</a>`;
  me.insertAdjacentElement('afterend', el);
  drawIcons();
}

function renderRail(){
  const rail = $('#rail'); if(!rail) return;
  const here = curFile();
  const nav = NAV.map(s=>
    `<div class="lbl">${s.sec}</div>` + s.items.map(i=>
      i.menu
        ? `<button class="navitem ${i.menu.some(m=>m.href===here)?'active':''}" id="accountnav" data-menu><span class="ico">${ic(i.ico)}</span> ${i.label}</button>`
        : `<a class="navitem ${i.href===here?'active':''}" href="${i.href}"><span class="ico">${ic(i.ico)}</span> ${i.label}${i.key?`<span class="k mono">${i.key}</span>`:''}</a>`
    ).join('')
  ).join('');
  rail.innerHTML = `
    <div class="brand"><span class="glyph"></span><b>noema</b><a href="map.html" class="maplink" title="all screens">${ic('map')}</a></div>
    <nav class="nav">${nav}</nav>
    <div class="keyring">
      <div class="lbl">Keyring <a href="keyring.html" title="manage identities">${ic('settings-2')}</a></div>
      <div id="keyring"></div>
      <a class="newid" href="keyring.html"><span class="plus">${ic('plus')}</span><span>New identity…</span></a>
    </div>`;
  mountAccountMenu();
  drawIcons();
}

/* the You group collapses into one Account item → a dropdown menu (declutters the bottom bar) */
function mountAccountMenu(){
  const trigger = $('#accountnav'); if(!trigger) return;
  const item = NAV.flatMap(s=>s.items).find(i=>i.menu); if(!item) return;
  const here = curFile();
  let menu = $('#navmenu');
  if(!menu){ menu=document.createElement('div'); menu.id='navmenu'; menu.className='navmenu'; document.body.appendChild(menu);
    document.addEventListener('click', e=>{ if(menu.classList.contains('open') && !e.target.closest('#navmenu') && !e.target.closest('#accountnav')) menu.classList.remove('open'); });
  }
  menu.innerHTML = item.menu.map(m=>`<a class="${m.href===here?'on':''}" href="${m.href}">${ic(m.ico)} ${m.label}</a>`).join('');
  trigger.onclick = e=>{ e.stopPropagation();
    const r=trigger.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth-196) + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    menu.classList.toggle('open');
  };
}

function renderKeyring(){
  if(!$('#keyring')) return;
  $('#keyring').innerHTML = IDENTS.map(d=>
    `<div class="ident ${d.id===current?'sel':''}" onclick="pick('${d.id}')">
      ${chipHTML(d)}
      <span class="meta"><div class="nm">${d.tier==='anon'?'anonymous':d.name}</div>
      <div class="tt"><span class="ttdot"></span>${TIERLABEL[d.tier]}</div></span></div>`
  ).join('');
  drawIcons();
}

/* the single trust source: identity control (top-left) + an expandable proof popover */
const PRIV = { identified:['eye','identified'], anon:['venetian-mask','anonymous'], tee:['eye-off','private'] };
function redactRows(d){ return d.redact.map(r=>`<div class="row"><span class="k">${r[0]}</span><span class="v ${r[2]==='block'?'block':''}">${r[1]}</span></div>`).join(''); }
function fillTrustPop(d){
  const p = $('#trustpop'); if(!p) return;
  p.innerHTML = `
    <div class="tp-head">${chipHTML(d)}<div><div class="nm">${d.tier==='anon'?'anonymous':d.name}</div><div class="role">${d.role}</div></div></div>
    <div class="tp-sec"><div class="tp-l">noema can see</div>
      <div class="tp-can">${list(d.can,'nothing')}</div>
      ${d.cant.length?`<div class="tp-cant">hidden — ${d.cant.join(', ')}</div>`:''}</div>
    <div class="tp-sec"><div class="tp-l">what actually reaches us</div>
      <div class="redact mono">${redactRows(d)}</div></div>
    ${d.tier==='tee'?`<div class="tp-eph">${ic('eye-off')} leaves no trace — nothing is kept</div>`:''}
    <a class="tp-manage" href="keyring.html">Switch identity →</a>`;
  drawIcons();
}
function positionTrust(){ const mb=$('#mebtn'), p=$('#trustpop'); if(!mb||!p) return; const r=mb.getBoundingClientRect(); p.style.left=Math.max(12,r.left)+'px'; p.style.top=(r.bottom+8)+'px'; }
function toggleTrust(){ const p=$('#trustpop'); if(!p) return; if(!p.classList.contains('open')) positionTrust(); p.classList.toggle('open'); }
function mountTrustPop(){
  if($('#trustpop')) return;
  const p=document.createElement('div'); p.id='trustpop'; document.body.appendChild(p);
  document.addEventListener('click', e=>{ const pop=$('#trustpop'); if(!pop || !pop.classList.contains('open')) return;
    if(e.target.closest('#trustpop') || e.target.closest('#mebtn')) return; pop.classList.remove('open'); });
}

function pick(id){
  current = id; localStorage.setItem('noema-ident', id);
  const d = IDENTS.find(x=>x.id===id);
  document.documentElement.className = 'tier-'+d.tier;
  const pv = PRIV[d.tier];
  setHTML('#me', `<button class="mebtn" id="mebtn">${chipHTML(d)}<span class="nm">${d.tier==='anon'?'anonymous':d.name}</span>`
    + `<span class="trust-mini">${ic(pv[0])} ${pv[1]}</span>${ic('chevron-down','cv')}</button>`);
  const mb = $('#mebtn'); if(mb) mb.onclick = e=>{ e.stopPropagation(); toggleTrust(); };
  fillTrustPop(d);
  setHTML('#dest', `<span class="ttdot"></span>${d.dest}`);
  setTXT('#bal', d.bal);
  showEl('#eph', d.tier==='tee');
  renderKeyring();
  drawIcons();
  if(window.onIdentity) window.onIdentity(d);
}
window.pick = pick;

/* ---------- font pairing toggle ---------- */
const FONTS = [
  { id:'geist', nm:'Geist',  mn:'Geist Mono' },
  { id:'plex',  nm:'IBM Plex', mn:'Plex Mono' },
  { id:'mix',   nm:'Geist', mn:'Plex Mono' },
  { id:'space', nm:'Space Grotesk', mn:'Space Mono' },
];
function applyFont(id){
  document.documentElement.setAttribute('data-font', id);
  localStorage.setItem('noema-font', id);
  document.querySelectorAll('.fonttoggle .ft').forEach(b=>b.classList.toggle('on', b.dataset.font===id));
}
function mountFontToggle(){
  const cur = localStorage.getItem('noema-font') || 'geist';
  const el = document.createElement('div'); el.className='fonttoggle';
  el.innerHTML = `<span class="lbl">type</span>` + FONTS.map(f=>
    `<button class="ft" data-font="${f.id}"><span class="nm">${f.nm}</span><span class="mn">${f.mn}</span></button>`).join('');
  document.body.appendChild(el);
  el.querySelectorAll('.ft').forEach(b=> b.onclick = ()=>applyFont(b.dataset.font));
  applyFont(cur);
}

/* ---------- concierge bubble (chat collapses to this as you go deeper) ---------- */
function mountConcierge(){
  if(document.querySelector('.thread')) return;     // full chat present → no bubble
  const el = document.createElement('div'); el.className='concierge';
  el.innerHTML = `
    <div class="cpanel">
      <div class="chead"><span class="orb"></span><b>Concierge</b><span class="x" data-close>${ic('x')}</span></div>
      <div class="cbody">Tell me what to make or change. I’ll pick the tool and run it.</div>
      <div class="cinput"><input placeholder="make · adjust · explain…" /><button>${ic('arrow-up')}</button></div>
    </div>
    <div class="cbtn" data-toggle><span class="orb"></span>
      <span class="lab">Concierge<small>make · adjust · explain</small></span></div>`;
  if(document.querySelector('.context')) el.classList.add('has-context');  // sit left of the right sidebar
  document.body.appendChild(el);
  el.querySelector('[data-toggle]').onclick = ()=> el.classList.toggle('open');
  el.querySelector('[data-close]').onclick  = ()=> el.classList.remove('open');
  drawIcons();
}

function initShell(){ renderRail(); mountFontToggle(); mountConcierge(); mountTrustPop(); mountAltitude(); renderKeyring(); pick(current); loadIcons(); }
document.addEventListener('DOMContentLoaded', initShell);
