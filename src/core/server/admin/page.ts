/**
 * The /admin page: one self-contained HTML document that talks to /api/admin/*.
 * Everything that comes from the server (player names, reasons, ...) is inserted with
 * textContent, never as HTML.
 */
const CSS = `
:root{--bg:#1b1033;--panel:#2a1a4d;--line:#ffd23f55;--accent:#ffd23f;--text:#fff;--dim:#ffffffaa;--bad:#ff6b6b;--ok:#6bff9e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:2px solid var(--line);flex-wrap:wrap}
h1{margin:0;color:var(--accent);font-size:20px}
nav{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px}
nav button{background:var(--panel);color:var(--accent);border:2px solid var(--line);border-radius:10px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer}
nav button[aria-current]{background:var(--accent);color:var(--bg)}
main{padding:0 16px 40px;max-width:1000px}
h2{color:var(--accent);font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin:22px 0 8px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
th{color:var(--accent);font-size:13px}
button,input,select{font:inherit}
button.b{background:var(--accent);color:var(--bg);border:0;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer;margin:2px 4px 2px 0}
button.b.bad{background:var(--bad)}
input,select{background:#0006;color:var(--text);border:2px solid var(--line);border-radius:8px;padding:5px 8px;margin:2px 4px 2px 0;max-width:100%}
.pres{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border:2px solid var(--ok);border-radius:999px;color:var(--ok);font-weight:700;font-size:13px}.pres::before{content:'';width:9px;height:9px;border-radius:50%;background:var(--ok)}\n.dim{color:var(--dim)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
.card{background:var(--panel);border:2px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile b{display:block;font-size:22px}.tile span{color:var(--dim);font-size:12px}.tile{cursor:help}
.bar{height:6px;background:#ffffff22;border-radius:3px;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}
svg{width:100%;height:60px;background:#0004;border-radius:8px}
#msg{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--panel);border:2px solid var(--accent);border-radius:10px;padding:8px 14px;display:none;z-index:5}
#login{max-width:420px;margin:60px auto;padding:0 16px}
@media(max-width:600px){th:nth-child(n+4),td:nth-child(n+4){font-size:13px}}
`;

const SCRIPT = String.raw`
const $=(s,r=document)=>r.querySelector(s);
function h(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,v)}for(const c of kids.flat()){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)))}return e}
let token='';try{token=sessionStorage.getItem('pg-admin-token')||''}catch{}
if(typeof location!=='undefined'&&location.hash.startsWith('#token=')){token=decodeURIComponent(location.hash.slice(7));try{sessionStorage.setItem('pg-admin-token',token)}catch{}history.replaceState(null,'',location.pathname)}
const state={tab:'rooms',timer:null,pl:null};
function toast(t,bad){const m=$('#msg');m.textContent=t;m.className=bad?'bad':'ok';m.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>m.style.display='none',3500)}
async function api(path,opt={}){
  const r=await fetch('/api/admin'+path,{method:opt.method||(opt.body?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(opt.body?{'Content-Type':'application/json'}:{})},body:opt.body?JSON.stringify(opt.body):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401||r.status===403){showLogin(d.error);throw new Error(d.error||'unauthorized')}
  if(!r.ok)throw new Error(d.error?(d.errors?d.error+': '+Object.entries(d.errors).map(([k,v])=>k+' '+v).join(', '):d.error):'HTTP '+r.status);
  return d;
}
async function act(fn,okMsg){try{await fn();if(okMsg)toast(okMsg);render()}catch(e){toast(e.message,true)}}
const ago=ts=>{if(!ts)return '-';const s=Math.max(0,(Date.now()-ts)/1000|0);return s<60?s+'s ago':s<3600?(s/60|0)+'m ago':s<86400?(s/3600|0)+'h ago':(s/86400|0)+'d ago'};
const short=id=>id.length>12?id.slice(0,12)+'…':id;
function table(head,rows){return h('table',{},h('thead',{},h('tr',{},head.map(x=>h('th',{},x)))),h('tbody',{},rows.map(r=>h('tr',{},r.map(c=>h('td',{},c))))))}
function btn(label,fn,bad){return h('button',{class:'b'+(bad?' bad':''),onclick:fn},label)}
function ask(q,def){const v=prompt(q,def||'');return v===null?null:v.trim()}

function showLogin(err){
  clearInterval(state.timer);
  const root=$('#root');root.replaceChildren(h('div',{id:'login'},h('h1',{},'Admin'),h('p',{class:'dim'},'Enter the admin token (ADMIN_TOKEN).'),
    err?h('p',{class:'bad'},err):null,
    h('div',{class:'row'},h('input',{type:'password',id:'tok',placeholder:'token',autocomplete:'off'}),btn('Sign in',()=>{token=$('#tok').value.trim();try{sessionStorage.setItem('pg-admin-token',token)}catch{}start()}))));
  $('#tok').addEventListener('keydown',e=>{if(e.key==='Enter')$('#tok').nextSibling.click()});
}

const TABS={
async rooms(){
  const[{rooms},{clients},rep]=await Promise.all([api('/rooms'),api('/clients'),api('/reports').catch(()=>null)]);
  const reports=rep?rep.reports:null;
  const out=[h('div',{class:'row'},h('input',{id:'bc',placeholder:'Message to every room',size:30}),btn('Broadcast',()=>act(()=>api('/broadcast',{body:{message:$('#bc').value}}),'Sent')))];
  if(!rooms.length)out.push(h('p',{class:'dim'},'No rooms right now.'));
  const details=await Promise.all(rooms.map(r=>api('/rooms/'+r.code)));
  rooms.forEach((r,i)=>{
    out.push(h('div',{class:'card'},
      h('div',{class:'row'},h('b',{},r.code),h('span',{class:'dim'},r.game+' · '+r.phase+' · '+r.players+'/'+r.maxPlayers+' players · '+r.spectators+' watching'+(r.locked?' · locked':''))),
      table(['Player','Id','IP','State',''],details[i].members.map(m=>[m.name+(m.host?' ★':''),m.id,m.ip,(m.spectator?'watching':m.connected?(m.ready?'ready':'connected'):'dropped')+(m.profileId?' · signed in':''),
        h('span',{},btn('Rename',()=>act(()=>api('/rooms/'+r.code+'/rename',{body:{id:m.id}}),'Renamed')),btn('Kick',()=>act(()=>api('/rooms/'+r.code+'/kick',{body:{id:m.id}}),'Kicked')),
          btn('Ban',()=>{const reason=ask('Reason (optional)');if(reason===null)return;const mins=ask('Minutes (empty = until lifted)');if(mins===null)return;const useIp=confirm('Also ban the IP address '+m.ip+'?\nOK = ban profile and IP, Cancel = ban only the profile (guests: IP)');
            act(()=>api('/rooms/'+r.code+'/kick',{body:{id:m.id,ban:true,banIp:useIp,reason,minutes:mins?Number(mins):undefined}}),'Banned')},true))])),
      h('div',{class:'row'},btn(r.locked?'Unlock':'Lock',()=>act(()=>api('/rooms/'+r.code+'/lock',{body:{locked:!r.locked}}))),
        btn('Message room',()=>{const t=ask('Message');if(t)act(()=>api('/rooms/'+r.code+'/broadcast',{body:{message:t}}),'Sent')}),
        btn('Close room',()=>{if(confirm('Close room '+r.code+'?'))act(()=>api('/rooms/'+r.code+'/close',{body:{}}),'Closed')},true))));
  });
  if(reports)out.push(h('h2',{},'Player reports ('+reports.length+')'),reports.length?h('div',{},table(['When','Room','Reporter','Reported','Profile',''],reports.map(r=>[ago(r.ts),r.room,r.reporter,r.target,r.targetProfileId?h('span',{title:r.targetProfileId},short(r.targetProfileId)):'guest',
    r.targetProfileId?h('span',{},btn('Ban',()=>{const reason=ask('Reason (optional)');if(reason!==null)act(()=>api('/bans',{body:{profileId:r.targetProfileId,reason}}),'Banned')},true),btn('Hide from leaderboard',()=>act(()=>api('/profiles/'+r.targetProfileId,{method:'PATCH',body:{shadowBanned:true}}),'Hidden'))):''])),
    h('div',{class:'row'},btn('Download CSV',async()=>{try{const res=await fetch('/api/admin/reports?format=csv',{headers:{Authorization:'Bearer '+token}});const a=h('a',{href:URL.createObjectURL(await res.blob()),download:'party-game-reports.csv'});document.body.append(a);a.click();a.remove()}catch(e){toast(e.message,true)}}),btn('Clear',()=>{if(confirm('Clear all reports?'))act(()=>api('/reports',{method:'DELETE'}),'Cleared')},true))):h('p',{class:'dim'},'No reports.'));
  out.push(h('h2',{},'Connections ('+clients.length+')'),table(['Name','Room','IP','Id',''],clients.map(c=>[c.name,c.room||'-',c.ip,c.id,c.banned?h('span',{class:'bad'},'banned'):''])));
  return out;
},
async players(){
  const{bans}=await api('/bans');
  return [h('h2',{},'Add a ban'),h('div',{class:'row'},h('select',{id:'bk'},h('option',{value:'ip'},'IP address'),h('option',{value:'profileId'},'Profile id')),h('input',{id:'bv',placeholder:'value',size:30}),h('input',{id:'br',placeholder:'reason'}),h('input',{id:'bm',placeholder:'minutes',size:8}),
    btn('Ban',()=>{const body={reason:$('#br').value};body[$('#bk').value]=$('#bv').value.trim();if($('#bm').value)body.minutes=Number($('#bm').value);act(()=>api('/bans',{body}),'Banned')},true)),
    h('h2',{},'Bans ('+bans.length+')'),bans.length?table(['Kind','Value','Reason','Since','Expires',''],bans.map(b=>[b.kind,h('span',{title:b.value},short(b.value)),b.reason||'',ago(b.createdAt),b.expiresAt?new Date(b.expiresAt).toLocaleString():'never',
      btn('Lift',()=>act(()=>api('/bans?'+(b.kind==='ip'?'ip':'profileId')+'='+encodeURIComponent(b.value),{method:'DELETE'}),'Lifted'))])):h('p',{class:'dim'},'Nobody is banned.')];
},
async profiles(){
  const q=state.q||'',sort=state.sort||'recent';
  const d=await api('/profiles?limit=50&sort='+sort+'&q='+encodeURIComponent(q));
  return [h('div',{class:'row'},h('input',{id:'pq',placeholder:'name or id prefix',value:q}),
    h('select',{id:'ps'},['recent','created','wins','points','matches','name'].map(s=>h('option',{value:s,selected:s===sort},s))),
    btn('Search',()=>{state.q=$('#pq').value;state.sort=$('#ps').value;render()}),
    btn('Export',async()=>{try{const e=await api('/profiles/export');const a=h('a',{href:URL.createObjectURL(new Blob([JSON.stringify(e,null,2)],{type:'application/json'})),download:'profiles.json'});document.body.append(a);a.click();a.remove()}catch(e){toast(e.message,true)}})),
    h('p',{class:'dim'},d.matched+' of '+d.total+' profiles'),
    table(['Name','Wins','Points','Matches','Last seen',''],d.profiles.map(p=>[p.name+(p.banned?' (banned)':'')+(p.shadowBanned?' (hidden from leaderboard)':''),p.wins,p.points,p.matches,ago(p.lastSeen),
      h('span',{},btn(p.shadowBanned?'Show on leaderboard':'Hide from leaderboard',()=>act(()=>api('/profiles/'+p.id,{method:'PATCH',body:{shadowBanned:!p.shadowBanned}}),p.shadowBanned?'Shown':'Hidden')),btn('Rename',()=>{const n=ask('New name',p.name);if(n)act(()=>api('/profiles/'+p.id,{method:'PATCH',body:{name:n}}),'Renamed')}),
        btn('Reset stats',()=>{if(confirm('Reset stats of '+p.name+'?'))act(()=>api('/profiles/'+p.id+'/reset-stats',{body:{}}),'Reset')}),
        btn('Ban',()=>{const r=ask('Reason (optional)');if(r!==null)act(()=>api('/bans',{body:{profileId:p.id,reason:r}}),'Banned')},true),
        btn('Delete',()=>{if(confirm('Delete the profile of '+p.name+'? This cannot be undone.'))act(()=>api('/profiles/'+p.id,{method:'DELETE'}),'Deleted')},true))]))];
},
async config(){
  const d=await api('/config');
  const rows=Object.keys(d.values).map(k=>{const v=d.values[k];const t=typeof v;return [k,t==='boolean'?h('input',{type:'checkbox',id:'cfg-'+k,checked:v}):t==='string'?h('input',{type:'text',id:'cfg-'+k,value:v,maxlength:d.ranges[k].max,size:32}):h('input',{type:'number',id:'cfg-'+k,value:v,min:d.ranges[k].min,max:d.ranges[k].max,size:8}),t==='boolean'?'on / off':t==='string'?'text, up to '+d.ranges[k].max+' characters':d.ranges[k].min+' – '+d.ranges[k].max,String(d.defaults[k])+(d.overridden.includes(k)?'  (changed)':'')]});
  return [h('p',{class:'dim'},'Changes apply at once. maxPlayersPerRoom applies to rooms created from now on. joinTimeoutMs is in milliseconds. brandName and welcomeMessage are shown in the menu (an empty welcomeMessage uses the built-in, translated tagline); clients pick them up on their next page load.'),
    table(['Setting','Value','Allowed','Configured'],rows),
    h('div',{class:'row'},btn('Apply',()=>{const body={};for(const k of Object.keys(d.values)){const el=$('#cfg-'+k);const t=typeof d.values[k];const v=t==='boolean'?el.checked:t==='string'?el.value:Number(el.value);if(v!==d.values[k])body[k]=v}if(!Object.keys(body).length)return toast('Nothing changed');act(()=>api('/config',{method:'PATCH',body}),'Applied')}),
      btn('Reset all to configured',()=>act(()=>api('/config',{method:'DELETE'}),'Reset'),true)),
    h('h2',{},'Needs a restart'),table(['Setting','Value'],Object.entries(d.restartOnly).map(([k,v])=>[k,String(v)]))];
},
async games(){
  const[d,df]=await Promise.all([api('/catalog'),api('/defaults')]);
  const set=(on,off)=>act(()=>api('/catalog',{method:'PATCH',body:{enable:on,disable:off}}),'Saved');
  const eff=(t,id)=>{const g=df.effective[t];return g&&g[id]!==undefined?g[id]:undefined};
  const range=o=>o.type==='number'?(o.min!==undefined?o.min:'')+' – '+(o.max!==undefined?o.max:'')+(o.step?' step '+o.step:'')+(o.unit?' '+o.unit:''):o.type==='choice'?o.choices.map(c=>c.value).join(' | '):'true | false';
  const field=(t,o)=>{const v=eff(t,o.id);const cur=v===undefined?o.default:v;const k='df-'+t+'-'+o.id;
    if(o.type==='boolean')return h('input',{type:'checkbox',id:k,checked:cur===true});
    if(o.type==='choice')return h('select',{id:k},o.choices.map(c=>h('option',{value:c.value,selected:c.value===cur},c.value)));
    return h('input',{type:'number',id:k,value:cur,min:o.min,max:o.max,step:o.step||'any',size:8})};
  const read=(t,o)=>{const e=$('#df-'+t+'-'+o.id);return o.type==='boolean'?e.checked:o.type==='number'?Number(e.value):e.value};
  const source=(t,id)=>df.admin[t]&&df.admin[t][id]!==undefined?'admin':df.file[t]&&df.file[t][id]!==undefined?'config file':'built-in';
  const optCard=g=>{if(!g.settings.length)return null;
    const rows=g.settings.map(o=>[o.label+' ('+o.id+')',field(g.target,o),range(o),String(o.default),source(g.target,o.id)]);
    return h('div',{class:'card'},
      h('div',{class:'row'},h('b',{},g.name+(g.target===g.game?' (all variants)':'')),h('span',{class:'dim'},g.target)),
      table(['Option','Default','Allowed','Built-in','Source'],rows),
      h('div',{class:'row'},
        btn('Apply',()=>{const body={};for(const o of g.settings){const v=read(g.target,o);const cur=eff(g.target,o.id);if(v!==(cur===undefined?o.default:cur))body[o.id]=v}if(!Object.keys(body).length)return toast('Nothing changed');act(()=>api('/defaults',{method:'PATCH',body:{id:g.target,options:body}}),'Saved')}),
        btn('Reset to config',()=>act(()=>api('/defaults?id='+encodeURIComponent(g.target),{method:'DELETE'}),'Reset'),true)))};
  return [h('p',{class:'dim'},'Disabled games cannot be picked and are skipped in mixed play.'),
    h('p',{class:'dim'},'Defaults hosts start from: admin values win over the configuration file; a variant value wins over its game. Rooms keep any value a host picked explicitly.'),
    ...d.games.map(g=>h('div',{class:'card'},
      h('div',{class:'row'},h('b',{},g.name),h('span',{class:g.enabled?'ok':'bad'},g.enabled?'enabled':'disabled'),btn(g.enabled?'Disable all':'Enable',()=>g.enabled?set([],[g.id]):set([g.id],[]),g.enabled)),
      g.variants.length?h('div',{class:'row'},g.variants.map(v=>btn((v.enabled?'✓ ':'✗ ')+v.name,()=>v.enabled?set([],[v.id]):set([v.id],[]),!v.enabled))):null,
      df.games.filter(x=>x.game===g.id).map(optCard))),
    h('div',{class:'row'},btn('Reset all admin defaults',()=>{if(confirm('Drop every admin default and fall back to the configuration file?'))act(()=>api('/defaults',{method:'DELETE'}),'Reset')},true))];
},
async maintenance(){
  const d=await api('/maintenance');
  const mins=id=>{const v=$(id).value.trim();return v===''?undefined:Math.round(Number(v)*60)};
  const when=a=>{const s=(a.at-Date.now())/1000|0;return s>0?'in '+(s<60?s+'s':s<3600?(s/60|0)+'m':(s/3600|0)+'h'):ago(a.at)};
  const out=[
    h('h2',{},'Maintenance mode'),
    h('div',{class:'card'},
      h('p',{},'Maintenance mode is ',h('b',{class:d.draining?'bad':'ok'},d.draining?'ON':'off'),d.draining&&d.message?': '+d.message:'','. While it is on nobody can create a room; rooms that exist keep working.'),
      h('div',{class:'row'},h('input',{id:'mm',placeholder:'Message for players (optional)',size:30,maxlength:200,value:d.message||''}),
        h('label',{},h('input',{type:'checkbox',id:'mx',checked:d.exitWhenEmpty}),' Shut down when the last room ends'),
        btn('Start maintenance mode',()=>{const x=$('#mx').checked;if(x&&!confirm('The server will shut down when the last room ends and must be restarted. Continue?'))return;act(()=>api('/maintenance',{method:'PUT',body:{draining:true,message:$('#mm').value,exitWhenEmpty:x}}),'Maintenance mode on')},true),
        btn('Stop maintenance mode',()=>act(()=>api('/maintenance',{method:'PUT',body:{draining:false}}),'Maintenance mode off')))),
    h('h2',{},'Announce'),
    h('p',{class:'dim'},'Unlike Broadcast (Rooms tab) this can be delayed or pinned as a banner for everyone, including players who connect later.'),
    h('div',{class:'row'},h('input',{id:'am',placeholder:'Announcement',size:30,maxlength:200}),
      h('input',{id:'ad',type:'number',min:0,step:'any',placeholder:'Send in (minutes)',size:8}),
      h('input',{id:'au',type:'number',min:0,step:'any',placeholder:'Banner stays (minutes)',size:8}),
      h('label',{},h('input',{type:'checkbox',id:'ap'}),' Pin as a banner'),
      btn('Send',()=>{const body={message:$('#am').value,pinned:$('#ap').checked};const i=mins('#ad'),u=mins('#au');if(i!==undefined)body.inSeconds=i;if(u!==undefined)body.durationSeconds=u;act(()=>api('/maintenance/announce',{body}),'Announcement sent')})),
    h('h2',{},'Waiting and pinned announcements')];
  out.push(d.announcements.length?table(['Message','When','Pinned','Status',''],d.announcements.map(a=>[a.message,when(a),a.pinned?'yes':'no',(a.sent?'sent':'waiting')+(a.until?', until '+new Date(a.until).toLocaleString():''),btn('Remove',()=>act(()=>api('/maintenance/announce/'+a.id,{method:'DELETE'}),'Removed'),true)])):h('p',{class:'dim'},'No waiting or pinned announcements.'));
  out.push(h('div',{class:'row'},btn('Clear everything',()=>{if(confirm('Leave maintenance mode and remove every announcement?'))act(()=>api('/maintenance',{method:'DELETE'}),'Cleared')},true)));
  if(d.recent.length)out.push(h('h2',{},'Recently sent'),table(['Message','Sent',''],d.recent.map(r=>[r.message,ago(r.at),btn('Remove',()=>act(()=>api('/maintenance/recent/'+r.id,{method:'DELETE'}),'Removed'),true)])),h('div',{class:'row'},btn('Clear recent',()=>{if(confirm('Remove every recently sent announcement from what players can reread?'))act(()=>api('/maintenance/recent',{method:'DELETE'}),'Cleared')},true)));
  return out;
},
async plugins(){
  const{plugins}=await api('/plugins');
  return plugins.length?[h('p',{class:'dim'},'Installed plugins. A plugin with a page of its own is opened with its link (sign in there with the same admin token).'),
    table(['Plugin','Version','Interface',''],plugins.map(p=>[p.name+' ('+p.id+')',p.version,p.client?'in the lobby':'-',p.http?h('a',{href:'/plugins/'+p.id+'/',target:'_blank',rel:'noopener'},'Open'):'']))]:[h('p',{class:'dim'},'No plugins installed.')];
},
async playlists(){
  const[d,df,pls]=await Promise.all([api('/catalog'),api('/defaults'),api('/playlists')]);
  const eff=(t,id)=>{const g=df.effective[t];return g&&g[id]!==undefined?g[id]:undefined};
  const optsOf=(game,variant)=>{const t=df.games.find(x=>x.target===(variant&&variant!=='all'?variant:game));return t?t.settings:[]};
  const names=Object.fromEntries(d.games.flatMap(g=>[[g.id,g.name]].concat(g.variants.map(v=>[v.id,v.name]))));
  const roundName=r=>(r.variant&&r.variant!=='all'?names[r.variant]:names[r.game])||r.game;
  const draft=()=>state.pl;
  const plRounds=pl=>pl.rounds.map(roundName).join(' → ');
  const newRound=()=>{const g=d.games[0];return{game:g.id,variant:g.variants.length?g.variants[0].id:'all',options:{}}};
  const editor=()=>{const p=draft();const again=()=>render();
    const roundRow=(r,i)=>{const g=d.games.find(x=>x.id===r.game);
      const gs=h('select',{onchange:e=>{const n=d.games.find(x=>x.id===e.target.value);r.game=n.id;r.variant=n.variants.length?n.variants[0].id:'all';r.options={};again()}},d.games.map(x=>h('option',{value:x.id,selected:x.id===r.game},x.name)));
      const vs=g.variants.length?h('select',{onchange:e=>{r.variant=e.target.value;r.options={};again()}},g.variants.map(v=>h('option',{value:v.id,selected:v.id===r.variant},v.name))):null;
      const opts=optsOf(r.game,r.variant);
      const optEls=opts.map(o=>{const cur=r.options[o.id]!==undefined?r.options[o.id]:(eff(r.variant&&r.variant!=='all'?r.variant:r.game,o.id)!==undefined?eff(r.variant&&r.variant!=='all'?r.variant:r.game,o.id):o.default);
        const set=v=>{if(v===o.default||v===eff(r.variant,o.id))delete r.options[o.id];else r.options[o.id]=v};
        let el;
        if(o.type==='boolean')el=h('input',{type:'checkbox',checked:cur===true,onchange:e=>set(e.target.checked)});
        else if(o.type==='choice')el=h('select',{onchange:e=>set(e.target.value)},o.choices.map(c=>h('option',{value:c.value,selected:c.value===cur},c.value)));
        else el=h('input',{type:'number',value:cur,min:o.min,max:o.max,step:o.step||'any',size:6,onchange:e=>set(Number(e.target.value))});
        return h('label',{class:'dim'},o.label+' ',el,' ')});
      return h('div',{class:'card'},
        h('div',{class:'row'},h('b',{},(i+1)+'.'),gs,vs,
          btn('↑',()=>{if(i>0){[p.rounds[i-1],p.rounds[i]]=[p.rounds[i],p.rounds[i-1]];again()}}),
          btn('↓',()=>{if(i<p.rounds.length-1){[p.rounds[i+1],p.rounds[i]]=[p.rounds[i],p.rounds[i+1]];again()}}),
          btn('Remove',()=>{p.rounds.splice(i,1);again()},true)),
        optEls.length?h('details',{},h('summary',{},'Options'+(Object.keys(r.options).length?' ('+Object.keys(r.options).length+' changed)':'')),h('div',{},optEls)):null)};
    return h('div',{class:'card'},
      h('div',{class:'row'},h('b',{},p.isNew?'New playlist':'Edit playlist'),
        h('input',{type:'text',value:p.name,maxlength:24,placeholder:'Name (max 24)',oninput:e=>{p.name=e.target.value}}),
        p.isNew?h('input',{type:'text',value:p.id,maxlength:12,placeholder:'id (a-z, 0-9, - _)',oninput:e=>{p.id=e.target.value}}):h('span',{class:'dim'},p.id)),
      ...p.rounds.map(roundRow),
      h('div',{class:'row'},
        btn('Add round',()=>{if(p.rounds.length<10){p.rounds.push(newRound());again()}else toast('At most 10 rounds',true)}),
        btn('Save',()=>{const id=p.id||p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,12);
          act(async()=>{await api('/playlists/'+encodeURIComponent(id),{method:'PUT',body:{name:p.name,rounds:p.rounds}});state.pl=null},'Saved')}),
        btn('Cancel',()=>{state.pl=null;again()},true)))};
  const plSection=[h('h2',{},'Playlists'),
    h('p',{class:'dim'},'Ready-made playlists hosts can load in the playlist builder. Config file playlists can be replaced or hidden here; Restore brings the file version back. Rooms that already loaded one are not changed.'),
    pls.playlists.length?table(['Name','Id','Rounds','Source',''],pls.playlists.map(r=>[r.playlist.name+(r.hidden?' (hidden)':''),r.playlist.id,plRounds(r.playlist),r.source,
      h('span',{},
        r.hidden?null:btn('Edit',()=>{state.pl={id:r.playlist.id,name:r.playlist.name,rounds:JSON.parse(JSON.stringify(r.playlist.rounds)),isNew:false};render()}),
        r.hidden?null:btn('Delete',()=>{if(confirm('Delete "'+r.playlist.name+'"?'))act(()=>api('/playlists/'+encodeURIComponent(r.playlist.id),{method:'DELETE'}),'Deleted')},true),
        r.source==='admin'&&r.fileVersion?btn('Restore',()=>act(()=>api('/playlists/'+encodeURIComponent(r.playlist.id)+'/restore',{body:{}}),'Restored')):null)])):h('p',{class:'dim'},'No playlists yet.'),
    state.pl?editor():h('div',{class:'row'},btn('New playlist',()=>{state.pl={id:'',name:'',rounds:[newRound()],isNew:true};render()}))];
  return plSection;
},
async history(){
  const[m,lb,pop]=await Promise.all([api('/matches?limit=30').catch(()=>null),api('/leaderboard?limit=10'),api('/popularity')]);
  if(!m)return [h('p',{class:'dim'},'Match history is turned off on this server (ADMIN_INSIGHTS).'),h('h2',{},'Leaderboard (signed-in players)'),table(['#','Name','Wins','Points','Matches'],lb.leaders.map((l,i)=>[i+1,l.name,l.wins,l.points,l.played])),h('h2',{},'Most played rounds'),table(['Game','Rounds played'],pop.games.slice(0,12).map(g=>[g.name,g.played]))];
  return [h('h2',{},'Recent matches ('+m.total+' kept)'),m.matches.length?table(['When','Room','Rounds','Result','Length'],m.matches.map(x=>[ago(x.ts),x.room,x.games.map(g=>g.name).join(', '),x.ranking.map((r,i)=>(i+1)+'. '+r.name+' ('+r.score+')').join('  '),Math.round(x.durationSec/60*10)/10+' min'])):h('p',{class:'dim'},'No finished matches yet.'),
    h('h2',{},'Leaderboard (signed-in players)'),table(['#','Name','Wins','Points','Matches'],lb.leaders.map((l,i)=>[i+1,l.name,l.wins,l.points,l.played])),
    h('h2',{},'Most played rounds'),table(['Game','Rounds played'],pop.games.slice(0,12).map(g=>[g.name,g.played]))];
},
async health(){
  const t0=Date.now();
  const[s,m0]=await Promise.all([api('/status'),api('/metrics').catch(()=>null)]);
  const m=m0||{points:[]};
  const ping=Date.now()-t0;
  state.pings=(state.pings||[]).concat(ping).slice(-20);
  const pings=state.pings,avg=pings.reduce((a,b)=>a+b,0)/pings.length;
  const sys=s.system,l=s.loop||{},n=s.net||{};
  const TIPS={'Ping':'Round-trip time of the last admin request. Lower is better; above ~100 ms gameplay may feel laggy.','Average':'Mean ping over the last 20 refreshes.','Min / max':'Best and worst ping over the last 20 refreshes. A large gap means an unstable connection.','CPU':'Share of total host CPU time in use across all cores.','RAM':'Host memory in use (including this server) out of the total installed.','Load (1/5/15m)':'Processes waiting for CPU over 1, 5 and 15 minutes. Sustained values above the core count mean the host is overloaded.','Cores':'Logical CPU cores on the host.','Temperature':'Host CPU temperature. Small boards throttle when this gets too high.','Host uptime':'Time since the host machine booted.','Platform':'Operating system and CPU architecture of the host.','Process CPU':'CPU used by the game server process alone since the last stats reset; 100% is one full core.','Process RSS':'Physical memory held by the game server process.','Heap':'JavaScript heap memory in use by the game server.','Uptime':'Time since the game server process started.','Rooms':'Active rooms out of the maximum the server allows.','Clients':'Connected websocket clients (players and spectators).','Profile':'Server performance profile selected through configuration.','Tick / net rate':'Game simulation ticks per second / state updates sent to clients per second.','Node':'Node.js runtime version.','Tick overruns':'Ticks that took longer than their time budget. Should stay near zero.','Avg tick':'Average time spent computing one tick. Must stay well below the tick interval.'};
  const dur=x=>{const d=Math.floor(x/86400),hh=Math.floor(x%86400/3600),mm=Math.floor(x%3600/60);return (d?d+'d ':'')+hh+'h '+mm+'m'};
  const tile=(l,v,pct)=>h('div',{class:'card tile',title:TIPS[l]||l},h('span',{},l),h('b',{},v),pct==null?null:h('div',{class:'bar'},h('i',{style:'width:'+Math.min(100,pct)+'%'})));
  const sect=(t,...tiles)=>[h('h2',{},t),h('div',{class:'grid'},...tiles)];
  const r1=x=>Math.round(x*100)/100;
  const spark=(label,key,unit)=>{const pts=m.points.map(p=>p[key]);const max=Math.max(1,...pts);const W=300,H=60;
    const path=pts.map((v,i)=>(i?'L':'M')+(pts.length>1?i/(pts.length-1)*W:0).toFixed(1)+' '+(H-4-(v/max)*(H-8)).toFixed(1)).join(' ');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('preserveAspectRatio','none');
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',path);p.setAttribute('fill','none');p.setAttribute('stroke','#ffd23f');p.setAttribute('stroke-width','2');svg.append(p);
    return h('div',{class:'card'},h('div',{class:'row'},h('b',{},label),h('span',{class:'dim'},'now '+(pts.length?pts[pts.length-1]:'-')+unit+' · peak '+max+unit)),svg)};
  return [...sect('Latency',tile('Ping',ping.toFixed(0)+' ms'),tile('Average',avg.toFixed(0)+' ms'),tile('Min / max',Math.min(...pings).toFixed(0)+' / '+Math.max(...pings).toFixed(0)+' ms')),
    ...sect('Host',tile('CPU',sys.cpuPercent+'%',sys.cpuPercent),tile('RAM',sys.memUsedMB.toFixed(0)+' / '+sys.memTotalMB.toFixed(0)+' MB',sys.memUsedMB/sys.memTotalMB*100),tile('Load (1/5/15m)',sys.loadavg.join(' / ')),tile('Cores',sys.cpuCount),sys.temperatureC==null?null:tile('Temperature',sys.temperatureC+' °C',sys.temperatureC),tile('Host uptime',dur(sys.hostUptimeSec)),tile('Platform',sys.platform)),
    ...sect('Game server',tile('Process CPU',s.cpuPercent+'%',s.cpuPercent),tile('Process RSS',s.rssMB+' MB'),tile('Heap',s.heapMB+' MB'),tile('Uptime',dur(sys.processUptimeSec)),tile('Rooms',s.rooms+' / '+s.maxRooms),tile('Clients',s.clients),tile('Profile',s.profile),tile('Tick / net rate',s.tickRate+' / '+s.networkRate+' Hz'),tile('Node',sys.node),tile('Tick overruns',l.overruns),tile('Avg tick',r1(l.avgStepMs)+' ms')),
    ...sect('Loop & network',...Object.entries(l).map(([k,v])=>tile('loop.'+k,typeof v==='number'?r1(v):v)),...Object.entries(n).map(([k,v])=>tile(k,v))),
    ...(m0?[h('h2',{},'Last 10 minutes'),h('div',{class:'grid'},spark('Process CPU','procCpu','%'),spark('Host memory','memPct','%'),spark('Load (1m)','load1',''),spark('Clients','clients',''),spark('Avg tick time','avgStepMs',' ms'),spark('Overruns','overruns',''))]:[])];
},
async console(){
  let d;try{d=await api('/console')}catch(e){return [h('p',{class:'dim'},'Console mode is off. Set CONSOLE_MODE=1 (server.consoleMode) and restart to let a TV own a room and phones pair with its PIN.')]}
  return [h('h2',{},'Console'),
    h('div',{class:'card'},
      h('p',{},'The TV shows this PIN. A phone that types it becomes the host of the TV room and can use this admin page.'),
      h('p',{},'PIN ',h('b',{},d.pin),' · room ',h('b',{},d.roomCode||'(the TV has not opened one)'),' · paired phones ',h('b',{},String(d.paired))),
      h('div',{class:'row'},
        btn('New PIN',()=>act(()=>api('/console/pin',{method:'POST'}),'New PIN')),
        btn('Unpair all phones',()=>{if(confirm('Every paired phone loses its host and admin access. Continue?'))act(()=>api('/console/unpair',{method:'POST'}),'Unpaired')},true)))];
},
async audit(){
  const{entries}=await api('/audit?limit=200');
  return entries.length?[h('div',{class:'row'},btn('Download CSV',async()=>{try{const res=await fetch('/api/admin/audit?format=csv&limit=500',{headers:{Authorization:'Bearer '+token}});const a=h('a',{href:URL.createObjectURL(await res.blob()),download:'party-game-audit.csv'});document.body.append(a);a.click();a.remove()}catch(e){toast(e.message,true)}})),table(['When','Action','Target','From','Detail'],entries.map(e=>[ago(e.ts),e.action,e.target||'',e.ip,e.detail?JSON.stringify(e.detail):'']))]:[h('p',{class:'dim'},'Nothing yet.')];
}};
const LABELS={rooms:'Rooms',maintenance:'Maintenance',players:'Bans',profiles:'Profiles',config:'Config',games:'Games',plugins:'Plugins',playlists:'Playlists',history:'History',health:'Health',console:'Console',audit:'Audit'};

async function render(){
  const main=$('#main');if(!main)return;
  api('/stats').then(d=>{const p=$('#pres');if(p)p.textContent=d.clients+' online'}).catch(()=>{});
  try{const kids=await TABS[state.tab]();
    // do not wipe what the operator is typing during an auto-refresh
    const busy=document.activeElement&&main.contains(document.activeElement)&&/INPUT|SELECT/.test(document.activeElement.tagName);
    if(busy&&state.auto)return;
    main.replaceChildren(...kids)}catch(e){if(!/unauthorized|token/.test(e.message))main.replaceChildren(h('p',{class:'bad'},e.message))}
  state.auto=false;
}
async function start(){
  let who;try{who=await api('/whoami')}catch{return}
  const root=$('#root');
  const nav=h('nav',{},Object.entries(LABELS).map(([k,v])=>h('button',{'data-tab':k,'aria-current':k===state.tab?'page':false,onclick:()=>{state.tab=k;nav.querySelectorAll('button').forEach(b=>{b.toggleAttribute('aria-current',b.dataset.tab===k)});render()}},v)));
  root.replaceChildren(h('header',{},h('h1',{},'Party game admin'),h('span',{class:'pres',id:'pres'},'…'),who.version?h('span',{class:'dim',id:'ver'},'v'+who.version):null,h('a',{href:'/status',class:'dim'},'Status'),h('a',{href:'/rooms',class:'dim'},'Public rooms'),btn('Sign out',()=>{token='';try{sessionStorage.removeItem('pg-admin-token')}catch{}showLogin()})),nav,h('main',{id:'main'}));
  render();
  clearInterval(state.timer);state.timer=setInterval(()=>{if(['rooms','maintenance','health','history'].includes(state.tab)&&!document.hidden){state.auto=true;render()}},3000);
}
start();
`;

export const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Party game admin</title><style>${CSS}</style></head><body><div id="root"></div><div id="msg" role="status"></div><script>${SCRIPT}</script></body></html>`;
