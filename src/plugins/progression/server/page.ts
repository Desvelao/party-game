// The progression plugin's admin page: a small shell that asks for the admin token (the same one as /admin) and lists
// the players' progress. The page holds no data; every call it makes is authenticated.
export function adminPage(api: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Progression</title>
<style>:root{color-scheme:light dark}body{font:15px system-ui,sans-serif;margin:0;padding:16px;max-width:900px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #8884;text-align:left}code{font-size:12px}button,input{font:inherit;padding:6px 10px}.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.err{color:#c33}.dim{opacity:.7}</style></head>
<body><h1>Progression</h1><div id="root"></div>
<script>
const API=${JSON.stringify(api)};
let token='';try{token=sessionStorage.getItem('pg-admin-token')||''}catch{}
const root=document.getElementById('root');
const el=(t,a,...k)=>{const e=document.createElement(t);for(const[n,v]of Object.entries(a||{}))n==='onclick'?e.onclick=v:e.setAttribute(n,v);for(const c of k)e.append(c);return e};
async function call(path,method){const r=await fetch(API+path,{method:method||'GET',headers:token?{Authorization:'Bearer '+token}:{}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
function login(msg){root.replaceChildren(el('p',{class:'dim'},'Enter the admin token (ADMIN_TOKEN).'),msg?el('p',{class:'err'},msg):'',el('div',{class:'row'},el('input',{id:'tok',type:'password',autocomplete:'off'}),el('button',{onclick:()=>{token=document.getElementById('tok').value.trim();try{sessionStorage.setItem('pg-admin-token',token)}catch{}load()}},'Sign in')))}
async function load(){try{const d=await call('/');
root.replaceChildren(el('p',{class:'dim'},d.total+' players with progress. Open a player in the admin panel with the profile id (npm run admin -- profile <id>).'),
el('table',{},el('tr',{},...['Profile id','Level','XP','Matches','Wins','Best streak','Achievements',''].map(h=>el('th',{},h))),
...d.players.map(p=>el('tr',{},el('td',{},el('code',{},p.id.slice(0,12))),el('td',{},String(p.level)),el('td',{},String(p.xp)),el('td',{},String(p.matches)),el('td',{},String(p.wins)),el('td',{},String(p.bestStreak)),el('td',{},String(p.achievements)),el('td',{},el('button',{onclick:async()=>{if(confirm('Reset this player\\'s progression?')){try{await call('/'+p.id+'/reset','POST');load()}catch(e){alert(e.message)}}}},'Reset'))))))}catch(e){login(/unauthorized|token|401|403/i.test(e.message)?'':e.message)}}
load();
</script></body></html>`;
}
