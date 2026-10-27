/**
 * Dashboard of the companion server: one self-contained HTML page that polls /api/state and /api/metrics.
 * Same look as the game server's /admin page. Values from the server are inserted with textContent, never as HTML.
 */
const CSS = `
:root{--bg:#1b1033;--panel:#2a1a4d;--line:#ffd23f55;--accent:#ffd23f;--text:#fff;--dim:#ffffffaa;--bad:#ff6b6b;--ok:#6bff9e;--c1:#ffd23f;--c2:#6bd1ff;--c3:#ff8fd8;--c4:#6bff9e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:2px solid var(--line);flex-wrap:wrap}
h1{margin:0;color:var(--accent);font-size:20px}
nav{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px}
nav button{background:var(--panel);color:var(--accent);border:2px solid var(--line);border-radius:10px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer}
nav button[aria-current]{background:var(--accent);color:var(--bg)}
main{padding:0 16px 40px;max-width:1100px}
h2{color:var(--accent);font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin:22px 0 8px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
th{color:var(--accent);font-size:13px}
tr.gone td{opacity:.55}
button,input{font:inherit}
button.b{background:var(--accent);color:var(--bg);border:0;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer}
button.b.bad{background:var(--bad)}
input{background:#0006;color:var(--text);border:2px solid var(--line);border-radius:8px;padding:5px 8px;max-width:100%}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border:2px solid var(--ok);border-radius:999px;color:var(--ok);font-weight:700;font-size:13px}
.pill.bad{border-color:var(--bad);color:var(--bad)}.pill.dim{border-color:var(--line);color:var(--dim)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
.dim{color:var(--dim)}.bad{color:var(--bad)}
.card{background:var(--panel);border:2px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile b{display:block;font-size:22px}.tile span{color:var(--dim);font-size:12px}.tile{cursor:help}
.bar{height:6px;background:#ffffff22;border-radius:3px;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}
svg{width:100%;height:70px;background:#0004;border-radius:8px}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dim)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.hist{display:grid;grid-template-columns:minmax(90px,160px) 1fr 70px;gap:6px 10px;align-items:center;font-size:13px}
.hist .bar{margin:0;height:12px}
#msg{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--panel);border:2px solid var(--accent);border-radius:10px;padding:8px 14px;display:none;z-index:5}
#login{max-width:420px;margin:60px auto;padding:0 16px}
pre{white-space:pre-wrap;font-size:12px;color:var(--dim);margin:0}
@media(max-width:700px){th:nth-child(n+7),td:nth-child(n+7){font-size:13px}}
`;

const SCRIPT = String.raw`
const $=(s,r=document)=>r.querySelector(s);
function h(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,v)}for(const c of kids.flat()){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)))}return e}
let token='';try{token=sessionStorage.getItem('pg-bot-token')||''}catch{}
const state={tab:'bots',timer:null};
function toast(t,bad){const m=$('#msg');m.textContent=t;m.style.display='block';m.style.borderColor=bad?'var(--bad)':'var(--accent)';clearTimeout(toast.t);toast.t=setTimeout(()=>m.style.display='none',3000)}
async function api(path,method,body){
  const r=await fetch(API+path,{method:method||(body?'PATCH':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){showLogin(d.error);throw new Error('unauthorized')}
  if(!r.ok)throw new Error(d.error?(d.errors?d.error+': '+Object.entries(d.errors).map(([k,v])=>k+' '+v).join(', '):d.error):'HTTP '+r.status);
  return d;
}
async function act(fn,okMsg){try{await fn();if(okMsg)toast(okMsg);render()}catch(e){toast(e.message,true)}}
const ago=ts=>{if(!ts)return '-';const s=Math.max(0,(Date.now()-ts)/1000|0);return s<60?s+'s':s<3600?(s/60|0)+'m':(s/3600|0)+'h '+((s%3600)/60|0)+'m'};
const f1=n=>(Math.round(n*10)/10).toString();
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
function table(head,rows,cls){return h('table',{},h('thead',{},h('tr',{},head.map(x=>h('th',{},x)))),h('tbody',{},rows.map((r,i)=>h('tr',{class:cls&&cls[i]||''},r.map(c=>h('td',{},c))))))}
function showLogin(err){
  clearInterval(state.timer);
  // an error only makes sense once a token was tried; a stale one is dropped so it cannot keep failing
  const tried=token!=='';token='';try{sessionStorage.removeItem('pg-bot-token')}catch{}
  $('#root').replaceChildren(h('div',{id:'login'},h('h1',{},'AI bots'),h('p',{class:'dim'},'Enter the admin token (ADMIN_TOKEN).'),tried&&err?h('p',{class:'bad'},err):null,
    h('div',{class:'row'},h('input',{type:'password',id:'tok',placeholder:'token',autocomplete:'off'}),h('button',{class:'b',onclick:()=>{token=$('#tok').value.trim();try{sessionStorage.setItem('pg-bot-token',token)}catch{}start()}},'Sign in'))));
  $('#tok').addEventListener('keydown',e=>{if(e.key==='Enter')$('#tok').nextSibling.click()});
  $('#tok').focus();
}
const NS='http://www.w3.org/2000/svg';
function chart(title,series,unit,pts){
  // series: [{name,color,key:fn(point)->number}]
  const W=300,H=70;let max=1;for(const s of series)for(const p of pts)max=Math.max(max,s.key(p)||0);
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('preserveAspectRatio','none');
  for(const s of series){const d=pts.map((p,i)=>(i?'L':'M')+(pts.length>1?i/(pts.length-1)*W:0).toFixed(1)+' '+(H-4-((s.key(p)||0)/max)*(H-8)).toFixed(1)).join(' ');
    const el=document.createElementNS(NS,'path');el.setAttribute('d',d);el.setAttribute('fill','none');el.setAttribute('stroke',s.color);el.setAttribute('stroke-width','2');svg.append(el)}
  const last=pts[pts.length-1];
  return h('div',{class:'card'},h('div',{class:'row'},h('b',{},title),h('span',{class:'dim'},'peak '+f1(max)+unit)),svg,
    h('div',{class:'legend'},series.map(s=>h('span',{},h('i',{style:'background:'+s.color}),s.name+' '+(last?f1(s.key(last)||0)+unit:'-')))));
}
function tile(l,v,pct,tip){return h('div',{class:'card tile',title:tip||l},h('span',{},l),h('b',{},v),pct==null?null:h('div',{class:'bar'},h('i',{style:'width:'+Math.min(100,Math.max(0,pct))+'%'})))}
function sect(t,...tiles){return [h('h2',{},t),h('div',{class:'grid'},...tiles.filter(Boolean))]}
function hist(title,rows,unit,max){
  const top=Math.max(max||1,...rows.map(r=>r.v));
  return h('div',{class:'card'},h('b',{},title),rows.length?h('div',{class:'hist'},rows.flatMap(r=>[h('span',{},r.name),h('div',{class:'bar'},h('i',{style:'width:'+(r.v/top*100)+'%;background:'+(r.color||'var(--accent)')})),h('span',{class:'dim'},f1(r.v)+unit)])):h('p',{class:'dim'},'No bots running.'));
}
const idleOf=b=>b.idleSince==null?b.noAiSince:b.noAiSince==null?b.idleSince:Math.min(b.idleSince,b.noAiSince);
const STATE_LABEL={joining:'joining',lobby:'in lobby',playing:'playing',idle:'idle (no AI for this round)',results:'results',ended:'left'};
const TABS={
async bots(){
  const s=await api('/state');
  const live=s.bots.filter(b=>b.state!=='ended');
  const head=h('div',{class:'row'},
    h('span',{class:'pill'+(s.gameServer.up?'':' bad')},s.gameServer.up?'game server up':'game server unreachable'),
    h('span',{class:'pill dim'},live.length+' / '+s.join.maxBots+' bots'),
    h('span',{class:'dim'},'AI for: '+(s.ai.games.map(g=>g.id+' ('+g.level+')').join(', ')||'none')),
    h('button',{class:'b'+(s.paused?'':' bad'),onclick:async()=>{try{await api('/pause?paused='+(s.paused?0:1),'POST');render()}catch(e){toast(e.message,true)}}},s.paused?'Resume joining':'Pause and remove bots'));
  const err=s.gameServer.error?h('p',{class:'bad'},s.gameServer.url+': '+s.gameServer.error):null;
  const rows=s.bots.map(b=>[b.name,cap(b.level)||b.policy,b.selection||b.gameId,b.room,STATE_LABEL[b.state]+(b.state==='ended'&&b.endReason?' ('+b.endReason+')':'')+(idleOf(b)&&b.state!=='ended'?(s.ai.idleLeaveSeconds>0?' · leaves in '+Math.max(0,Math.round(s.ai.idleLeaveSeconds-(s.now-idleOf(b))/1000))+'s':' · staying idle'):''),
    b.round||'-',b.rounds?(b.lastPlace==null?'-':'#'+b.lastPlace)+' · '+b.points+' pts':'-',b.state==='ended'?'-':f1(b.cpu)+'%',b.state==='ended'?'-':f1(b.heapMB+b.externalMB)+' MB',ago(b.startedAt),
    b.state==='ended'?'':h('button',{class:'b bad',onclick:async()=>{try{await api('/bots/'+b.id+'/stop','POST');toast('Stopping '+b.name);render()}catch(e){toast(e.message,true)}}},'Stop')]);
  return [head,err,s.bots.length?table(['Bot','Level','Game','Room','State','Round','Last result','CPU','RAM','Up',''],rows,s.bots.map(b=>b.state==='ended'?'gone':'')):h('p',{class:'dim'},'No bots yet. They join open lobbies that have a human and a game with an AI.')];
},
async resources(){
  const[s,m]=await Promise.all([api('/state'),api('/metrics')]);
  const u=s.usage;if(!u)return [h('p',{class:'dim'},'Collecting samples...')];
  const pts=m.points,mn=u.main;
  const out=[
    ...sect('This machine',tile('CPU',f1(u.host.cpu)+'%',u.host.cpu,'Share of all CPU cores in use on the machine running this companion server.'),tile('RAM',u.host.memUsedMB+' / '+u.host.memTotalMB+' MB',u.host.memPct),tile('Load (1m)',u.host.load1),tile('Cores',u.host.cores)),
    ...(EMBEDDED?[]:sect('Party-game server'+(mn&&mn.version?' '+mn.version:''),mn&&mn.reachable?[tile('Process CPU',f1(mn.cpu)+'%',mn.cpu,mn.instant?'CPU of the game server process (one core = 100%).':'Average since the game server last reset its stats. Give --admin-token for the live value.'),tile('Process RSS',f1(mn.rssMB)+' MB'),tile('Heap',f1(mn.heapMB)+' MB'),tile('Rooms',mn.rooms+' / '+mn.maxRooms),tile('Clients',mn.clients),mn.host?tile('Its machine CPU',f1(mn.host.cpuPercent)+'%',mn.host.cpuPercent):null,mn.host?tile('Its machine RAM',mn.host.memUsedMB+' / '+mn.host.memTotalMB+' MB',mn.host.memUsedMB/mn.host.memTotalMB*100):null,mn.host&&mn.host.temperatureC!=null?tile('Its temperature',mn.host.temperatureC+' °C',mn.host.temperatureC):null]:[tile('Game server','unreachable')])),
    ...sect(EMBEDDED?'Game server (bots included)':'Companion server (bots + dashboard)',tile('Process CPU',f1(u.companion.cpu)+'%',u.companion.cpu,'All threads of this process, one core = 100%.'),tile('Process RSS',f1(u.companion.rssMB)+' MB'),tile('Heap (main thread)',f1(u.companion.heapMB)+' MB'),tile('Without the bots',f1(u.core.cpu)+'%',u.core.cpu,'Manager, room watcher and dashboard: process CPU minus the bot threads.')),
    ...sect('AI bots (all together)',tile('Bots running',u.bots.count),tile('CPU',f1(u.bots.cpu)+'%',u.bots.cpu,'Sum of the bots, each measured as the busy share of its own thread.'),tile('Heap + buffers',f1(u.bots.heapMB)+' MB'),tile('Per bot (avg)',u.bots.count?f1(u.bots.cpu/u.bots.count)+'% · '+f1(u.bots.heapMB/u.bots.count)+' MB':'-')),
    h('h2',{},'Each bot'),
    h('div',{class:'grid'},
      hist('CPU per bot',s.bots.filter(b=>b.state!=='ended').map(b=>({name:b.name+' · '+b.room,v:b.cpu})),'%',10),
      hist('RAM per bot',s.bots.filter(b=>b.state!=='ended').map(b=>({name:b.name+' · '+b.room,v:b.heapMB+b.externalMB,color:'var(--c2)'})),' MB',10)),
    h('h2',{},'Last '+Math.round(pts.length*m.intervalMs/60000*10)/10+' minutes'),
    h('div',{class:'grid'},
      chart('CPU: who uses it',[{name:'game server',color:'var(--c2)',key:p=>p.main&&p.main.reachable?p.main.cpu:0},{name:'bots',color:'var(--c1)',key:p=>p.bots.cpu},{name:'companion core',color:'var(--c3)',key:p=>p.core.cpu}],'%',pts),
      chart('RAM: who uses it',[{name:'game server',color:'var(--c2)',key:p=>p.main&&p.main.reachable?p.main.rssMB:0},{name:'companion',color:'var(--c3)',key:p=>p.companion.rssMB},{name:'bots (heap)',color:'var(--c1)',key:p=>p.bots.heapMB}],' MB',pts),
      chart('Machine CPU',[{name:'cpu',color:'var(--c1)',key:p=>p.host.cpu}],'%',pts),
      chart('Machine RAM',[{name:'ram',color:'var(--c1)',key:p=>p.host.memPct}],'%',pts),
      chart('Bots running',[{name:'bots',color:'var(--c4)',key:p=>p.bots.count}],'',pts))];
  return out;
},
async rooms(){
  const s=await api('/state');
  const levels=[...new Set(s.ai.games.flatMap(g=>g.levels))];
  const WHY={'off':'bots not enabled here','bot-present':'a bot is in','joining':'bot joining','no-human':'waiting for a human','not-open':'match running','protected':'locked or password','full':'full','bot-limit':'bot limit reached','paused':'joining paused','cooldown':'cooling off','no-ai':'no AI for this game','probe-failed':'could not read the game'};
  return [h('p',{class:'dim'},'Rooms of '+s.gameServer.url+', refreshed every '+s.join.pollSeconds+' s. A bot joins an open lobby with at least '+s.join.minHumans+' human and an AI for its game.'),
    s.rooms.length?table(['Room','Game','Phase','Players','Humans','Bots','Decision',''],s.rooms.map(r=>[r.code,r.game,r.phase,r.players+'/'+r.maxPlayers,r.humans,r.bots,(WHY[r.decision]||r.decision)+(r.detail?' · '+r.detail:''),
      h('span',{},
        h('select',{id:'lv-'+r.code,title:'difficulty of the new bot'},[h('option',{value:''},'level: default'),...levels.map(x=>h('option',{value:x},x))]),
        h('button',{class:'b',onclick:()=>{const lv=$('#lv-'+r.code).value;act(async()=>{const d=await api('/rooms/'+r.code+'/bot','POST',lv?{level:lv}:{});toast(d.bot+' is joining '+r.code)})}},'Add bot'),
        r.bots?h('button',{class:'b bad',onclick:()=>act(()=>api('/rooms/'+r.code+'/bots/remove','POST'),'Bots removed')},'Remove bots'):null)])):h('p',{class:'dim'},'No rooms right now.')];
},
async config(){
  const d=await api('/config');
  const games=d.games;
  const levels=[...new Set(games.flatMap(g=>g.levels))];
  const changed=k=>d.overridden.includes(k);
  const num=(r)=>r.min+' – '+r.max;
  const mapSel=(k,g,opts,cur)=>h('label',{style:'display:inline-flex;gap:4px;align-items:center;margin-right:10px'},g.id,h('select',{id:'cfg-'+k+'-'+g.id},[h('option',{value:''},'(default)'),...opts.map(x=>h('option',{value:x,selected:x===cur},x))]));
  const field=k=>{const r=d.ranges[k],v=d.values[k];
    if(r.type==='bool')return h('input',{type:'checkbox',id:'cfg-'+k,checked:v});
    if(r.type==='enum')return h('select',{id:'cfg-'+k},r.values.map(x=>h('option',{value:x,selected:x===v},x)));
    if(r.type==='int')return h('input',{type:'number',id:'cfg-'+k,value:v,min:r.min,max:r.max,size:8});
    if(r.type==='string'&&k==='ai.level'){const opts=['random',...levels];if(!opts.includes(v))opts.push(v);return h('select',{id:'cfg-'+k},opts.map(x=>h('option',{value:x,selected:x===v},x)))}
    if(r.type==='string')return h('input',{type:'text',id:'cfg-'+k,value:v,maxlength:r.maxLength||40,size:16});
    if(r.type==='map')return h('span',{},games.map(g=>mapSel(k,g,k==='ai.levels'?[...g.levels,'random']:g.policies,v[g.id])));
    return h('input',{type:'text',id:'cfg-'+k,value:Object.entries(v).map(([a,b])=>a+'='+b).join(', '),size:28,placeholder:'aim=0.8, noise=5'})};
  const el=id=>document.getElementById(id);
  const read=k=>{const r=d.ranges[k];
    if(r.type==='bool')return el('cfg-'+k).checked;
    if(r.type==='int')return Number(el('cfg-'+k).value);
    if(r.type==='map'){const o={};for(const g of games){const x=el('cfg-'+k+'-'+g.id).value;if(x)o[g.id]=x}return o}
    if(r.type==='numbers'){const o={};for(const part of el('cfg-'+k).value.split(',')){const t=part.trim();if(!t)continue;const[a,b]=t.split('=');o[a.trim()]=Number(b)}return o}
    return el('cfg-'+k).value};
  const allowed=k=>{const r=d.ranges[k];return r.type==='bool'?'on / off':r.type==='int'?num(r):r.type==='enum'?r.values.join(' | '):r.type==='map'?'per game':r.type==='numbers'?'name=number, ...':'text'+(r.maxLength?', up to '+r.maxLength+' characters':'')};
  const fmt=v=>typeof v==='object'?JSON.stringify(v):String(v);
  const rows=Object.keys(d.values).map(k=>[h('div',{},k,h('div',{class:'dim'},d.ranges[k].help)),field(k),allowed(k),fmt(d.defaults[k])+(changed(k)?'  (changed here)':'')]);
  return [h('p',{class:'dim'},'Changes apply at once and are kept across restarts; they win over the config file until reset. Lowering max bots stops no bot, it only blocks new ones.'),
    table(['Setting','Value','Allowed','Configured'],rows),
    h('div',{class:'row'},
      h('button',{class:'b',onclick:()=>{const body={};for(const k of Object.keys(d.values)){let v;try{v=read(k)}catch(e){return toast(k+': '+e.message,true)}if(JSON.stringify(v)!==JSON.stringify(d.values[k]))body[k]=v}if(!Object.keys(body).length)return toast('Nothing changed');act(()=>api('/config','PATCH',body),'Applied')}},'Apply'),
      h('button',{class:'b bad',onclick:()=>act(()=>api('/config','DELETE'),'Reset')},'Reset all to configured')),
    h('h2',{},'Needs a restart'),table(['Setting','Value'],Object.entries(d.restartOnly).map(([k,v])=>[k,String(v)]))];
},
async audit(){
  const{entries}=await api('/audit?limit=200');
  return entries.length?[table(['When','Action','Target','From','Detail'],entries.map(e=>[ago(e.ts)+' ago',e.action,e.target||'',e.ip,e.detail?JSON.stringify(e.detail):'']))]:[h('p',{class:'dim'},'Nothing yet.')];
},
async log(){
  const s=await api('/state');
  return s.log.length?[h('pre',{},s.log.map(l=>new Date(l.ts).toISOString().slice(11,19)+' '+l.id+' '+l.line).join('\n'))]:[h('p',{class:'dim'},'Nothing yet.')];
}};
const LABELS={bots:'Bots',resources:'Resources',rooms:'Rooms',config:'Config',audit:'Audit',log:'Log'};
async function render(){
  const root=$('#root');
  try{
    const body=await TABS[state.tab]();
    const nav=h('nav',{},Object.keys(TABS).map(t=>h('button',{'aria-current':state.tab===t?'true':null,onclick:()=>{state.tab=t;try{location.hash=t}catch{}render()}},LABELS[t])));
    root.replaceChildren(h('header',{},h('h1',{},'AI bots'),h('span',{class:'dim'},'companion server')),nav,h('main',{},body));
  }catch(e){if(e.message!=='unauthorized')root.replaceChildren(h('p',{class:'bad',style:'padding:16px'},e.message))}
}
function start(){clearInterval(state.timer);const t=(location.hash||'').slice(1);if(TABS[t])state.tab=t;render();state.timer=setInterval(()=>{const a=document.activeElement;if(!document.hidden&&state.tab!=='config'&&!(a&&['SELECT','INPUT'].includes(a.tagName)))render()},3000)}
start();
`;

/**
 * The page. `apiBase` is where its JSON API lives: `/api` on the bot server, `/api/bots` inside a game server.
 * `embedded` is shown in the header: the bots run inside the game server, so there are no threads per bot.
 */
export const dashboardPage = (apiBase: string, embedded = false): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI bots</title><style>${CSS}</style></head><body><div id="root"></div><div id="msg"></div><script>const API=${JSON.stringify(apiBase)};const EMBEDDED=${embedded ? 'true' : 'false'};${SCRIPT}</script></body></html>`;

/** The bot server's page (its API is at /api). */
export const DASHBOARD_PAGE = dashboardPage('/api');
