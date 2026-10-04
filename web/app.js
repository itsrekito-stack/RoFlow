const invoke=window.__TAURI__?.core?.invoke;
const dialog=window.__TAURI__?.dialog;
const $=selector=>document.querySelector(selector);
const state={
 status:null,
 root:localStorage.getItem("roflowStandaloneProjectRootV1")||"",
 projectId:"",
 displayName:"",
 buildFileName:"",
 runtimeProbeEnabled:false,
 releaseGateTaskIds:[],
 studioLoaded:false,
 currentPage:"dashboard",
 studioUnloadTimer:null,
 selectedFile:"",
 logs:["RoFlow started."],
 tasks:[],
 health:null,
 rojo:null,
 planner:null,
 plannerShowCompleted:true,
 runtimeGate:null,
 updateChecked:false,
 updateLastChecked:0,
 updateLastBuild:"",
 updateChecking:false,
 updateInstalling:false
};

const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
const shortSha=sha=>(sha||"").slice(0,8)||"—";
const fmtTime=seconds=>seconds?new Date(seconds*1000).toLocaleString():"—";

function log(message){
 const time=new Date().toLocaleTimeString();
 state.logs.push(`[${time}] ${message}`);
 if(state.logs.length>120)state.logs.splice(0,state.logs.length-120);
 const out=$("#logOutput");
 if(out){out.textContent=state.logs.join("\n");out.scrollTop=out.scrollHeight}
}

function requireProject(){
 if(!state.root)throw new Error("Choose a project first");
}

function projectUiStorageKey(projectId){
 return "roflowStandaloneProjectUiV1:"+String(projectId||"").trim();
}
function saveProjectUiState(){
 if(!state.projectId)return;
 localStorage.setItem(projectUiStorageKey(state.projectId),JSON.stringify({
  currentPage:state.currentPage||"dashboard",
  selectedFile:state.selectedFile||"",
  plannerShowCompleted:state.plannerShowCompleted!==false
 }));
}
function loadProjectUiState(projectId){
 let saved=null;
 try{saved=JSON.parse(localStorage.getItem(projectUiStorageKey(projectId))||"null")}catch{}
 state.currentPage=typeof saved?.currentPage==="string"?saved.currentPage:"dashboard";
 state.selectedFile=typeof saved?.selectedFile==="string"?saved.selectedFile:"";
 state.plannerShowCompleted=typeof saved?.plannerShowCompleted==="boolean"?saved.plannerShowCompleted:true;
}
function clearProjectDom(){
 state.tasks=[];
 state.health=null;
 state.rojo=null;
 state.planner=null;
 state.runtimeGate=null;
 state.selectedFile="";
 state.logs=["Project context: "+(state.displayName||"Project")];

 if($("#logOutput"))$("#logOutput").textContent=state.logs[0];
 if($("#recentTasks"))renderTasks([]);
 if($("#todayTaskList")){
  const empty={todayDate:localPlannerDate(),today:[],roadmap:[]};
  renderPlanner(empty);
  state.planner=null;
 }

 if($("#fileList"))$("#fileList").innerHTML='<div class="empty-state">Load Changes for this project.</div>';
 if($("#diffTitle"))$("#diffTitle").textContent="No file selected";
 if($("#diffMeta"))$("#diffMeta").textContent="PROJECT";
 if($("#diffOutput"))$("#diffOutput").innerHTML='<div class="empty-state">No diff loaded for this project.</div>';
 if($("#commitMessage"))$("#commitMessage").value="";

 if($("#syncOutput"))$("#syncOutput").textContent="Ready for project-scoped AI Sync.";
 if($("#cycleOutput"))$("#cycleOutput").textContent="";
 if($("#cycleTitle"))$("#cycleTitle").textContent="DEV CYCLE";
 if($("#rojoOutput"))$("#rojoOutput").textContent="";
 if($("#rojoPageState"))$("#rojoPageState").textContent="Project changed · refresh Rojo status";
 if($("#rojoPageDetail"))$("#rojoPageDetail").textContent="";

 if($("#backupValue"))$("#backupValue").textContent="—";
 if($("#backupStats"))$("#backupStats").textContent="Loading this project's checkpoints…";
 if($("#backupNavVersion"))$("#backupNavVersion").textContent="—";

 if($("#healthValue")){$("#healthValue").textContent="—";$("#healthValue").style.color=""}
 if($("#healthStats"))$("#healthStats").textContent="Run Health Check for this project.";
 if($("#healthList"))$("#healthList").innerHTML='<div class="empty-state">No health result for this project yet.</div>';
 if($("#runtimeMilestones"))$("#runtimeMilestones").textContent="—";
 if($("#runtimeEvidence"))$("#runtimeEvidence").textContent="No runtime evidence loaded for this project.";
 if($("#runtimeServerCheckpoint"))$("#runtimeServerCheckpoint").textContent="—";
 if($("#runtimeClientCheckpoint"))$("#runtimeClientCheckpoint").textContent="—";
 if($("#runtimePersistence"))$("#runtimePersistence").textContent="—";
 if($("#runtimeProbeMeta"))$("#runtimeProbeMeta").textContent="Project context changed.";
 if($("#runtimeProbeOutput"))$("#runtimeProbeOutput").textContent="No runtime evidence loaded.";
}

function updateBadge(text,tone="muted"){
 const badge=$("#updateBadge");if(!badge)return;
 badge.textContent=text;
 badge.className="pill "+(tone==="ready"?"":"muted-pill");
 if(tone==="ready")badge.style.color="#66e0a6";
 else if(tone==="warn")badge.style.color="#ffbe40";
 else badge.style.color="";
}

async function maybeAutoUpdate(force=false){
 if(!state.root||state.updateChecking||state.updateInstalling)return;
 const now=Date.now();
 if(!force&&state.updateLastChecked&&now-state.updateLastChecked<60000)return;
 state.updateChecking=true;
 updateBadge("CHECKING UPDATE");
 try{
  const info=await invoke("roflow_update_status");
  state.updateChecked=true;
  state.updateLastChecked=Date.now();
  if(!info.available){
   updateBadge("AUTO UPDATE ON","ready");
   if(state.updateLastBuild!==info.currentBuild){
    log("RoFlow auto update: current build "+shortSha(info.currentBuild));
    state.updateLastBuild=info.currentBuild;
   }
   return;
  }
  state.updateInstalling=true;
  updateBadge("UPDATING "+(info.latestVersion||""),"warn");
  log("RoFlow update found: "+shortSha(info.currentBuild)+" → "+shortSha(info.latestBuild)+". Installing automatically…");
  await invoke("roflow_install_update");
 }catch(error){
  state.updateChecked=false;
  state.updateLastChecked=Date.now();
  updateBadge("AUTO UPDATE RETRY");
  log("RoFlow auto update check skipped: "+error);
 }finally{
  state.updateChecking=false;
 }
}

function applyStatus(status){
 state.status=status;
 state.projectId=status.projectId||state.projectId||"";
 state.displayName=status.displayName||(status.root||"").split(/[\\/]/).filter(Boolean).pop()||"Project";
 state.buildFileName=status.buildFile||state.buildFileName||"Project.rbxl";
 state.runtimeProbeEnabled=status.runtimeProbeEnabled===true;
 state.releaseGateTaskIds=Array.isArray(status.releaseGateTaskIds)?status.releaseGateTaskIds:[];
 $("#projectName").textContent=state.displayName;
 $("#projectPath").textContent=status.root||"";
 $("#branchValue").textContent=status.branch||"(detached)";
 $("#commitValue").textContent=shortSha(status.head)+" · "+(status.subject||"");
 $("#dirtyValue").textContent=status.dirty?"LOCAL CHANGES":"CLEAN";
 $("#dirtyValue").style.color=status.dirty?"#ffbe40":"#66e0a6";
 $("#changeCount").textContent=status.dirty?`${status.changes.length} changed path(s)`:"Working tree clean";
 $("#changesBadge").textContent=String(status.changes.length||0);
 $("#sideStatus").textContent=(status.branch||"git")+" · "+shortSha(status.head);
 $(".dot").classList.add("ready");
}


function localPlannerDate(){
 const now=new Date();
 const pad=value=>String(value).padStart(2,"0");
 return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}
function plannerCounts(tasks){
 const total=tasks?.length||0;
 const done=(tasks||[]).filter(task=>task.done).length;
 return {done,total,percent:total?Math.round(done/total*100):0};
}
function plannerTaskMarkup(task,compact=false){
 return `<label class="planner-task ${task.done?"done":""} ${compact?"compact":""}">
  <input type="checkbox" data-planner-task="${escapeHtml(task.id)}" ${task.done?"checked":""}>
  <span class="planner-check"></span>
  <span class="planner-copy"><strong>${escapeHtml(task.title)}</strong>${compact?"":`<small>${escapeHtml(task.detail||"")}</small>`}</span>
 </label>`;
}
function groupedPlannerMarkup(tasks){
 const all=tasks||[];
 const visible=state.plannerShowCompleted?all:all.filter(task=>!task.done);
 const groups=[];const byGroup=new Map();
 for(const task of visible){if(!byGroup.has(task.group)){byGroup.set(task.group,[]);groups.push(task.group)}byGroup.get(task.group).push(task)}
 groups.sort((a,b)=>{
  const ag=/^\[.+\]$/.test(a),bg=/^\[.+\]$/.test(b);
  if(ag!==bg)return ag?-1:1;
  return 0;
 });
 return groups.map(group=>{
  const list=byGroup.get(group),counts=plannerCounts(all.filter(task=>task.group===group));
  const goal=/^\[.+\]$/.test(group);
  return `<section class="planner-group ${goal?"planner-goal":""}">
   <div class="planner-group-head">
    <div class="planner-group-title"><strong>${escapeHtml(group)}</strong><small>${goal?`${counts.percent}% completed · ${counts.done}/${counts.total} stages`:`${counts.done}/${counts.total} tasks`}</small></div>
    <span class="planner-group-percent">${counts.percent}%</span>
   </div>
   <div class="planner-group-meter" aria-hidden="true"><span style="width:${counts.percent}%"></span></div>
   <div class="planner-group-tasks">${list.map(task=>plannerTaskMarkup(task)).join("")}</div>
  </section>`;
 }).join("");
}
function bindPlannerCheckboxes(){
 document.querySelectorAll("[data-planner-task]").forEach(input=>{
  input.onchange=async()=>{
   const id=input.dataset.plannerTask,done=input.checked;input.disabled=true;
   try{renderPlanner(await invoke("planner_set_done",{taskId:id,done}));log((done?"Completed: ":"Reopened: ")+id)}
   catch(error){input.checked=!done;log("Planner update failed: "+error)}
   finally{input.disabled=false}
  };
 });
}
function renderPlanner(planner){
 state.planner=planner;
 renderReleaseGate();
 const today=plannerCounts(planner.today),release=plannerCounts(planner.roadmap);
 $("#plannerDate").textContent=planner.todayDate||localPlannerDate();
 $("#plannerBadge").textContent=`${today.done}/${today.total}`;
 $("#todayProgressText").textContent=`${today.done} / ${today.total}`;$("#todayPercent").textContent=today.percent+"%";$("#todayProgressBar").style.width=today.percent+"%";
 $("#releaseProgressText").textContent=`${release.done} / ${release.total}`;$("#releasePercent").textContent=release.percent+"%";$("#releaseProgressBar").style.width=release.percent+"%";
 const completedToggle=$("#plannerCompletedToggle");
 if(completedToggle){
  completedToggle.textContent=state.plannerShowCompleted?"Hide completed":"Show completed";
  completedToggle.setAttribute("aria-pressed",state.plannerShowCompleted?"true":"false");
  completedToggle.classList.toggle("active",!state.plannerShowCompleted);
 }
 $("#todayTaskList").innerHTML=groupedPlannerMarkup(planner.today)||(state.plannerShowCompleted?'<div class="empty-state">No tasks for today.</div>':'<div class="empty-state">No open tasks. Completed tasks are hidden.</div>');
 $("#roadmapTaskList").innerHTML=groupedPlannerMarkup(planner.roadmap)||(state.plannerShowCompleted?'<div class="empty-state">Roadmap is empty.</div>':'<div class="empty-state">No open roadmap tasks. Completed tasks are hidden.</div>');
 $("#todayPreviewTitle").textContent="Today’s Focus · "+(planner.todayDate||"");
 $("#todayPreviewCount").textContent=`${today.done}/${today.total}`;
 const preview=[...(planner.today||[]).filter(task=>!task.done),...(planner.today||[]).filter(task=>task.done)].slice(0,5);
 $("#todayPreview").innerHTML=preview.length?preview.map(task=>plannerTaskMarkup(task,true)).join(""):'<div class="empty-state">Today is complete.</div>';
 bindPlannerCheckboxes();
}
async function refreshPlanner(){
 if(!state.root)return;
 try{renderPlanner(await invoke("planner_state",{date:localPlannerDate()}))}
 catch(error){log("Planner failed: "+error)}
}

async function refreshBackups(){
 if(!state.root)return;
 try{
  const backups=await invoke("list_backups");
  const latest=backups?.[0];
  $("#backupValue").textContent=latest?.version||"NONE";
  $("#backupValue").style.color=latest?"#58b1ff":"";
  $("#backupStats").textContent=backups?.length?`${backups.length} checkpoint(s) · ${latest.title||"snapshot"}`:"Create a checkpoint before risky work.";
  $("#backupNavVersion").textContent=latest?.version||"—";
 }catch(error){
  $("#backupValue").textContent="ERROR";
  $("#backupValue").style.color="#ff697b";
  $("#backupStats").textContent=String(error);
  $("#backupNavVersion").textContent="!";
  log("Backup status failed: "+error);
 }
}

function renderTasks(tasks){
 state.tasks=tasks||[];
 const render=task=>`
  <div class="activity">
   <span class="activity-kind">${escapeHtml((task.kind||"TASK").toUpperCase())}</span>
   <div><strong>${escapeHtml(task.title||"Task")}</strong><small>${escapeHtml(task.summary||"")}</small></div>
   <time>${escapeHtml(fmtTime(task.createdAt))}</time>
  </div>`;
 $("#recentTasks").innerHTML=state.tasks.length?state.tasks.slice(0,5).map(render).join(""):'<div class="empty-state">No task history yet.</div>';
 $("#taskList").innerHTML=state.tasks.length?state.tasks.map(task=>`
  <article class="task-row">
   <span class="task-kind">${escapeHtml((task.kind||"TASK").toUpperCase())}</span>
   <div>
    <strong>${escapeHtml(task.title||"Task")}</strong>
    <small>${escapeHtml(task.summary||"")}</small>
    <div class="task-files">${escapeHtml((task.changedFiles||[]).slice(0,8).join(" · ")||"No file list recorded")}</div>
   </div>
   <div class="task-meta">${escapeHtml(fmtTime(task.createdAt))}<br>${escapeHtml(shortSha(task.headBefore))} → ${escapeHtml(shortSha(task.headAfter))}<br>${escapeHtml(task.backupVersion||"no backup")}</div>
  </article>`).join(""):'<div class="empty-state">No recorded AI/Git tasks yet.</div>';
}

async function refreshTasks(){
 if(!state.root)return;
 try{renderTasks(await invoke("list_tasks"))}catch(error){log("Task history failed: "+error)}
}

function renderHealth(report){
 state.health=report;
 $("#healthValue").textContent=`${report.passed}/${report.total} PASS`;
 $("#healthValue").style.color=report.passed===report.total?"#66e0a6":"#ffbe40";
 $("#healthStats").textContent=report.passed===report.total?"Project checks passed":"Review failing checks below";
 const pill=$("#healthPill");
 pill.textContent=`${report.passed}/${report.total}`;
 pill.className="pill "+(report.passed===report.total?"":"muted-pill");
 $("#healthList").innerHTML=report.checks.map(check=>`
  <div class="health-item ${check.ok?"ok":"bad"}">
   <span class="health-icon">${check.ok?"✓":"!"}</span>
   <div><b>${escapeHtml(check.name)}</b><span>${escapeHtml(check.detail)}</span></div>
  </div>`).join("");
}

async function runHealth(){
 requireProject();
 const report=await invoke("health_check");
 renderHealth(report);
 log(`Health check: ${report.passed}/${report.total} passed`);
 return report;
}

function applyRojo(status){
 state.rojo=status;
 state.buildFileName=status.buildFileName||state.status?.buildFile||state.buildFileName||"Project.rbxl";
 const serving=Boolean(status.running&&status.ready);
 const unavailable=Boolean(status.running&&!status.ready);
 $("#rojoBuildFile").textContent=state.buildFileName;
 $("#rojoValue").textContent=serving?"RUNNING":unavailable?"NO PORT":status.available?"READY":"NOT FOUND";
 $("#rojoValue").style.color=serving?"#66e0a6":unavailable?"#ffbe40":status.available?"#58b1ff":"#ff697b";
 $("#rojoStats").textContent=status.available?(status.version||status.path||"Rojo available"):"Install Rojo or place rojo.exe in the project/Desktop/Rojo.";
 $("#rojoPageState").textContent=serving?"Rojo server is listening":unavailable?"Rojo process running, but port 34872 is closed":status.available?"Rojo is ready":"Rojo not found";
 $("#rojoPageState").style.color=serving?"#66e0a6":unavailable?"#ffbe40":status.available?"#58b1ff":"#ff697b";
 const info=status.available?((status.version||status.path)+(status.projectFile?" · project config ready":" · default.project.json missing")):"RoFlow checked project folder, Desktop\\Rojo and PATH.";
 $("#rojoPageDetail").textContent=info+(serving?" · localhost:34872 reachable":unavailable?" · localhost:34872 unreachable; see Output":"");
 if(unavailable&&status.diagnostic)$("#rojoOutput").textContent="Rojo startup output:\n"+status.diagnostic;
 $("#startRojoBtn").disabled=!status.available||status.running||!status.projectFile;
 $("#stopRojoBtn").disabled=!status.running;
 $("#buildBtn").disabled=!status.available||!status.projectFile;
 $("#openStudioBtn").disabled=!status.buildFile;
}

async function refreshRojo(){
 if(!state.root)return;
 try{applyRojo(await invoke("rojo_status"))}catch(error){log("Rojo status failed: "+error)}
}

function checkpointLabel(line){
 const match=String(line||"").match(/CHECKPOINT_(\d+)m/);
 return match?match[1]+" min":"—";
}
function setQaEvidence(selector,ready,label,detail=""){
 const node=$(selector);if(!node)return;
 node.classList.toggle("ready",ready);
 node.textContent=label+" · "+(ready?"EVIDENCE READY":detail||"WAITING");
}
function renderReleaseGate(){
 const gate=$("#releaseGate"),stateNode=$("#releaseGateState"),detail=$("#releaseGateDetail"),bar=$("#releaseGateBar");
 const manualIds=state.releaseGateTaskIds||[];
 if(!state.runtimeProbeEnabled&&manualIds.length===0){
  if(gate)gate.classList.remove("ready");
  if(stateNode)stateNode.textContent="PROJECT-SCOPED";
  if(detail)detail.textContent="No release gate is configured for this project.";
  if(bar)bar.style.width="0%";
  return;
 }
 const runtime=state.runtimeGate||{};
 const runtimeChecks=state.runtimeProbeEnabled?[
  runtime.coreReady===true,
  runtime.persistenceReady===true,
  runtime.baselineReady===true,
  runtime.onboardingReady===true,
  runtime.multiplayerReady===true,
  runtime.soakReady===true
 ]:[];
 const runtimeDone=runtimeChecks.filter(Boolean).length;
 const roadmap=state.planner?.roadmap||[];
 const byId=new Map(roadmap.map(task=>[task.id,task]));
 const manualTasks=manualIds.map(id=>byId.get(id)).filter(Boolean);
 const manualDone=manualTasks.filter(task=>task.done===true).length;
 const manualReady=manualIds.length===0||(manualTasks.length===manualIds.length&&manualDone===manualIds.length);
 const runtimeReady=runtimeChecks.length===0||runtimeDone===runtimeChecks.length;
 const ready=runtimeReady&&manualReady;
 const total=runtimeChecks.length+manualIds.length;
 const complete=runtimeDone+manualDone;
 if(gate)gate.classList.toggle("ready",ready);
 if(stateNode)stateNode.textContent=ready?"READY FOR FINAL CHECKPOINT":"BLOCKED";
 if(detail)detail.textContent=`Runtime evidence ${runtimeDone}/${runtimeChecks.length} · manual release checks ${manualDone}/${manualIds.length}${ready?" · final checkpoint can begin":""}`;
 if(bar)bar.style.width=(total?Math.round(complete/total*100):0)+"%";
}
function renderRuntimeProbe(report){
 const milestones=report?.milestones||[],evidence=report?.evidence||[],minutes=report?.checkpointMinutes||[];
 const milestoneSet=new Set(milestones),evidenceSet=new Set(evidence);
 const coreReady=milestones.length>=7;
 const persistenceReady=report?.persistenceVerdict==="MATCH";
 const baselineReady=minutes.includes(10);
 const onboardingReady=evidenceSet.has("CharacterSpawned")&&evidenceSet.has("TutorialProgress")&&milestoneSet.has("Bee")&&milestoneSet.has("Roll");
 const multiplayerReady=evidenceSet.has("Multiplayer2Plus");
 const soakCount=[15,30,60].filter(x=>minutes.includes(x)).length;
 const soakReady=soakCount===3;
 state.runtimeGate={coreReady,persistenceReady,baselineReady,onboardingReady,multiplayerReady,soakReady};
 renderReleaseGate();
 setQaEvidence("#qaCoreEvidence",coreReady,"CORE LOOP");
 setQaEvidence("#qaPersistenceEvidence",persistenceReady,"PERSISTENCE");
 setQaEvidence("#qaBaselineEvidence",baselineReady,"10M BASELINE");
 setQaEvidence("#qaOnboardingEvidence",onboardingReady,"ONBOARDING");
 setQaEvidence("#qaMultiplayerEvidence",multiplayerReady,"MULTIPLAYER");
 setQaEvidence("#qaSoakEvidence",soakReady,"SOAK",soakCount+"/3 CHECKPOINTS");
 const milestoneNode=$("#runtimeMilestones");
 milestoneNode.textContent=(milestones.length>=7?"7/7 PASS · ":milestones.length+"/7 · ")+(milestones.length?milestones.join(", "):"waiting");
 milestoneNode.style.color=milestones.length>=7?"#66e0a6":"";
 const evidenceText=[];
 if(evidence.length)evidenceText.push("Evidence: "+evidence.join(", "));
 if(minutes.length)evidenceText.push("Paired checkpoints: "+minutes.map(x=>x+"m").join(", "));
 $("#runtimeEvidence").textContent=evidenceText.length?evidenceText.join(" · "):"No onboarding/multiplayer evidence yet.";
 $("#runtimeServerCheckpoint").textContent=checkpointLabel(report?.latestServerCheckpoint);
 $("#runtimeClientCheckpoint").textContent=checkpointLabel(report?.latestClientCheckpoint);
 const verdict=String(report?.persistenceVerdict||"NO_PAIR");
 const persistence=$("#runtimePersistence");
 persistence.textContent=verdict==="MATCH"?"MATCH":verdict==="MISMATCH"?"MISMATCH":verdict==="WAITING_REJOIN"?"WAITING REJOIN":"—";
 persistence.style.color=verdict==="MATCH"?"#66e0a6":verdict==="MISMATCH"?"#ff697b":verdict==="WAITING_REJOIN"?"#ffbe40":"";
 const path=report?.path||"";
 $("#runtimeProbeMeta").textContent=path?("Scanned "+(report.logsScanned||1)+" Studio log(s) · latest "+path.split(/[\\/]/).pop()):"No Roblox Studio log found.";
 const lines=report?.lines||[];
 $("#runtimeProbeOutput").textContent=lines.length?lines.slice(-80).join("\n"):"No RuntimeProbe/PersistenceProbe lines in the recent Studio logs.";
}
async function refreshRuntimeProbe(silent=false){
 if(!state.runtimeProbeEnabled){
  state.runtimeGate=null;
  renderReleaseGate();
  if($("#runtimeProbeMeta"))$("#runtimeProbeMeta").textContent="Runtime probe is not enabled for this project.";
  if($("#runtimeProbeOutput"))$("#runtimeProbeOutput").textContent="This project has no configured RuntimeProbe contract.";
  return;
 }
 try{
  const report=await invoke("runtime_probe_report");
  renderRuntimeProbe(report);
 }catch(error){
  state.runtimeGate=null;
  renderReleaseGate();
  if(!silent)log("Runtime probe read failed: "+error);
  $("#runtimeProbeMeta").textContent=String(error);
  $("#runtimeProbeOutput").textContent="Start a Roblox Studio Play session after AI SYNC to collect probe output.";
 }
}

async function connectRoot(path){
 if(state.projectId)saveProjectUiState();
 if(state.studioLoaded)unloadUiStudio("project changed");

 const status=await invoke("set_project_root",{path});
 state.root=status.root||path;
 localStorage.setItem("roflowStandaloneProjectRootV1",state.root);
 applyStatus(status);
 clearProjectDom();
 loadProjectUiState(state.projectId);
 navigate(state.currentPage||"dashboard");

 await Promise.all([refreshBackups(),refreshTasks(),refreshRojo(),refreshPlanner()]);
 if(state.currentPage==="ui")await ensureUiStudio(true);

 log("Project connected: "+state.displayName+" · "+state.root);
 setTimeout(()=>maybeAutoUpdate(),350);
 return status;
}

async function refresh(){
 if(!state.root)return;
 try{
  const status=await invoke("project_status");
  applyStatus(status);
  await Promise.all([refreshBackups(),refreshTasks(),refreshRojo(),refreshPlanner()]);
  log("Project status refreshed");
 }catch(error){log("Refresh failed: "+error);throw error}
}

async function chooseProject(){
 try{
  const selected=await dialog.open({directory:true,multiple:false,title:"Choose Roblox/Rojo project"});
  if(selected)await connectRoot(selected);
 }catch(error){log("Project selection failed: "+error)}
}

function notifyStudioModelChanged(){
 if(!state.studioLoaded)return;
 const frame=$("#uiStudioFrame");
 try{frame.contentWindow?.postMessage({type:"roflow-refresh-model"},"*")}catch{}
}

async function runSync(){
 requireProject();
 const out=$("#syncOutput");
 out.textContent="Safe sync: preserve → pull → merge → restore → checkpoint…";
 try{
  const data=await invoke("safe_ai_sync",{editorModel:null});
  const recovery=data.recoveredConflicts?.length
   ?"\nRecovered interrupted AI Sync conflict safely"
    +"\nConflict paths: "+data.recoveredConflicts.join(", ")
    +(data.conflictRecoveries?.length?"\nRecovery copies: "+data.conflictRecoveries.join(", "):"")
    +(data.preservedStashes?.length?"\nPreserved stash: "+data.preservedStashes.map(shortSha).join(", "):"")
   :"";
  out.textContent=(data.changed?"Updated to ":"Already current at ")+shortSha(data.head)+"\n"+data.subject+(data.modelMerged?"\nAuthored UI model merged safely":"")+(data.stashed&&data.restored?"\nOther local changes restored":"")+recovery+(data.backupVersion?"\nCheckpoint: "+data.backupVersion:"");
  await refresh();
  if(state.currentPage==="ui")await ensureUiStudio(true);
  else if(state.studioLoaded)unloadUiStudio("AI Sync while inactive");
  log("Safe AI Sync completed");
  return data;
 }catch(error){
  out.textContent="SYNC STOPPED SAFELY\n"+String(error);
  log("Sync stopped: "+error);
  throw error;
 }
}

async function createCheckpoint(note="Manual checkpoint"){
 requireProject();
 const backup=await invoke("create_backup",{title:"Checkpoint",summary:note});
 await refreshBackups();
 log("Checkpoint created: "+backup.version);
 return backup;
}

async function runDevCycle(){
 requireProject();
 const button=$("#devCycleBtn");
 button.disabled=true;
 $("#cycleTitle").textContent="Running…";
 $("#cycleOutput").textContent="1/3 Creating checkpoint…";
 try{
  const checkpoint=await createCheckpoint("Automatic checkpoint before DEV CYCLE");
  $("#cycleOutput").textContent+=`\nCreated ${checkpoint.version}\n2/3 Safe AI Sync…`;
  const sync=await runSync();
  $("#cycleOutput").textContent+=`\nHEAD ${shortSha(sync.head)}\n3/3 Health check…`;
  const health=await runHealth();
  $("#cycleOutput").textContent+=`\nHealth: ${health.passed}/${health.total} PASS`;
  $("#cycleTitle").textContent=health.passed===health.total?"Cycle complete":"Cycle complete with warnings";
  $("#cycleText").textContent="No commit or push was performed automatically.";
  log("DEV CYCLE completed");
 }catch(error){
  $("#cycleTitle").textContent="Cycle stopped safely";
  $("#cycleOutput").textContent+=`\nERROR: ${String(error)}`;
  log("DEV CYCLE stopped: "+error);
 }finally{button.disabled=false}
}

const studioSuspendWaiters=new Map();

function postStudio(message){
 if(!state.studioLoaded)return false;
 const frame=$("#uiStudioFrame");
 try{frame.contentWindow?.postMessage(message,"*");return true}catch{return false}
}
function resumeUiStudio(){
 clearTimeout(state.studioUnloadTimer);
 state.studioUnloadTimer=null;
 postStudio({type:"roflow-resume"});
}
function unloadUiStudio(reason="inactive"){
 clearTimeout(state.studioUnloadTimer);
 state.studioUnloadTimer=null;
 if(!state.studioLoaded)return;
 const frame=$("#uiStudioFrame");
 frame.removeAttribute("srcdoc");
 frame.src="about:blank";
 state.studioLoaded=false;
 log("UI Studio unloaded from memory · "+reason);
}
async function suspendUiStudio({allowUnload=true,reason="inactive"}={}){
 if(!state.studioLoaded)return true;
 clearTimeout(state.studioUnloadTimer);
 state.studioUnloadTimer=null;
 const requestId="suspend-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
 const saved=await new Promise(resolve=>{
  const timer=setTimeout(()=>{studioSuspendWaiters.delete(requestId);resolve(false)},3500);
  studioSuspendWaiters.set(requestId,ok=>{clearTimeout(timer);resolve(ok)});
  if(!postStudio({type:"roflow-suspend",requestId,reason,flush:true})){
   clearTimeout(timer);studioSuspendWaiters.delete(requestId);resolve(false);
  }
 });
 if(saved&&allowUnload&&state.currentPage!=="ui"){
  state.studioUnloadTimer=setTimeout(()=>{
   if(state.currentPage!=="ui"&&state.studioLoaded)unloadUiStudio("inactive timeout");
  },12000);
 }
 return saved;
}

async function ensureUiStudio(force=false){
 const frame=$("#uiStudioFrame");
 clearTimeout(state.studioUnloadTimer);
 state.studioUnloadTimer=null;
 if(!force&&state.studioLoaded){resumeUiStudio();return}
 frame.removeAttribute("srcdoc");
 const scope=encodeURIComponent(state.projectId||"unscoped");
 frame.src="./ui-studio/index.html?project="+scope+"&ts="+Date.now();
 state.studioLoaded=true;
 log("Bundled UI Studio loaded for "+(state.displayName||"project"));
}

function diffClass(line){
 if(line.startsWith("+++")||line.startsWith("---")||line.startsWith("diff ")||line.startsWith("index "))return"meta";
 if(line.startsWith("@@"))return"hunk";
 if(line.startsWith("+"))return"add";
 if(line.startsWith("-"))return"del";
 return"";
}

async function selectChangedFile(path,status){
 state.selectedFile=path;
 saveProjectUiState();
 document.querySelectorAll(".file-item").forEach(item=>item.classList.toggle("active",item.dataset.path===path));
 $("#diffTitle").textContent=path;
 $("#diffMeta").textContent=status;
 $("#diffOutput").innerHTML='<div class="empty-state">Loading diff…</div>';
 try{
  const diff=await invoke("git_file_diff",{path});
  $("#diffOutput").innerHTML=String(diff).split("\n").map(line=>`<div class="diff-line ${diffClass(line)}">${escapeHtml(line)||" "}</div>`).join("");
 }catch(error){$("#diffOutput").innerHTML=`<div class="empty-state">${escapeHtml(error)}</div>`}
}

async function loadChanges(){
 if(!state.root)return;
 try{
  const changes=await invoke("git_changes");
  $("#changesBadge").textContent=String(changes.length);
  $("#fileList").innerHTML=changes.length?changes.map(change=>`
   <button class="file-item" data-path="${escapeHtml(change.path)}" data-status="${escapeHtml(change.status)}">
    <span class="file-status">${escapeHtml(change.status)}</span><span class="file-path">${escapeHtml(change.path)}</span>
   </button>`).join(""):'<div class="empty-state">Working tree clean.</div>';
  document.querySelectorAll(".file-item").forEach(item=>item.onclick=()=>selectChangedFile(item.dataset.path,item.dataset.status));
  if(changes.length){
   const selected=changes.find(change=>change.path===state.selectedFile)||changes[0];
   await selectChangedFile(selected.path,selected.status);
  }else{
   state.selectedFile="";
   $("#diffTitle").textContent="No local changes";
   $("#diffMeta").textContent="CLEAN";
   $("#diffOutput").innerHTML='<div class="empty-state">Nothing to review.</div>';
  }
 }catch(error){log("Changes failed: "+error)}
}

async function commitChanges(){
 requireProject();
 const message=$("#commitMessage").value.trim();
 if(message.length<3){log("Commit message is too short");return}
 const button=$("#commitBtn");button.disabled=true;
 try{
  const result=await invoke("git_commit",{message});
  $("#commitMessage").value="";
  applyStatus(result.status);
  log(`Commit created: ${shortSha(result.head)} · checkpoint ${result.backupVersion}`);
  await Promise.all([loadChanges(),refreshBackups(),refreshTasks()]);
 }catch(error){log("Commit failed: "+error);alert(String(error))}
 finally{button.disabled=false}
}

async function startRojo(){
 $("#rojoOutput").textContent="Starting Rojo and checking localhost:34872…";
 try{
  applyRojo(await invoke("rojo_start"));
  $("#rojoOutput").textContent="Rojo verified at http://127.0.0.1:34872/ for "+state.buildFileName+".";
  log("Rojo serve is listening on port 34872");
 }catch(error){
  $("#rojoOutput").textContent=String(error);
  log("Rojo start failed: "+error);
  await refreshRojo();
 }
}
async function stopRojo(){
 try{applyRojo(await invoke("rojo_stop"));$("#rojoOutput").textContent="Rojo serve stopped.";log("Rojo serve stopped")}catch(error){$("#rojoOutput").textContent=String(error);log("Rojo stop failed: "+error)}
}
async function buildProject(){
 const button=$("#buildBtn");button.disabled=true;$("#rojoOutput").textContent="Building "+(state.buildFileName||"project")+"…";
 try{
  const result=await invoke("rojo_build");
  $("#rojoOutput").textContent=(result.success?"BUILD SUCCESS\n":"BUILD FAILED\n")+(result.path||"")+"\n"+(result.output||"");
  log(result.success?"Rojo build completed":"Rojo build failed");
  await refreshRojo();
 }catch(error){$("#rojoOutput").textContent=String(error);log("Rojo build failed: "+error)}
 finally{button.disabled=false}
}

function navigate(page){
 const previous=state.currentPage;
 state.currentPage=page;
 if(previous==="ui"&&page!=="ui")suspendUiStudio({allowUnload:true,reason:"page change"}).catch(()=>{});
 document.body.classList.toggle("ui-studio-focus",page==="ui");
 document.querySelectorAll(".nav[data-page]").forEach(button=>button.classList.toggle("active",button.dataset.page===page));
 document.querySelectorAll(".page").forEach(section=>section.classList.remove("active"));
 $("#"+page+"Page")?.classList.add("active");
 const label=document.querySelector(`.nav[data-page="${page}"]`)?.childNodes?.[0]?.textContent?.trim()||page;
 $("#pageTitle").textContent=label;
 if(page==="ui")ensureUiStudio().catch(error=>log("UI Studio load failed: "+error));
 if(page==="changes")loadChanges();
 if(page==="planner")refreshPlanner();
 if(page==="tasks")refreshTasks();
 if(page==="roblox"){refreshRojo();refreshRuntimeProbe(true)}
 saveProjectUiState();
}

document.querySelectorAll(".nav[data-page]").forEach(button=>button.onclick=()=>navigate(button.dataset.page));
setInterval(()=>{if(state.root&&!document.hidden)maybeAutoUpdate()},60000);
setInterval(()=>{if(state.currentPage==="roblox"&&!document.hidden)refreshRuntimeProbe(true)},5000);
document.querySelectorAll("[data-go]").forEach(button=>button.onclick=()=>navigate(button.dataset.go));
$("#chooseBtn").onclick=chooseProject;
$("#refreshBtn").onclick=async()=>{await refresh().catch(()=>{});await maybeAutoUpdate(true)};
$("#syncBtn").onclick=()=>runSync().catch(()=>{});
$("#devCycleBtn").onclick=runDevCycle;
$("#checkpointBtn").onclick=()=>createCheckpoint("Manual dashboard checkpoint").catch(error=>log("Checkpoint failed: "+error));
$("#healthBtn").onclick=()=>runHealth().catch(error=>log("Health check failed: "+error));
$("#backupsBtn").onclick=async()=>{try{requireProject();await invoke("open_backups_window");log("Backups window opened")}catch(error){log("Failed to open backups: "+error)}};
$("#reloadStudioBtn").onclick=()=>ensureUiStudio(true).catch(error=>log("UI Studio reload failed: "+error));
$("#reloadChangesBtn").onclick=loadChanges;
$("#changesCheckpointBtn").onclick=()=>createCheckpoint("Checkpoint from Changes review").catch(error=>log("Checkpoint failed: "+error));
$("#commitBtn").onclick=commitChanges;
$("#commitMessage").addEventListener("keydown",event=>{if(event.key==="Enter")commitChanges()});
$("#plannerCompletedToggle").onclick=()=>{
 state.plannerShowCompleted=!state.plannerShowCompleted;
 saveProjectUiState();
 if(state.planner)renderPlanner(state.planner);
};
$("#reloadTasksBtn").onclick=refreshTasks;
$("#refreshRojoBtn").onclick=refreshRojo;
$("#refreshRuntimeProbeBtn").onclick=()=>refreshRuntimeProbe(false);
$("#startRojoBtn").onclick=startRojo;
$("#stopRojoBtn").onclick=stopRojo;
$("#buildBtn").onclick=buildProject;
$("#openStudioBtn").onclick=async()=>{try{await invoke("open_roblox_project");log("Opened "+(state.buildFileName||"Roblox project"))}catch(error){$("#rojoOutput").textContent=String(error);log("Open Studio failed: "+error)}};

window.addEventListener("message",async event=>{
 if(event.data?.type==="roflow-suspend-ready"){
  const waiter=studioSuspendWaiters.get(event.data.requestId);
  if(waiter){studioSuspendWaiters.delete(event.data.requestId);waiter(event.data.ok===true)}
  return;
 }
 if(event.data?.type==="roflow-request-project-picker"){
  await chooseProject();
 }else if(event.data?.type==="roflow-project-changed"){
  const nextRoot=event.data.path||state.root;
  if(nextRoot)await connectRoot(nextRoot).catch(error=>log("Project switch failed: "+error));
 }else if(event.data?.type==="roflow-sync-complete"){
  await refresh().catch(()=>{});
  log("UI Studio completed AI Sync");
 }
});

document.addEventListener("visibilitychange",()=>{
 if(document.hidden){
  if(state.currentPage==="ui")suspendUiStudio({allowUnload:false,reason:"window hidden"}).catch(()=>{});
 }else{
  if(state.currentPage==="ui")resumeUiStudio();
  if(state.root)maybeAutoUpdate().catch(()=>{});
 }
});

(async()=>{
 if(!invoke){log("This page must run inside the RoFlow Tauri desktop app.");return}
 if(state.root){
  try{
   await connectRoot(state.root);
  }catch(error){
   localStorage.removeItem("roflowStandaloneProjectRootV1");
   state.root="";
   log("Saved project path is no longer valid: "+error);
  }
 }
})();
