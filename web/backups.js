const invoke=window.__TAURI__?.core?.invoke;
const $=s=>document.querySelector(s);
const fmtDate=seconds=>new Date(seconds*1000).toLocaleString();
const short=sha=>(sha||"").slice(0,8);
function toast(msg,error=false){const t=$("#toast");t.textContent=msg;t.className="toast show"+(error?" error":"");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className="toast",2800)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function renderChange(line){const m=String(line).match(/^([A-Z?]+)\s+(.+)$/);return m?`<span class="change"><b>${esc(m[1])}</b>${esc(m[2])}</span>`:`<span class="change">${esc(line)}</span>`}
async function load(){
 try{
  const backups=await invoke("list_backups");
  $("#empty").classList.toggle("hidden",backups.length>0);
  $("#list").innerHTML=backups.map((b,i)=>`
   <article class="version ${i===0?"latest":""}">
    <div class="ver">${esc(b.version)}${i===0?'<small>LATEST</small>':""}</div>
    <div class="meta">
      <h2>${esc(b.title||"Project snapshot")}</h2>
      <div class="summary">${esc(b.summary||"No description")}</div>
      <div class="info">
       <span class="chip">${esc(fmtDate(b.createdAt))}</span>
       <span class="chip">HEAD ${esc(short(b.sourceHead))}</span>
       <span class="chip">SNAP ${esc(short(b.snapshotSha))}</span>
       <span class="chip">${b.automatic?"AUTO":"MANUAL"}</span>
      </div>
      <div class="changes">${(b.changes?.length?b.changes:["No file changes from previous version"]).slice(0,30).map(renderChange).join("")}</div>
      ${b.commits?.length?`<div class="commits">Commits: ${b.commits.map(esc).join(" · ")}</div>`:""}
    </div>
    <button class="restore" data-version="${esc(b.version)}">Restore ${esc(b.version)}</button>
   </article>`).join("");
  document.querySelectorAll(".restore").forEach(btn=>btn.onclick=()=>restore(btn.dataset.version));
 }catch(e){toast(String(e),true)}
}
async function create(){
 const note=$("#backupNote").value.trim();
 $("#createBtn").disabled=true;
 try{
  const b=await invoke("create_backup",{title:"Manual checkpoint",summary:note||"Manual project snapshot"});
  $("#backupNote").value="";
  toast("Created "+b.version);
  await load();
 }catch(e){toast(String(e),true)}
 finally{$("#createBtn").disabled=false}
}
async function restore(version){
 if(!confirm(`Restore ${version}? RoFlow will create a safety backup of the current state first.`))return;
 document.querySelectorAll("button").forEach(b=>b.disabled=true);
 try{
  const r=await invoke("restore_backup",{version});
  toast(`Restored ${r.restoredVersion} · safety copy ${r.safetyVersion} created`);
  await load();
 }catch(e){toast(String(e),true)}
 finally{document.querySelectorAll("button").forEach(b=>b.disabled=false)}
}
$("#createBtn").onclick=create;
$("#backupNote").addEventListener("keydown",e=>{if(e.key==="Enter")create()});
load();
