(()=>{
"use strict";

const $=s=>document.querySelector(s);
const els={
 tree:$("#tree"),inspector:$("#inspector"),device:$("#device"),canvas:$("#viewportCanvas"),guiRoot:$("#guiRoot"),overlay:$("#selectionOverlay"),geometry:$("#geometryLayer"),
 stageScroller:$("#stageScroller"),status:$("#statusText"),pixels:$("#pixelReadout"),target:$("#targetReadout"),
 toast:$("#toast"),fileInput:$("#fileInput"),jsonDialog:$("#jsonDialog"),jsonArea:$("#jsonArea")
};

const MODIFIERS=new Set(["UICorner","UIStroke","UIPadding","UIListLayout","UIGridLayout","UIAspectRatioConstraint","UIScale","UIGradient"]);
const TEXT_CLASSES=new Set(["TextLabel","TextButton","TextBox"]);
const IMAGE_CLASSES=new Set(["ImageLabel","ImageButton"]);
const CONTAINERS=new Set(["ScreenGui","Frame","ScrollingFrame","TextButton","ImageButton"]);
const CREATION_CONTAINERS=new Set(["ScreenGui","Frame","ScrollingFrame"]);
const DEFAULT_TARGET="src/StarterGui/BloomUI.model.json";
const LOADING_TARGET="src/ReplicatedFirst/BloomLoadingTemplate.model.json";
const PROJECT_SCOPE=new URLSearchParams(location.search).get("project")||"unscoped";
const scopedKey=name=>name+":"+PROJECT_SCOPE;
function lastGoodModelKey(){return scopedKey("BloomUIStudioLastGoodModel:"+(state?.targetPath||DEFAULT_TARGET))}
let PROJECT_UI_STATES=[];
const UI_STATE_TITLES={};
const UI_STATE_ROOTS={};
const UI_STATE_MODELS={};

function clearUiStateConfig(){
 PROJECT_UI_STATES=[];
 for(const map of [UI_STATE_TITLES,UI_STATE_ROOTS,UI_STATE_MODELS])for(const key of Object.keys(map))delete map[key];
}
function renderUiStateRail(){
 const bar=$("#uiStateBar");if(!bar)return;
 bar.innerHTML="";
 const head=document.createElement("div");head.className="rail-head";head.innerHTML="<span>UI</span><small>STATES</small>";bar.appendChild(head);
 for(const config of PROJECT_UI_STATES){
  const button=document.createElement("button");
  button.className="ui-state-btn";
  button.dataset.uiState=config.id;
  button.title=config.label;
  const icon=document.createElement("b");
  if(config.iconAssetId){
   const img=document.createElement("img");img.dataset.assetId=config.iconAssetId;img.alt="";icon.appendChild(img);
  }else{
   icon.textContent=(config.label||config.id||"?").trim().slice(0,1).toUpperCase();
  }
  const label=document.createElement("span");label.textContent=config.label||config.id;
  button.append(icon,label);bar.appendChild(button);
 }
 const foot=document.createElement("div");foot.className="rail-foot";
 foot.textContent=PROJECT_UI_STATES.length?"Click active state again for empty desk":"No UI states configured for this project";
 bar.appendChild(foot);
 hydrateStudioIcons();
}
async function loadProjectUiConfig(){
 clearUiStateConfig();
 if(!ROFLOW_NATIVE){renderUiStateRail();return}
 try{
  const status=await roflowInvoke("project_status");
  const list=Array.isArray(status?.uiStates)?status.uiStates:[];
  PROJECT_UI_STATES=list.filter(item=>item&&item.id&&item.root).map(item=>({
   id:String(item.id),
   label:String(item.label||item.id),
   root:String(item.root),
   modelPath:String(item.modelPath||DEFAULT_TARGET),
   iconAssetId:String(item.iconAssetId||"")
  }));
  for(const item of PROJECT_UI_STATES){
   UI_STATE_TITLES[item.id]=item.label;
   UI_STATE_ROOTS[item.id]=item.root;
   UI_STATE_MODELS[item.id]=item.modelPath;
  }
  const models=new Set(PROJECT_UI_STATES.map(item=>item.modelPath));
  if(PROJECT_UI_STATES.length&&!models.has(state.targetPath)){
   state.targetPath=PROJECT_UI_STATES[0].modelPath||DEFAULT_TARGET;
   state.modelKey=state.targetPath;
  }
 }catch(error){
  console.error("[RoFlow UI Studio] project UI config failed",error);
 }
 renderUiStateRail();
}

function roflowTauri(){
 try{
  if(window.__TAURI__)return window.__TAURI__;
  if(window.parent&&window.parent!==window&&window.parent.__TAURI__)return window.parent.__TAURI__;
 }catch{}
 return null;
}
const ROFLOW_NATIVE=window.__ROFLOW_EMBEDDED__===true&&!!roflowTauri()?.core?.invoke;
if(ROFLOW_NATIVE)document.documentElement.classList.add("roflow-native");
const nativeThumbnailCache=new Map();
function nativeThumbnail(assetId){
 let pending=nativeThumbnailCache.get(String(assetId));
 if(!pending){
  pending=roflowInvoke("roblox_thumbnail_url",{assetId:String(assetId)}).catch(()=> "");
  nativeThumbnailCache.set(String(assetId),pending);
 }
 return pending;
}
function hydrateStudioIcons(){
 document.querySelectorAll("img[data-asset-id]").forEach(img=>{
  const id=img.dataset.assetId;if(!id)return;
  if(ROFLOW_NATIVE)nativeThumbnail(id).then(url=>{if(url)img.src=url});
  else img.src="/api/thumbnail?id="+encodeURIComponent(id);
 });
}
function roflowInvoke(command,args={}){const t=roflowTauri();if(!t?.core?.invoke)throw new Error("RoFlow native bridge unavailable");return t.core.invoke(command,args)}
function roflowDialog(){return roflowTauri()?.dialog||null}
function hasProjectConnection(){return ROFLOW_NATIVE?state.nativeProjectReady:!!state.projectHandle}

const state={
 root:null,selectedId:null,viewport:{w:1366,h:768},zoom:.72,snap:8,labels:false,grid:true,showHidden:true,geometry:true,inset:36,mode:"design",previewScene:"gameplay",
 projectHandle:null,nativeProjectReady:false,targetPath:localStorage.getItem(scopedKey("bloomTargetPath"))||DEFAULT_TARGET,
 activeUiState:null,modelKey:"bloom",history:[],future:[],dirty:false,drag:null,panelResize:null,explorerW:252,inspectorW:300,collapsed:new Set(),clipboard:null,treeQuery:"",pan:null,selectedIds:new Set(),selectionAnchorId:null,treeDragIds:[],assistantSyncing:false,bridgeBase:"",modelLoadFailed:false,autoSaveTimer:null,autoSaving:false,autoSaveQueued:false,lastAutoSaveError:"",suspended:false
};

let idCounter=1;
const uid=()=> "ui_"+(idCounter++).toString(36)+"_"+Date.now().toString(36).slice(-4);
const deepClone=x=>JSON.parse(JSON.stringify(x));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const ZOOM_MIN=.25,ZOOM_MAX=2.5;
let engineV2=null,zoomSaveTimer=null;
const touchPoints=new Map();
let touchPinch=null;
const finite=(v,d=0)=>Number.isFinite(+v)?+v:d;
const roundOffset=v=>Math.round(finite(v));
const c3=(r=1,g=1,b=1)=>[r,g,b];
const ud=(s=0,o=0)=>({UDim:[s,o]});
const u2=(xs=0,xo=0,ys=0,yo=0)=>({UDim2:[[xs,xo],[ys,yo]]});
const v2=(x=0,y=0)=>({Vector2:[x,y]});

const PREFS_KEY=scopedKey("BloomUIStudioPrefsV1");
function applyPanelWidths(){
 document.documentElement.style.setProperty("--explorer-w",Math.round(state.explorerW)+"px");
 document.documentElement.style.setProperty("--inspector-w",Math.round(state.inspectorW)+"px");
}
function loadPrefs(){
 try{
  const p=JSON.parse(localStorage.getItem(PREFS_KEY)||"{}");
  if(p.viewport&&Number.isFinite(p.viewport.w)&&Number.isFinite(p.viewport.h))state.viewport={w:p.viewport.w,h:p.viewport.h};
  if(Number.isFinite(p.zoom))state.zoom=clamp(p.zoom,ZOOM_MIN,ZOOM_MAX);
  if(Number.isFinite(p.snap))state.snap=p.snap;
  if(typeof p.labels==="boolean")state.labels=p.labels;
  if(typeof p.grid==="boolean")state.grid=p.grid;
  if(typeof p.showHidden==="boolean")state.showHidden=p.showHidden;
  if(typeof p.geometry==="boolean")state.geometry=p.geometry;
  if(Number.isFinite(p.inset))state.inset=p.inset;
  if(Number.isFinite(p.explorerW))state.explorerW=clamp(p.explorerW,180,460);
  if(Number.isFinite(p.inspectorW))state.inspectorW=clamp(p.inspectorW,220,500);
  state.activeUiState=null;
  state.mode="preview";
  state.previewScene="empty";
 }catch{}
 applyPanelWidths();
}
function savePrefs(){
 localStorage.setItem(PREFS_KEY,JSON.stringify({
  viewport:state.viewport,zoom:state.zoom,snap:state.snap,labels:state.labels,grid:state.grid,
  showHidden:state.showHidden,geometry:state.geometry,inset:state.inset,
  explorerW:state.explorerW,inspectorW:state.inspectorW
 }));
}
function syncToolbarFromState(){
 $("#viewportW").value=state.viewport.w;$("#viewportH").value=state.viewport.h;
 $("#zoomRange").value=Math.round(state.zoom*100);$("#zoomLabel").textContent=Math.round(state.zoom*100)+"%";
 $("#snapSelect").value=String(state.snap);
 $("#labelsToggle").checked=state.labels;$("#gridToggle").checked=state.grid;$("#hiddenToggle").checked=state.showHidden;$("#geometryToggle").checked=state.geometry;
 $("#insetInput").value=state.inset;$("#modeSelect").value=state.mode;$("#sceneSelect").value=state.previewScene;
 $("#sceneSelect").disabled=!isPreview();$("#modeSelect").classList.toggle("preview-active",isPreview());
 els.stageScroller.classList.toggle("no-grid",!state.grid);
 const preset=`${state.viewport.w}x${state.viewport.h}`;if([...$("#presetSelect").options].some(o=>o.value===preset))$("#presetSelect").value=preset;else $("#presetSelect").value="";
}


function normalizeNode(node){
 const n={
  ClassName:node.ClassName||"Frame",
  Name:node.Name||node.ClassName||"Object",
  Properties:deepClone(node.Properties||{}),
  Children:(node.Children||[]).map(normalizeNode),
  __id:uid()
 };
 return n;
}
function stripNode(node){
 return {
  ClassName:node.ClassName,
  Name:node.Name,
  Properties:sanitizeProperties(deepClone(node.Properties||{})),
  ...(node.Children&&node.Children.length?{Children:node.Children.map(stripNode)}:{})
 };
}
function sanitizeProperties(props){
 const walk=v=>{
  if(!v||typeof v!=="object") return v;
  if(Array.isArray(v)) return v.map(walk);
  if(v.UDim&&Array.isArray(v.UDim)){v.UDim=[finite(v.UDim[0]),roundOffset(v.UDim[1])];return v}
  if(v.UDim2&&Array.isArray(v.UDim2)){
   v.UDim2=[
    [finite(v.UDim2[0]?.[0]),roundOffset(v.UDim2[0]?.[1])],
    [finite(v.UDim2[1]?.[0]),roundOffset(v.UDim2[1]?.[1])]
   ];return v
  }
  Object.keys(v).forEach(k=>v[k]=walk(v[k]));
  return v;
 };
 return walk(props);
}
function serialize(pretty=true){return JSON.stringify(stripNode(state.root),null,pretty?2:0)}
function setRoot(raw,label="Модель загружена"){
 try{
  state.root=normalizeNode(raw);
  const activeState=state.activeUiState;
  const safeRoot=(state.root.Children||[]).find(x=>x.Name==="SafeRoot"&&x.ClassName==="Frame");
  state.selectedId=(safeRoot||state.root).__id;
  state.selectedIds=new Set([state.selectedId]);
  state.selectionAnchorId=state.selectedId;
  state.history=[];state.future=[];state.dirty=false;state.modelLoadFailed=false;
  try{localStorage.setItem(lastGoodModelKey(),JSON.stringify(stripNode(state.root)))}catch{}
  const push=$("#pushBtn");if(push){push.disabled=false;push.title="Записать модель в игру"}
  if(activeState){
   selectStateRoot(activeState);
   syncToolbarFromState();
  }
  syncInsetFromRoot();renderAll();toast(label);
 }catch(e){console.error("[Bloom UI Studio] model/render error",e);toast("Ошибка модели: "+e.message,true)}
}
function syncInsetFromRoot(){
 if(state.root?.ClassName==="ScreenGui"){
  const ignore=state.root.Properties?.IgnoreGuiInset===true;
  if(ignore) state.inset=0;
  $("#insetInput").value=state.inset;
 }
}

function walk(node,fn,parent=null){fn(node,parent);for(const c of node.Children||[])walk(c,fn,node)}
function findNode(id){let out=null;walk(state.root,n=>{if(n.__id===id)out=n});return out}
function findParent(id){let out=null;walk(state.root,(n,p)=>{if(n.__id===id)out=p});return out}
function selected(){return findNode(state.selectedId)}
function selectedNodes(){
 return [...state.selectedIds].map(findNode).filter(Boolean);
}
function selectedMoveRoots(){
 const picked=selectedNodes().filter(n=>n&&n!==state.root&&!MODIFIERS.has(n.ClassName));
 return picked.filter(n=>{
  let p=findParent(n.__id);
  while(p){
   if(state.selectedIds.has(p.__id))return false;
   p=findParent(p.__id);
  }
  return true;
 });
}
function isSelectedId(id){return state.selectedIds.has(id)}
function setPrimarySelection(id){
 if(!id)return;
 state.selectedId=id;
 if(!state.selectedIds.has(id))state.selectedIds.add(id);
}
function pushHistory(){
 if(!state.root)return;
 state.history.push(serialize(false));
 if(state.history.length>60)state.history.shift();
 state.future=[];
}
function restoreSnapshot(json){
 const raw=JSON.parse(json);state.root=normalizeNode(raw);state.selectedId=state.root.__id;state.selectedIds=new Set([state.selectedId]);state.selectionAnchorId=state.selectedId;markDirty();renderAll()
}
function undo(){if(!state.history.length)return;state.future.push(serialize(false));restoreSnapshot(state.history.pop());toast("Undo")}
function redo(){if(!state.future.length)return;state.history.push(serialize(false));restoreSnapshot(state.future.pop());toast("Redo")}

function currentModelLooksSafe(){
 if(!state.root||state.root.ClassName!=="ScreenGui")return false;
 return Array.isArray(state.root.Children)&&state.root.Children.length>0;
}

function markDirty(){
 state.dirty=true;
 scheduleAutoSave();
}
function scheduleAutoSave(delay=320){
 if(state.suspended||!hasProjectConnection()||!state.root||state.assistantSyncing)return;
 clearTimeout(state.autoSaveTimer);
 state.autoSaveTimer=setTimeout(()=>{state.autoSaveTimer=null;autoSaveNow(true)},delay);
}

function changed(){markDirty();renderAll()}

function prop(node,key,fallback){return node?.Properties?.[key]??fallback}
function asUDim2(v,def=[[0,0],[0,0]]){
 if(v?.UDim2&&Array.isArray(v.UDim2))v=v.UDim2;
 if(Array.isArray(v)&&Array.isArray(v[0])&&Array.isArray(v[1])){
  return [
   [finite(v[0][0]),roundOffset(v[0][1])],
   [finite(v[1][0]),roundOffset(v[1][1])]
  ];
 }
 return deepClone(def);
}
function asUDim(v,def=[0,0]){
 if(v?.UDim&&Array.isArray(v.UDim))v=v.UDim;
 if(Array.isArray(v))return [finite(v[0]),roundOffset(v[1])];
 return deepClone(def);
}
function asVector2(v,def=[0,0]){
 if(v?.Vector2&&Array.isArray(v.Vector2))v=v.Vector2;
 if(Array.isArray(v))return [finite(v[0]),finite(v[1])];
 return deepClone(def);
}
function u2v(node,key,def=u2()){
 const fallback=asUDim2(def,[[0,0],[0,0]]);
 return asUDim2(prop(node,key,null),fallback);
}
function udv(node,key,def=ud()){
 const fallback=asUDim(def,[0,0]);
 return asUDim(prop(node,key,null),fallback);
}
function v2v(node,key,def=v2()){
 const fallback=asVector2(def,[0,0]);
 return asVector2(prop(node,key,null),fallback);
}
function color(v,trans=0){
 const a=clamp(1-finite(trans),0,1);const c=Array.isArray(v)?v:[1,1,1];
 return `rgba(${Math.round(clamp(c[0],0,1)*255)},${Math.round(clamp(c[1],0,1)*255)},${Math.round(clamp(c[2],0,1)*255)},${a})`;
}
function colorHex(v){
 const c=Array.isArray(v)?v:[1,1,1];
 return "#"+c.slice(0,3).map(x=>Math.round(clamp(x,0,1)*255).toString(16).padStart(2,"0")).join("");
}
function hexColor(h){const x=h.replace("#","");return [0,2,4].map(i=>parseInt(x.slice(i,i+2),16)/255)}
function cssUDim2(v,axis){const a=v?.UDim2||v||[[0,0],[0,0]];const p=axis===0?a[0]:a[1];return `calc(${finite(p[0])*100}% + ${roundOffset(p[1])}px)`}

function layoutChildNodes(n){return (n.Children||[]).filter(x=>!MODIFIERS.has(x.ClassName))}
function modifier(n,kind){return (n.Children||[]).find(x=>x.ClassName===kind)}
function getPadding(n){
 const p=modifier(n,"UIPadding");if(!p)return null;
 return {
  l:udv(p,"PaddingLeft")[1],r:udv(p,"PaddingRight")[1],
  t:udv(p,"PaddingTop")[1],b:udv(p,"PaddingBottom")[1]
 };
}
function imageUrl(src){
 if(!src)return "";
 const s=String(src).trim();
 const m=
  s.match(/rbxthumb:\/\/[^?]*\?[^#]*\bid=(\d+)/i)||
  s.match(/rbxthumb:\/\/.*?\bid=(\d+)/i)||
  s.match(/rbxassetid:\/\/(\d+)/i)||
  s.match(/[?&]id=(\d+)/i)||
  s.match(/^(\d{6,})$/);
 if(!m)return /^https?:\/\//i.test(s)?s:"";
 return ROFLOW_NATIVE?`roflow-asset:${m[1]}`:`/api/thumbnail?id=${encodeURIComponent(m[1])}`;
}

function ensureEngineV2(){
 if(engineV2)return engineV2;
 if(!window.BloomEditorEngineV2||!els.canvas)return null;
 engineV2=new window.BloomEditorEngineV2({
  canvas:els.canvas,proxyHost:els.guiRoot,device:els.device,scroller:els.stageScroller,
  adapter:{
   isModifier:n=>MODIFIERS.has(n?.ClassName),
   isText:n=>TEXT_CLASSES.has(n?.ClassName),
   isImage:n=>IMAGE_CLASSES.has(n?.ClassName),
   modifier,
   previewVisible,
   previewSize,
   previewText,
   imageKey:(n,p)=>String(n?.__id||"")+"|"+String(state.previewScene||"")+"|"+String(previewImage(n,p)??n?.Properties?.Image??""),
   resolveImage:async(n,p)=>{
    const source=previewImage(n,p)??n?.Properties?.Image??"";
    const resolved=imageUrl(source);
    if(ROFLOW_NATIVE&&resolved.startsWith("roflow-asset:"))return nativeThumbnail(resolved.slice("roflow-asset:".length));
    return resolved;
   },
   onNodePointerDown:(ev,n)=>startMove(ev,n),
   onBlankPointerDown:ev=>{if(ev.button===0&&state.root)select(state.root.__id,false)},
   onHover:(n,point)=>{
    if(!n)return;
    els.canvas.title=(n.Name||"Object")+" · "+(n.ClassName||"GuiObject")+" · "+Math.round(point.x)+","+Math.round(point.y);
   }
  }
 });
 document.documentElement.classList.add("engine-v2-active");
 return engineV2;
}


function updateUiStateBar(){
 const bar=$("#uiStateBar");if(!bar)return;
 const current=state.activeUiState;
 bar.querySelectorAll("[data-ui-state]").forEach(b=>b.classList.toggle("active",b.dataset.uiState===current));
 bar.classList.toggle("preview-active",!!current);
 const title=$("#activeStateTitle");
 const caption=title?.closest(".state-caption");
 if(title)title.textContent=current?(UI_STATE_TITLES[current]||current.toUpperCase()):"EMPTY WORKSPACE";
 caption?.classList.toggle("live",!!current);
}
async function switchUiModel(path,key){
 if(state.targetPath===path&&state.root)return true;
 if(state.dirty&&!state.modelLoadFailed){
  const saved=await flushAutoSave();
  if(!saved)return false;
 }
 const previousPath=state.targetPath,previousKey=state.modelKey,previousRoot=state.root;
 state.targetPath=path;
 state.modelKey=key||path;
 const loaded=await pullProject();
 if(!loaded){
  state.targetPath=previousPath;state.modelKey=previousKey;state.root=previousRoot;
  updateStatus();
  return false;
 }
 localStorage.setItem(scopedKey("bloomTargetPath"),path);
 updateStatus();
 return true;
}
function stateFocusName(scene){return UI_STATE_ROOTS[scene]||null}
function stateModelPath(scene){return UI_STATE_MODELS[scene]||DEFAULT_TARGET}
const FRAGMENT_ROOT_BASES=[
 "CloseButton","EquipButton","UnequipButton","ConfirmButton","CancelButton","BackButton",
 "PrimaryAction","IconButton","TabButton","CurrencyPill","StatusBadge","ProgressBar","Tooltip","ModalHeader"
];
function configuredMenuRoots(){return PROJECT_UI_STATES.map(item=>item.root).filter(Boolean)}
function nameMatchesBase(name,base){
 const value=String(name||"");
 if(value===base)return true;
 if(!value.startsWith(base))return false;
 const suffix=value.slice(base.length);
 return suffix.length>0&&/^\d+$/.test(suffix);
}
function isFragmentRoot(n){
 if(!n||n===state.root||MODIFIERS.has(n.ClassName))return false;
 if(n.ClassName==="TextButton"||n.ClassName==="ImageButton")return true;
 return FRAGMENT_ROOT_BASES.some(base=>nameMatchesBase(n.Name,base));
}
function fragmentInteractionRoot(n){
 if(!n)return n;
 let current=n;
 while(current&&current!==state.root){
  if(isFragmentRoot(current))return current;
  current=findParent(current.__id);
 }
 return n;
}
function selectedMenuRoot(node=selected()){
 let current=node;
 const roots=configuredMenuRoots();
 while(current&&current!==state.root){
  if(roots.some(base=>nameMatchesBase(current.Name,base)))return current;
  current=findParent(current.__id);
 }
 return null;
}
function activeSceneForMenuRoot(menuRoot){
 if(!menuRoot)return null;
 for(const config of PROJECT_UI_STATES){
  if(config.root&&nameMatchesBase(menuRoot.Name,config.root))return config.id;
 }
 return null;
}
function findStateRoot(scene){
 const wanted=stateFocusName(scene);if(!wanted||!state.root)return null;
 let found=null;walk(state.root,n=>{if(!found&&n.Name===wanted)found=n});
 return found;
}
function selectStateRoot(scene){
 const found=findStateRoot(scene);
 if(found){state.selectedId=found.__id;state.selectedIds=new Set([found.__id]);state.selectionAnchorId=found.__id}
}
async function activateUiState(scene){
 const config=PROJECT_UI_STATES.find(item=>item.id===scene);
 if(!config)return;
 const closing=state.activeUiState===scene;
 if(closing){
  state.activeUiState=null;
  state.mode="preview";
  state.previewScene="empty";
  state.selectedId=null;
  state.selectedIds=new Set();
  state.selectionAnchorId=null;
  syncToolbarFromState();renderAll();savePrefs();
  toast("Empty workspace");
  return;
 }
 if(!(await switchUiModel(config.modelPath||DEFAULT_TARGET,config.modelPath||scene)))return;
 state.activeUiState=scene;
 state.mode="preview";
 state.previewScene=scene;
 selectStateRoot(scene);
 syncToolbarFromState();
 renderAll();
 savePrefs();
 toast((config.label||scene)+" · authored Roblox UI");
}
function isPreview(){return !!state.activeUiState}
function parentName(n){return findParent(n.__id)?.Name||""}
function previewVisible(n){
 if(!state.activeUiState)return n===state.root?true:false;
 const focus=findStateRoot(state.activeUiState);
 if(!focus)return null;
 if(n===focus)return true;

 let current=n;
 while(current){
  if(current===focus)return true;
  current=current.__id?findParent(current.__id):null;
 }

 current=focus;
 while(current){
  if(current===n)return true;
  current=current.__id?findParent(current.__id):null;
 }
 return false;
}
function previewText(){return null}
function previewImage(){return null}
function previewSize(){return null}
function injectRuntimePreview(){/* Project-defined UI states show authored Roblox instances only. */}

function setZoom(value,save=true){
 state.zoom=clamp(value,ZOOM_MIN,ZOOM_MAX);
 $("#zoomRange").value=Math.round(state.zoom*100);
 $("#zoomLabel").textContent=Math.round(state.zoom*100)+"%";
 renderAll();
 if(save){
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer=setTimeout(()=>{zoomSaveTimer=null;savePrefs()},120);
 }
}
function zoomAtClientPoint(nextZoom,clientX,clientY){
 const oldZoom=state.zoom||1;
 nextZoom=clamp(nextZoom,ZOOM_MIN,ZOOM_MAX);
 if(Math.abs(nextZoom-oldZoom)<.0001)return;
 const rect=els.stageScroller.getBoundingClientRect();
 const pointerX=clientX-rect.left,pointerY=clientY-rect.top;
 const deviceLeft=els.device.offsetLeft,deviceTop=els.device.offsetTop;
 const worldX=(els.stageScroller.scrollLeft+pointerX-deviceLeft)/oldZoom;
 const worldY=(els.stageScroller.scrollTop+pointerY-deviceTop)/oldZoom;
 setZoom(nextZoom);
 requestAnimationFrame(()=>{
  els.stageScroller.scrollLeft=els.device.offsetLeft+worldX*nextZoom-pointerX;
  els.stageScroller.scrollTop=els.device.offsetTop+worldY*nextZoom-pointerY;
 });
}
function fitViewport(){
 const pad=128,w=Math.max(100,els.stageScroller.clientWidth-pad),h=Math.max(100,els.stageScroller.clientHeight-pad);
 setZoom(Math.min(w/state.viewport.w,h/state.viewport.h,ZOOM_MAX));
 els.stageScroller.scrollLeft=0;els.stageScroller.scrollTop=0;
 toast("Viewport вписан в рабочую область");
}
function focusSelected(){
 const n=selected();if(!n)return;
 const el=els.guiRoot.querySelector(`[data-id="${n.__id}"]`);
 if(!el){toast("Выбранный объект сейчас не отображается",true);return}
 el.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
}
function copySelectedObject(){
 const n=selected();if(!n||n===state.root)return;
 state.clipboard=stripNode(n);toast(n.Name+" скопирован");
}
function pasteObject(){
 if(!state.clipboard)return toast("Буфер объектов пуст",true);
 let parent=selected();
 if(!parent||!CONTAINERS.has(parent.ClassName))parent=findParent(state.selectedId)||state.root;
 if(parent===state.root){const safe=(state.root.Children||[]).find(x=>x.Name==="SafeRoot");if(safe)parent=safe}
 pushHistory();
 const copy=normalizeNode(deepClone(state.clipboard));copy.Name=uniqueName(copy.Name||copy.ClassName);
 const pos=u2v(copy,"Position");pos[0][1]+=12;pos[1][1]+=12;copy.Properties.Position={UDim2:pos};
 parent.Children=parent.Children||[];parent.Children.push(copy);state.selectedId=copy.__id;state.selectedIds=new Set([copy.__id]);state.selectionAnchorId=copy.__id;changed();toast(copy.Name+" вставлен");
}
function renameSelected(){
 const n=selected();if(!n)return;
 const value=prompt("Имя Roblox Instance:",n.Name);if(value==null)return;
 const name=value.trim();if(!name||name===n.Name)return;
 pushHistory();n.Name=name;changed();
}


const GEOM_TOLERANCE=6;
function localRect(el){
 if(!el)return null;
 const dr=els.device.getBoundingClientRect(),rr=el.getBoundingClientRect(),z=state.zoom||1;
 const left=(rr.left-dr.left)/z,top=(rr.top-dr.top)/z,w=rr.width/z,h=rr.height/z;
 return {left,top,right:left+w,bottom:top+h,w,h,cx:left+w/2,cy:top+h/2};
}
function renderGeometryBase(){
 const g=els.geometry;if(!g)return;
 g.innerHTML="";g.classList.toggle("off",!state.geometry);
 if(!state.geometry)return;
 const corner=document.createElement("div");corner.className="geom-corner";g.appendChild(corner);
 const top=document.createElement("div");top.className="geom-ruler top";
 const left=document.createElement("div");left.className="geom-ruler left";
 const step=state.viewport.w>=1800?200:100;
 for(let x=0;x<=state.viewport.w;x+=step){
  const t=document.createElement("span");t.className="geom-tick";t.style.left=x+"px";t.textContent=x;top.appendChild(t)
 }
 for(let y=0;y<=state.viewport.h;y+=step){
  const t=document.createElement("span");t.className="geom-tick";t.style.top=y+"px";t.textContent=y;left.appendChild(t)
 }
 g.appendChild(top);g.appendChild(left);
 const vx=document.createElement("div");vx.className="geom-axis vertical";vx.style.left=(state.viewport.w/2)+"px";g.appendChild(vx);
 const hy=document.createElement("div");hy.className="geom-axis horizontal";hy.style.top=(state.viewport.h/2)+"px";g.appendChild(hy);
 if(state.inset>0){
  const safe=document.createElement("div");safe.className="geom-safe";safe.style.top=state.inset+"px";safe.innerHTML="<span>Inset "+state.inset+"px</span>";g.appendChild(safe)
 }
}
function clearSmartGuides(){
 if(!els.geometry)return;
 els.geometry.querySelectorAll(".geom-smart").forEach(x=>x.remove());
}
function showSmartGuides(xInfo,yInfo){
 if(!state.geometry||!els.geometry)return;
 clearSmartGuides();
 if(xInfo){
  const l=document.createElement("div");l.className="geom-smart vertical";l.style.left=xInfo.value+"px";
  l.innerHTML='<span class="geom-guide-label">'+esc(xInfo.label||Math.round(xInfo.value)+"px")+'</span>';els.geometry.appendChild(l)
 }
 if(yInfo){
  const l=document.createElement("div");l.className="geom-smart horizontal";l.style.top=yInfo.value+"px";
  l.innerHTML='<span class="geom-guide-label">'+esc(yInfo.label||Math.round(yInfo.value)+"px")+'</span>';els.geometry.appendChild(l)
 }
}
function addMeasureLine(x1,y1,x2,y2,label){
 if(!els.geometry)return;
 const line=document.createElement("div"),lab=document.createElement("div");
 const horizontal=Math.abs(y2-y1)<=Math.abs(x2-x1);
 line.className="geom-measure-line "+(horizontal?"horizontal":"vertical");
 if(horizontal){line.style.left=Math.min(x1,x2)+"px";line.style.top=y1+"px";line.style.width=Math.abs(x2-x1)+"px"}
 else{line.style.left=x1+"px";line.style.top=Math.min(y1,y2)+"px";line.style.height=Math.abs(y2-y1)+"px"}
 lab.className="geom-measure-label";lab.textContent=Math.max(0,Math.round(label))+" px";
 lab.style.left=((x1+x2)/2)+"px";lab.style.top=((y1+y2)/2)+"px";
 els.geometry.appendChild(line);els.geometry.appendChild(lab)
}
function updateGeometrySelection(){
 if(!els.geometry)return;
 els.geometry.querySelectorAll(".geom-measure-line,.geom-measure-label,.geom-size-badge,.geom-group-box").forEach(x=>x.remove());
 if(!state.geometry)return;
 const moveRoots=selectedMoveRoots();
 if(moveRoots.length>1){
  const r=groupBounds(moveRoots);if(!r)return;
  const badge=document.createElement("div");badge.className="geom-size-badge geom-group-size";
  badge.textContent=Math.round(r.w)+" × "+Math.round(r.h)+" · "+moveRoots.length+" объектов";
  badge.style.left=(r.right+8)+"px";badge.style.top=(r.bottom+8)+"px";
  els.geometry.appendChild(badge);
  return;
 }
 const n=selected();if(!n||n===state.root||MODIFIERS.has(n.ClassName))return;
 const el=els.guiRoot.querySelector(`[data-id="${n.__id}"]`);if(!el||el.style.display==="none")return;
 const r=localRect(el),parent=findParent(n.__id);
 let pel=parent&&parent!==state.root?els.guiRoot.querySelector(`[data-id="${parent.__id}"]`):els.guiRoot;
 const pr=localRect(pel);if(!r||!pr)return;
 const badge=document.createElement("div");badge.className="geom-size-badge";badge.textContent=Math.round(r.w)+" × "+Math.round(r.h);
 const compact=r.w<=40||r.h<=40;
 badge.style.left=(compact?r.right+18:r.right+8)+"px";
 badge.style.top=(compact?r.cy:r.bottom+8)+"px";
 els.geometry.appendChild(badge);
 if(compact)return;
 const dl=Math.max(0,r.left-pr.left),dr=Math.max(0,pr.right-r.right),dt=Math.max(0,r.top-pr.top),db=Math.max(0,pr.bottom-r.bottom);
 if(dl>=4)addMeasureLine(pr.left,r.cy,r.left,r.cy,dl);
 if(dr>=4)addMeasureLine(r.right,r.cy,pr.right,r.cy,dr);
 if(dt>=4)addMeasureLine(r.cx,pr.top,r.cx,r.top,dt);
 if(db>=4)addMeasureLine(r.cx,r.bottom,r.cx,pr.bottom,db);
}
function collectGuideTargets(n){
 const el=els.guiRoot.querySelector(`[data-id="${n.__id}"]`);if(!el)return null;
 const base=localRect(el),parent=findParent(n.__id);
 let pel=parent&&parent!==state.root?els.guiRoot.querySelector(`[data-id="${parent.__id}"]`):els.guiRoot;
 const pr=localRect(pel);if(!base||!pr)return null;
 const xs=[
  {value:pr.left,label:"Parent L"},{value:pr.cx,label:"Parent CX"},{value:pr.right,label:"Parent R"},
  {value:state.viewport.w/2,label:"Viewport CX"}
 ];
 const ys=[
  {value:pr.top,label:"Parent T"},{value:pr.cy,label:"Parent CY"},{value:pr.bottom,label:"Parent B"},
  {value:state.viewport.h/2,label:"Viewport CY"}
 ];
 for(const s of parent?.Children||[]){
  if(s===n||MODIFIERS.has(s.ClassName))continue;
  const se=els.guiRoot.querySelector(`[data-id="${s.__id}"]`);if(!se||se.style.display==="none")continue;
  const r=localRect(se);if(!r)continue;
  xs.push({value:r.left,label:s.Name+" L"},{value:r.cx,label:s.Name+" CX"},{value:r.right,label:s.Name+" R"});
  ys.push({value:r.top,label:s.Name+" T"},{value:r.cy,label:s.Name+" CY"},{value:r.bottom,label:s.Name+" B"});
 }
 return {base,xs,ys};
}

function groupBounds(nodes){
 const rects=nodes.map(n=>localRect(els.guiRoot.querySelector(`[data-id="${n.__id}"]`))).filter(Boolean);
 if(!rects.length)return null;
 const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));
 const right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
 return {left,top,right,bottom,w:right-left,h:bottom-top,cx:(left+right)/2,cy:(top+bottom)/2};
}
function collectGroupGuideTargets(nodes){
 const base=groupBounds(nodes);if(!base)return null;
 const selectedSet=new Set(nodes.map(n=>n.__id));
 const xs=[
  {value:0,label:"Viewport L"},{value:state.viewport.w/2,label:"Viewport CX"},{value:state.viewport.w,label:"Viewport R"}
 ];
 const ys=[
  {value:0,label:"Viewport T"},{value:state.viewport.h/2,label:"Viewport CY"},{value:state.viewport.h,label:"Viewport B"}
 ];
 const parentIds=new Set();
 for(const n of nodes){
  const p=findParent(n.__id);if(!p||parentIds.has(p.__id))continue;parentIds.add(p.__id);
  const pel=p===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${p.__id}"]`);
  const pr=localRect(pel);if(!pr)continue;
  xs.push({value:pr.left,label:"Parent L"},{value:pr.cx,label:"Parent CX"},{value:pr.right,label:"Parent R"});
  ys.push({value:pr.top,label:"Parent T"},{value:pr.cy,label:"Parent CY"},{value:pr.bottom,label:"Parent B"});
  for(const s of p.Children||[]){
   if(selectedSet.has(s.__id)||MODIFIERS.has(s.ClassName))continue;
   const se=els.guiRoot.querySelector(`[data-id="${s.__id}"]`);if(!se||se.style.display==="none")continue;
   const r=localRect(se);if(!r)continue;
   xs.push({value:r.left,label:s.Name+" L"},{value:r.cx,label:s.Name+" CX"},{value:r.right,label:s.Name+" R"});
   ys.push({value:r.top,label:s.Name+" T"},{value:r.cy,label:s.Name+" CY"},{value:r.bottom,label:s.Name+" B"});
  }
 }
 return {base,xs,ys};
}

function nearestGuide(candidates,targets){
 let best=null;
 for(const c of candidates)for(const t of targets){
  const delta=t.value-c.value,ad=Math.abs(delta);
  if(ad<=GEOM_TOLERANCE&&(!best||ad<best.ad))best={delta,ad,target:t,candidate:c}
 }
 return best;
}
function smartSnapMove(geom,rx,ry){
 if(!state.geometry||!geom)return {rx,ry,x:null,y:null};
 const b=geom.base;
 const bx=nearestGuide([{value:b.left+rx},{value:b.cx+rx},{value:b.right+rx}],geom.xs);
 const by=nearestGuide([{value:b.top+ry},{value:b.cy+ry},{value:b.bottom+ry}],geom.ys);
 if(bx)rx+=bx.delta;if(by)ry+=by.delta;
 return {rx,ry,x:bx?.target||null,y:by?.target||null};
}
function smartSnapResize(d,rx,ry){
 if(!state.geometry||!d.geometry)return {rx,ry,x:null,y:null};
 let bx=null,by=null,b=d.geometry.base;
 if(d.dir.includes("e"))bx=nearestGuide([{value:b.right+rx}],d.geometry.xs);
 else if(d.dir.includes("w"))bx=nearestGuide([{value:b.left+rx}],d.geometry.xs);
 if(d.dir.includes("s"))by=nearestGuide([{value:b.bottom+ry}],d.geometry.ys);
 else if(d.dir.includes("n"))by=nearestGuide([{value:b.top+ry}],d.geometry.ys);
 if(bx)rx+=bx.delta;if(by)ry+=by.delta;
 return {rx,ry,x:bx?.target||null,y:by?.target||null};
}
function alignSelected(mode){
 const n=selected();if(!n||n===state.root||MODIFIERS.has(n.ClassName))return;
 const el=els.guiRoot.querySelector(`[data-id="${n.__id}"]`);if(!el)return;
 const r=localRect(el),a=v2v(n,"AnchorPoint",[0,0]),p=deepClone(u2v(n,"Position"));
 const map={
  tl:["left","top"],tc:["center","top"],tr:["right","top"],
  ml:["left","middle"],mc:["center","middle"],mr:["right","middle"],
  bl:["left","bottom"],bc:["center","bottom"],br:["right","bottom"]
 };
 const target=map[mode];if(!target)return;
 pushHistory();
 const x=m=>{if(m==="left")p[0]=[0,roundOffset(a[0]*r.w)];if(m==="center")p[0]=[.5,roundOffset((a[0]-.5)*r.w)];if(m==="right")p[0]=[1,roundOffset((a[0]-1)*r.w)]};
 const y=m=>{if(m==="top")p[1]=[0,roundOffset(a[1]*r.h)];if(m==="middle")p[1]=[.5,roundOffset((a[1]-.5)*r.h)];if(m==="bottom")p[1]=[1,roundOffset((a[1]-1)*r.h)]};
 x(target[0]);y(target[1]);
 n.Properties.Position={UDim2:p};changed();
}

function siblingGuiObjects(n){
 const parent=n&&findParent(n.__id);if(!parent)return [];
 return (parent.Children||[]).filter(c=>!MODIFIERS.has(c.ClassName)&&c!==undefined);
}
function tidySiblings(columns=3,gap=8){
 const n=selected();if(!n||n===state.root||MODIFIERS.has(n.ClassName))return;
 const parent=findParent(n.__id);if(!parent)return;
 const parentEl=parent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${parent.__id}"]`);
 const pr=localRect(parentEl);if(!pr)return;

 const siblings=siblingGuiObjects(n).filter(c=>{
  const el=els.guiRoot.querySelector(`[data-id="${c.__id}"]`);
  return el&&el.style.display!=="none";
 });
 if(siblings.length<2){toast("Недостаточно соседних объектов для Tidy",true);return}

 // One undo for the whole tidy operation, including automatic layout baking.
 pushHistory();
 if(isLayoutParent(parent))bakeLayout(parent,{record:false,render:false,notify:false});

 const data=siblings.map(c=>{
  const el=els.guiRoot.querySelector(`[data-id="${c.__id}"]`);
  const r=localRect(el);
  return {c,r};
 }).filter(x=>x.r);

 if(data.length<2)return;
 data.sort((a,b)=>a.r.top-b.r.top||a.r.left-b.r.left);

 columns=Math.max(1,Math.min(columns,data.length));
 gap=Math.max(0,Math.round(gap));

 // localRect() is viewport-relative; Roblox Position must be parent-relative.
 // Preserve the group's current top-left inside its parent instead of teleporting it.
 const startX=Math.max(0,Math.min(...data.map(x=>x.r.left))-pr.left);
 const startY=Math.max(0,Math.min(...data.map(x=>x.r.top))-pr.top);

 const colW=Array(columns).fill(0);
 for(let i=0;i<data.length;i++)colW[i%columns]=Math.max(colW[i%columns],data[i].r.w);

 const rows=Math.ceil(data.length/columns);
 const rowH=Array(rows).fill(0);
 for(let i=0;i<data.length;i++)rowH[Math.floor(i/columns)]=Math.max(rowH[Math.floor(i/columns)],data[i].r.h);

 const colX=[];let x=startX;
 for(let i=0;i<columns;i++){colX[i]=x;x+=colW[i]+gap}
 const rowY=[];let y=startY;
 for(let i=0;i<rows;i++){rowY[i]=y;y+=rowH[i]+gap}

 for(let i=0;i<data.length;i++){
  const {c,r}=data[i],col=i%columns,row=Math.floor(i/columns),a=v2v(c,"AnchorPoint",[0,0]);
  c.Properties=c.Properties||{};
  c.Properties.Position={UDim2:[
   [0,roundOffset(colX[col]+a[0]*r.w)],
   [0,roundOffset(rowY[row]+a[1]*r.h)]
  ]};
 }

 // Tidy is a batch operation: keep the arranged set selected so it can be moved immediately.
 const fitParent=$("#tidyFitParent")?.checked!==false;
 if(fitParent){
  renderViewport();
  fitParentToChildren(parent,gap);
 }
 state.selectedIds=new Set(data.map(x=>x.c.__id));
 state.selectedId=n.__id;
 state.selectionAnchorId=data[0].c.__id;
 markDirty();
 revealTreePath(state.selectedId);
 renderAll();
 scrollTreeToSelected();
 toast(`Tidy: ${data.length} объектов · ${columns} кол. · gap ${gap}px${fitParent?" · parent fitted":""} · группа выделена`);
}
function distributeSiblings(axis="x",gap=8){
 const n=selected();if(!n||n===state.root||MODIFIERS.has(n.ClassName))return;
 const parent=findParent(n.__id);if(!parent)return;
 const parentEl=parent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${parent.__id}"]`);
 const pr=localRect(parentEl);if(!pr)return;

 pushHistory();
 if(isLayoutParent(parent))bakeLayout(parent,{record:false,render:false,notify:false});

 const data=siblingGuiObjects(n).map(c=>{
  const el=els.guiRoot.querySelector(`[data-id="${c.__id}"]`);
  return {c,r:localRect(el)};
 }).filter(x=>x.r&&els.guiRoot.querySelector(`[data-id="${x.c.__id}"]`)?.style.display!=="none");
 if(data.length<2){toast("Недостаточно соседних объектов",true);return}

 gap=Math.max(0,Math.round(gap));
 data.sort((a,b)=>axis==="x"?a.r.left-b.r.left:a.r.top-b.r.top);
 let cursor=(axis==="x"?data[0].r.left-pr.left:data[0].r.top-pr.top);

 for(const {c,r} of data){
  const a=v2v(c,"AnchorPoint",[0,0]),p=deepClone(u2v(c,"Position"));
  if(axis==="x"){
   p[0]=[0,roundOffset(cursor+a[0]*r.w)];
   cursor+=r.w+gap;
  }else{
   p[1]=[0,roundOffset(cursor+a[1]*r.h)];
   cursor+=r.h+gap;
  }
  c.Properties.Position={UDim2:p};
 }

 state.selectedIds=new Set(data.map(x=>x.c.__id));
 state.selectedId=n.__id;
 state.selectionAnchorId=data[0].c.__id;
 markDirty();
 revealTreePath(state.selectedId);
 renderAll();
 scrollTreeToSelected();
 toast((axis==="x"?"Горизонтальный":"Вертикальный")+" gap = "+gap+"px · группа выделена");
}


function fitParentToChildren(parent,pad=8){
 if(!parent||parent===state.root||MODIFIERS.has(parent.ClassName))return false;
 const pel=els.guiRoot.querySelector(`[data-id="${parent.__id}"]`);if(!pel)return false;
 const pr=localRect(pel);if(!pr)return false;
 const kids=(parent.Children||[]).filter(c=>!MODIFIERS.has(c.ClassName)).map(c=>{
  const el=els.guiRoot.querySelector(`[data-id="${c.__id}"]`);
  return {c,r:localRect(el)};
 }).filter(x=>x.r&&els.guiRoot.querySelector(`[data-id="${x.c.__id}"]`)?.style.display!=="none");
 if(!kids.length)return false;

 pad=Math.max(0,roundOffset(pad));
 const left=Math.min(...kids.map(x=>x.r.left))-pad;
 const top=Math.min(...kids.map(x=>x.r.top))-pad;
 const right=Math.max(...kids.map(x=>x.r.right))+pad;
 const bottom=Math.max(...kids.map(x=>x.r.bottom))+pad;

 const parentParent=findParent(parent.__id);
 const ppEl=parentParent&&parentParent!==state.root?els.guiRoot.querySelector(`[data-id="${parentParent.__id}"]`):els.guiRoot;
 const ppr=localRect(ppEl);if(!ppr)return false;

 const a=v2v(parent,"AnchorPoint",[0,0]);
 const w=Math.max(1,right-left),h=Math.max(1,bottom-top);

 // Keep children visually fixed: move parent to the new top-left, then convert child coordinates.
 const childRects=kids.map(x=>({c:x.c,r:x.r}));
 parent.Properties=parent.Properties||{};
 parent.Properties.Size={UDim2:[[0,roundOffset(w)],[0,roundOffset(h)]]};
 parent.Properties.Position={UDim2:[
  [0,roundOffset(left-ppr.left+a[0]*w)],
  [0,roundOffset(top-ppr.top+a[1]*h)]
 ]};

 for(const {c,r} of childRects){
  const ca=v2v(c,"AnchorPoint",[0,0]);
  c.Properties=c.Properties||{};
  c.Properties.Position={UDim2:[
   [0,roundOffset(r.left-left+ca[0]*r.w)],
   [0,roundOffset(r.top-top+ca[1]*r.h)]
  ]};
 }
 return true;
}
function fitSelectedParent(){
 const n=selected();if(!n)return;
 const parent=findParent(n.__id);if(!parent||parent===state.root){toast("У выбранного объекта нет подходящего Frame-родителя",true);return}
 pushHistory();
 if(fitParentToChildren(parent,8)){
  state.selectedId=parent.__id;state.selectedIds=new Set([parent.__id]);state.selectionAnchorId=parent.__id;
  markDirty();renderAll();finishSelection();toast(parent.Name+" подогнан под содержимое");
 }else{
  state.history.pop();toast("Не удалось подогнать родителя",true);
 }
}

function geometryInspectorGroup(){
 const n=selected(),parent=n&&findParent(n.__id),managed=isLayoutParent(parent);
 return group("GEOMETRY",[
  '<div class="align-tools align-grid-3x3">'+
   '<button data-align="tl" title="Левый верхний угол">↖</button>'+
   '<button data-align="tc" title="По центру сверху">↑</button>'+
   '<button data-align="tr" title="Правый верхний угол">↗</button>'+
   '<button data-align="ml" title="Слева по центру">←</button>'+
   '<button data-align="mc" title="Точно по центру">●</button>'+
   '<button data-align="mr" title="Справа по центру">→</button>'+
   '<button data-align="bl" title="Левый нижний угол">↙</button>'+
   '<button data-align="bc" title="По центру снизу">↓</button>'+
   '<button data-align="br" title="Правый нижний угол">↘</button>'+
  '</div>'+
  '<div class="arrange-box">'+
   '<div class="arrange-row"><label>Columns <input id="arrangeColumns" type="number" min="1" max="12" value="3"></label><label>Gap <input id="arrangeGap" type="number" min="0" max="100" value="8"></label></div>'+
   '<label class="arrange-check"><input id="tidyFitParent" type="checkbox" checked> Fit parent after Tidy</label>'+
   '<button class="btn arrange-primary" id="tidyBtn">TIDY SIBLINGS</button>'+
   '<div class="arrange-row buttons"><button class="btn" id="spaceXBtn">SPACE X</button><button class="btn" id="spaceYBtn">SPACE Y</button></div>'+
   '<button class="btn" id="fitParentBtn">FIT PARENT TO CHILDREN</button>'+
  '</div>'+
  (managed?'<button class="btn free-layout-btn" id="freeLayoutBtn">FREE TRANSFORM · удалить Layout</button>':'')+
  '<div class="align-help">Tidy аккуратно раскладывает соседние элементы, но не создаёт Layout — после этого каждый объект остаётся полностью свободным. Smart snap работает при drag/resize. Alt временно отключает магнит.</div>'
 ]);
}

function hasDrawableGui(){
 let count=0;
 walk(state.root,n=>{
  if(n===state.root||MODIFIERS.has(n.ClassName))return;
  if(n.ClassName==="Frame"&&n.Name==="SafeRoot")return;
  if(state.showHidden||n.Properties?.Visible!==false)count++;
 });
 return count>0;
}
function updateEmptyCanvas(){
 const box=$("#emptyCanvas");if(!box)return;
 box.classList.toggle("hidden",!!state.activeUiState);
}
function renderAll(){
 if(state.suspended){updateStatus();return}
 renderViewport();renderTree();renderInspector();updateOverlay();updateStatus();updateEmptyCanvas();
}
function renderViewport(){
 if(!state.root)return;
 const fullW=state.viewport.w,fullH=state.viewport.h;
 els.device.style.width=fullW+"px";els.device.style.height=fullH+"px";
 els.device.style.transform=`scale(${state.zoom})`;
 $("#stage").style.width=(fullW*state.zoom+128)+"px";
 $("#stage").style.height=(fullH*state.zoom+128)+"px";
 $(".roblox-topbar").style.height=state.inset+"px";
 $(".roblox-topbar").style.display=state.inset>0?"flex":"none";
 const engine=ensureEngineV2();
 if(engine){
  els.guiRoot.style.top="0px";
  engine.render({
   root:state.root,viewport:state.viewport,zoom:state.zoom,inset:state.inset,
   showHidden:state.showHidden,labels:state.labels,selectedIds:state.selectedIds,
   activeUiState:state.activeUiState,previewScene:state.previewScene
  });
  renderGeometryBase();
  return;
 }
 els.guiRoot.style.top=state.inset+"px";
 els.guiRoot.innerHTML="";
 const children=state.root.ClassName==="ScreenGui"?state.root.Children:[state.root];
 for(const c of children) if(!MODIFIERS.has(c.ClassName)) renderGuiNode(c,els.guiRoot,null);
 renderGeometryBase();
}
function renderGuiNode(n,parentEl,parentNode){
 const el=document.createElement("div");el.className="gui-node";el.dataset.id=n.__id;el.dataset.class=n.ClassName;
 const p=n.Properties||{};
 const runtimeSize=previewSize(n);
 const renderSize=runtimeSize?{UDim2:runtimeSize}:(p.Size||u2(0,100,0,100));
 el.style.width=cssUDim2(renderSize,0);
 el.style.height=cssUDim2(renderSize,1);
 el.style.left=cssUDim2(p.Position||u2(),0);el.style.top=cssUDim2(p.Position||u2(),1);
 const ap=v2v(n,"AnchorPoint",[0,0]);const rot=finite(p.Rotation,0);
 el.style.transform=`translate(${-ap[0]*100}%,${-ap[1]*100}%) rotate(${rot}deg)`;
 el.style.transformOrigin=`${ap[0]*100}% ${ap[1]*100}%`;
 el.style.zIndex=finite(p.ZIndex,1);
 const runtimeHidden=p.Visible===false;
 const forcedVisible=previewVisible(n);
 if(forcedVisible===false)el.style.display="none";
 else if(forcedVisible===true)el.style.display="";
 else if(runtimeHidden&&!state.showHidden)el.style.display="none";
 else{
  el.style.display="";
  if(runtimeHidden)el.classList.add("runtime-hidden");
 }
 el.style.overflow=p.ClipsDescendants?"hidden":"visible";
 el.style.background=color(p.BackgroundColor3||[1,1,1],p.BackgroundTransparency??0);
 if(p.BorderSizePixel>0){el.style.border=`${p.BorderSizePixel}px solid ${color(p.BorderColor3||[0,0,0],0)}`}
 const corner=modifier(n,"UICorner");
 if(corner){const cr=udv(corner,"CornerRadius",[0,8]);el.style.borderRadius=cr[0]?`${clamp(cr[0]*100,0,50)}%`:`${roundOffset(cr[1])}px`}
 const stroke=modifier(n,"UIStroke");
 if(stroke){
  const sp=stroke.Properties||{},th=Math.max(0,finite(sp.Thickness,1)),sc=color(sp.Color||[0,0,0],sp.Transparency??0);
  el.style.boxShadow=sp.ApplyStrokeMode==="Contextual"?`0 0 0 ${th}px ${sc}`:`inset 0 0 0 ${th}px ${sc},0 0 0 ${Math.max(0,th-1)}px ${sc}`;
 }
 const padding=getPadding(n);
 if(TEXT_CLASSES.has(n.ClassName)){
  const t=document.createElement("span");t.className="gui-text";const runtimeText=previewText(n,parentNode);t.textContent=runtimeText??p.Text??"";if(padding)t.style.inset=`${padding.t}px ${padding.r}px ${padding.b}px ${padding.l}px`;
  t.style.color=color(p.TextColor3||[1,1,1],p.TextTransparency??0);t.style.fontSize=finite(p.TextSize,14)+"px";
  t.style.fontWeight=/Bold|Black/i.test(p.Font||"")?"700":"400";
  t.style.fontFamily=/Code/i.test(p.Font||"")?"Consolas,monospace":"Gotham,Montserrat,Segoe UI,Arial,sans-serif";
  t.style.justifyContent=({Left:"flex-start",Center:"center",Right:"flex-end"})[p.TextXAlignment]||"flex-start";
  t.style.alignItems=({Top:"flex-start",Center:"center",Bottom:"flex-end"})[p.TextYAlignment]||"center";
  t.style.textAlign=({Left:"left",Center:"center",Right:"right"})[p.TextXAlignment]||"left";
  t.style.whiteSpace=p.TextWrapped===false?"nowrap":"pre-wrap";
  if(p.TextStrokeTransparency<1)t.style.textShadow=`0 0 1px ${color(p.TextStrokeColor3||[0,0,0],p.TextStrokeTransparency??1)}`;
  el.appendChild(t);
 }
 if(IMAGE_CLASSES.has(n.ClassName)){
  const runtimeImage=previewImage(n,parentNode);const resolved=imageUrl(runtimeImage??p.Image??"");
  if(resolved){
   const img=document.createElement("img");img.className="gui-image";img.draggable=false;
   let retry=0;
   const setSource=()=>{
    if(ROFLOW_NATIVE&&resolved.startsWith("roflow-asset:")){
     const assetId=resolved.slice("roflow-asset:".length);
     nativeThumbnail(assetId).then(url=>{if(url)img.src=url});
     return;
    }
    const sep=resolved.includes("?")?"&":"?";
    img.src=retry===0?resolved:`${resolved}${sep}retry=${Date.now()}_${retry}`;
   };
   img.onerror=()=>{
    if(retry>=4)return;
    retry+=1;
    setTimeout(setSource,180*retry);
   };
   setSource();
   img.style.opacity=1-clamp(finite(p.ImageTransparency,0),0,1);img.style.objectFit=p.ScaleType==="Crop"?"cover":p.ScaleType==="Stretch"?"fill":"contain";
   if(p.ImageColor3)img.style.filter="none";el.appendChild(img);
  }
 }
 if(state.labels){
  const tag=document.createElement("div");tag.className="node-tag";tag.textContent=`${n.Name} · ${n.ClassName}`;el.appendChild(tag)
 }
 if(isSelectedId(n.__id)){
   el.classList.add("multi-selected");
   if(n.__id===state.selectedId)el.classList.add("selected","primary-selected");
  }
 el.addEventListener("pointerdown",ev=>startMove(ev,n));
 el.addEventListener("click",ev=>ev.stopPropagation());
 parentEl.appendChild(el);

 const list=modifier(n,"UIListLayout"),grid=modifier(n,"UIGridLayout");
 let childHost=el;
 // Roblox UIPadding affects the parent's own content (for example Text)
 // and the content region used by layouts. It must NOT offset ordinary,
 // manually-positioned child GuiObjects such as RollButton.Icon.
 if(list||grid){
  childHost=document.createElement("div");
  childHost.className="layout-host "+(list?"list-layout":"grid-layout");
  if(padding){
   childHost.style.left=padding.l+"px";childHost.style.right=padding.r+"px";
   childHost.style.top=padding.t+"px";childHost.style.bottom=padding.b+"px";
  }
  el.appendChild(childHost);
 }
 if(list){
  childHost.style.flexDirection=prop(list,"FillDirection","Vertical")==="Horizontal"?"row":"column";
  const gap=udv(list,"Padding",[0,0]);childHost.style.gap=roundOffset(gap[1])+"px";
  childHost.style.alignItems=({Left:"flex-start",Center:"center",Right:"flex-end"})[prop(list,"HorizontalAlignment","Left")]||"stretch";
 }
 if(grid){
  const cs=u2v(grid,"CellSize",u2(0,64,0,64)),cp=u2v(grid,"CellPadding",u2(0,6,0,6));
  childHost.style.gridTemplateColumns=`repeat(auto-fill,${Math.max(1,roundOffset(cs[0][1]))}px)`;
  childHost.style.gridAutoRows=Math.max(1,roundOffset(cs[1][1]))+"px";
  childHost.style.columnGap=roundOffset(cp[0][1])+"px";childHost.style.rowGap=roundOffset(cp[1][1])+"px";
 }
 for(const c of layoutChildNodes(n)){
  const child=renderGuiNode(c,childHost,n);
  if((list||grid)&&child)child.classList.add("layout-child");
 }
 injectRuntimePreview(n,el,parentNode);
 return el;
}
els.guiRoot.addEventListener("pointerdown",ev=>{if(ev.target===els.guiRoot)select(state.root.__id,false)});

function activeStateTreeIds(){
 const ids=new Set();
 if(!state.root||!state.activeUiState)return ids;
 const visit=(n,parentVisible)=>{
  const forced=previewVisible(n);
  const visible=n===state.root?true:(forced===true?true:forced===false?false:parentVisible);
  if(!visible)return;
  ids.add(n.__id);
  for(const child of n.Children||[])visit(child,visible);
 };
 visit(state.root,true);
 return ids;
}

function renderTree(){
 els.tree.innerHTML="";if(!state.root)return;
 if(!state.activeUiState){
  els.tree.innerHTML='<div class="tree-empty"><strong>No UI State open</strong><span>Choose a state from the left rail to edit its Roblox instances.</span></div>';
  $("#treeSearchMeta").textContent="";
  return;
 }
 const stateIds=activeStateTreeIds();
 const q=state.treeQuery.trim().toLowerCase();
 const matched=new Set(),ancestors=new Set();
 if(q){
  const scan=(n,path=[])=>{
   if(!stateIds.has(n.__id))return;
   const next=[...path,n];
   if((n.Name+" "+n.ClassName).toLowerCase().includes(q)){matched.add(n.__id);for(const a of path)ancestors.add(a.__id)}
   for(const c of n.Children||[])scan(c,next);
  };scan(state.root);
 }
 let shown=0;
 const recur=(n,depth)=>{
  if(!stateIds.has(n.__id))return;
  if(q&&!matched.has(n.__id)&&!ancestors.has(n.__id))return;
  shown++;
  const row=document.createElement("div");row.className="tree-row"+(isSelectedId(n.__id)?" selected":"")+(n.__id===state.selectedId?" primary-selected":"")+(MODIFIERS.has(n.ClassName)?" modifier":"")+(n.Properties?.Visible===false?" runtime-hidden":"")+(matched.has(n.__id)?" search-match":"");
  const kids=n.Children||[],collapsed=state.collapsed.has(n.__id)&&!q;
  row.dataset.id=n.__id;
  row.draggable=n!==state.root;
  row.innerHTML=`<span class="tree-indent" style="width:${depth*13}px"></span><span class="tree-toggle">${kids.length?(collapsed?"▸":"▾"):""}</span><span class="tree-icon">${classIcon(n.ClassName)}</span><span class="tree-name"></span><span class="tree-kind"></span>`;
  row.querySelector(".tree-name").textContent=n.Name;row.querySelector(".tree-kind").textContent=n.ClassName;
  row.querySelector(".tree-toggle").onclick=e=>{e.stopPropagation();collapsed?state.collapsed.delete(n.__id):state.collapsed.add(n.__id);renderTree()};
  row.ondblclick=e=>{e.preventDefault();select(n.__id,false);renameSelected()};
  row.onclick=e=>{
   if(e.shiftKey)selectTreeRange(n.__id,e.ctrlKey||e.metaKey);
   else select(n.__id,e.ctrlKey||e.metaKey);
  };
  row.addEventListener("dragstart",e=>{
   if(n===state.root){e.preventDefault();return}
   if(!isSelectedId(n.__id))select(n.__id,false);
   state.treeDragIds=selectedMoveRoots().map(x=>x.__id);
   row.classList.add("dragging");
   e.dataTransfer.effectAllowed="move";
   try{e.dataTransfer.setData("text/plain",n.__id)}catch{}
  });
  row.addEventListener("dragend",()=>{
   state.treeDragIds=[];row.classList.remove("dragging");
   els.tree.querySelectorAll(".drop-target").forEach(x=>x.classList.remove("drop-target"));
  });
  row.addEventListener("dragover",e=>{
   if(!state.treeDragIds.length)return;
   const target=treeDropTargetFromRow(row);if(!target)return;
   const moving=state.treeDragIds.map(findNode).filter(Boolean);
   if(moving.some(x=>x===target||isAncestorOf(x,target)))return;
   e.preventDefault();e.dataTransfer.dropEffect="move";row.classList.add("drop-target");
  });
  row.addEventListener("dragleave",()=>row.classList.remove("drop-target"));
  row.addEventListener("drop",e=>{
   e.preventDefault();row.classList.remove("drop-target");
   const target=treeDropTargetFromRow(row);if(!target)return;
   const moving=state.treeDragIds.map(findNode).filter(Boolean);
   state.treeDragIds=[];
   reparentPreserve(moving,target);
  });
  els.tree.appendChild(row);
  if(!collapsed)for(const c of kids)recur(c,depth+1);
 };
 recur(state.root,0);
 $("#treeSearchMeta").textContent=q?(matched.size?matched.size+" совпад.":"Ничего не найдено"):"";
}
function classIcon(k){return ({ScreenGui:"▱",Frame:"▣",TextLabel:"T",TextButton:"▤",ImageLabel:"◈",ImageButton:"◇",ScrollingFrame:"↕",UICorner:"◜",UIStroke:"□",UIListLayout:"☷",UIGridLayout:"▦",UIPadding:"↔"})[k]||"·"}

function revealTreePath(id){
 let p=findParent(id);
 while(p){state.collapsed.delete(p.__id);p=findParent(p.__id)}
}
function scrollTreeToSelected(){
 requestAnimationFrame(()=>{
  const row=els.tree.querySelector(`.tree-row[data-id="${state.selectedId}"]`);
  if(row)row.scrollIntoView({block:"nearest",inline:"nearest"});
 });
}
function finishSelection(){
 if(state.selectedId)revealTreePath(state.selectedId);
 renderTree();renderInspector();updateOverlay();updateStatus();
 if(state.selectedId)scrollTreeToSelected();
}
function select(id,additive=false){
 if(!findNode(id))return;
 if(additive){
  if(state.selectedIds.has(id)){
   state.selectedIds.delete(id);
   if(state.selectedId===id){
    const next=[...state.selectedIds].pop();
    state.selectedId=next||null;
   }
  }else{
   state.selectedIds.add(id);
   state.selectedId=id;
  }
  state.selectionAnchorId=id;
 }else{
  state.selectedIds=new Set([id]);
  state.selectedId=id;
  state.selectionAnchorId=id;
 }
 finishSelection();
}
function selectTreeRange(id,additive=false){
 if(!findNode(id))return;
 const rows=[...els.tree.querySelectorAll(".tree-row")];
 const ids=rows.map(r=>r.dataset.id);
 const anchor=state.selectionAnchorId||state.selectedId||id;
 const a=ids.indexOf(anchor),b=ids.indexOf(id);
 if(a<0||b<0){select(id,false);return}
 const lo=Math.min(a,b),hi=Math.max(a,b);
 if(!additive)state.selectedIds=new Set();
 for(let i=lo;i<=hi;i++)if(ids[i])state.selectedIds.add(ids[i]);
 state.selectedId=id;
 // Keep the original anchor so repeated Shift-click behaves like Explorer/Figma.
 state.selectionAnchorId=anchor;
 finishSelection();
}
function selectAllSiblings(){
 const n=selected();if(!n)return;
 const p=findParent(n.__id);if(!p)return;
 const ids=(p.Children||[]).filter(c=>!MODIFIERS.has(c.ClassName)).map(c=>c.__id);
 if(!ids.length)return;
 state.selectedIds=new Set(ids);
 state.selectedId=n.__id;
 state.selectionAnchorId=n.__id;
 finishSelection();
 toast(ids.length+" соседних объектов выбрано");
}
function collapseSelectionToPrimary(){
 const n=selected();if(!n)return;
 state.selectedIds=new Set([n.__id]);
 state.selectionAnchorId=n.__id;
 finishSelection();
}
function updateOverlay(){
 const roots=selectedMoveRoots();
 const n=selected();
 if(!n||n===state.root||MODIFIERS.has(n.ClassName)||!roots.length){els.overlay.classList.add("hidden");updateGeometrySelection();return}

 if(roots.length>1){
  const b=groupBounds(roots);
  if(!b){els.overlay.classList.add("hidden");updateGeometrySelection();return}
  els.overlay.classList.remove("hidden");
  els.overlay.classList.add("multi-group");
  els.overlay.classList.remove("precision-small");
  els.overlay.style.left=b.left+"px";els.overlay.style.top=b.top+"px";
  els.overlay.style.width=b.w+"px";els.overlay.style.height=b.h+"px";
  els.overlay.querySelector(".sel-caption").textContent=`${roots.length} объектов · GROUP · ${Math.round(b.w)}×${Math.round(b.h)}`;
  updateGeometrySelection();
  return;
 }

 const nodeEl=els.guiRoot.querySelector(`[data-id="${n.__id}"]`);if(!nodeEl||nodeEl.style.display==="none"){els.overlay.classList.add("hidden");updateGeometrySelection();return}
 const dr=els.device.getBoundingClientRect(),rr=nodeEl.getBoundingClientRect(),z=state.zoom;
 els.overlay.classList.remove("hidden");
 els.overlay.classList.remove("multi-group");
 els.overlay.style.left=((rr.left-dr.left)/z)+"px";els.overlay.style.top=((rr.top-dr.top)/z)+"px";
 els.overlay.style.width=(rr.width/z)+"px";els.overlay.style.height=(rr.height/z)+"px";
 const lr=localRect(nodeEl);
 const compact=lr.w<=40||lr.h<=40;
 els.overlay.classList.toggle("precision-small",compact);
 els.overlay.querySelector(".sel-caption").textContent=`${n.Name} · ${n.ClassName} · X ${Math.round(lr.left)} Y ${Math.round(lr.top)} · ${Math.round(lr.w)}×${Math.round(lr.h)}`;
 updateGeometrySelection();
}


function hasGuiChildren(n){
 return (n?.Children||[]).some(c=>!MODIFIERS.has(c.ClassName));
}
function visibilityHelpGroup(n){
 if(!n||n.ClassName==="ScreenGui"||MODIFIERS.has(n.ClassName)||!hasGuiChildren(n))return "";
 if(prop(n,"Visible",true)!==false)return "";
 return group("VISIBILITY WARNING",[
  '<div class="visibility-warning">В Roblox <b>Visible = false</b> скрывает этот объект и всех его GUI-детей. Если нужен невидимый контейнер, оставь Visible включённым и сделай фон прозрачным.</div>'+
  '<button id="childrenVisibleBtn" class="btn visibility-fix-btn">СКРЫТЬ ФОН · ОСТАВИТЬ ДЕТЕЙ</button>'
 ]);
}

function renderInspector(){
 const n=selected();if(!n){els.inspector.className="inspector empty";els.inspector.innerHTML='<div class="empty-state">Выбери объект.</div>';return}
 els.inspector.className="inspector";const selectionCount=state.selectedIds.size;$("#selectionKind").textContent=selectionCount>1?`${selectionCount} объектов · ${n.ClassName}`:n.ClassName;
 const groups=[];
 const menuRoot=selectedMenuRoot(n);
 if(menuRoot)groups.push(group("MENU",[
  '<div class="menu-root-summary"><b>'+esc(menuRoot.Name)+'</b><span>Удаляет всё меню вместе со всеми дочерними Roblox Instances.</span></div>',
  '<button id="deleteWholeMenuBtn" class="btn danger-action">DELETE WHOLE MENU</button>'
 ]));
 groups.push(group("INSTANCE",[
  textProp("Name",n.Name,v=>{n.Name=v;changed()}),
  readonly("Class",n.ClassName),
  ...(n.ClassName==="ScreenGui"?[]:[
   boolProp("Visible",prop(n,"Visible",true),v=>setProp(n,"Visible",v)),
   numProp("ZIndex",prop(n,"ZIndex",1),v=>setProp(n,"ZIndex",v))
  ])
 ]));
 const visibilityWarning=visibilityHelpGroup(n);
 if(visibilityWarning)groups.push(visibilityWarning);
 if(n.ClassName==="ScreenGui"){
  groups.push(group("SCREENGUI",[
   boolProp("IgnoreGuiInset",prop(n,"IgnoreGuiInset",false),v=>{setProp(n,"IgnoreGuiInset",v);state.inset=v?0:36;$("#insetInput").value=state.inset;renderAll()}),
   boolProp("ResetOnSpawn",prop(n,"ResetOnSpawn",false),v=>setProp(n,"ResetOnSpawn",v)),
   numProp("DisplayOrder",prop(n,"DisplayOrder",0),v=>setProp(n,"DisplayOrder",v))
  ]));
 }else if(!MODIFIERS.has(n.ClassName)){
  groups.push(group("TRANSFORM",[
   udim2Prop("Position",u2v(n,"Position"),v=>setProp(n,"Position",{UDim2:v})),
   udim2Prop("Size",u2v(n,"Size",u2(0,100,0,100)),v=>setProp(n,"Size",{UDim2:v})),
   vector2Prop("AnchorPoint",v2v(n,"AnchorPoint"),v=>setProp(n,"AnchorPoint",{Vector2:v})),
   numProp("Rotation",prop(n,"Rotation",0),v=>setProp(n,"Rotation",v))
  ]));
  groups.push(geometryInspectorGroup());
   groups.push(group("APPEARANCE",[
   colorProp("Background",prop(n,"BackgroundColor3",[1,1,1]),v=>setProp(n,"BackgroundColor3",v)),
   numProp("Transparency",prop(n,"BackgroundTransparency",0),v=>setProp(n,"BackgroundTransparency",clamp(v,0,1)),.01),
   numProp("Border",prop(n,"BorderSizePixel",0),v=>setProp(n,"BorderSizePixel",Math.max(0,v))),
   boolProp("Clips",prop(n,"ClipsDescendants",false),v=>setProp(n,"ClipsDescendants",v))
  ]));
 }
 if(TEXT_CLASSES.has(n.ClassName))groups.push(group("TEXT",[
  textareaProp("Text",prop(n,"Text",""),v=>setProp(n,"Text",v)),
  numProp("TextSize",prop(n,"TextSize",14),v=>setProp(n,"TextSize",v)),
  colorProp("TextColor",prop(n,"TextColor3",[1,1,1]),v=>setProp(n,"TextColor3",v)),
  selectProp("Align X",prop(n,"TextXAlignment","Left"),["Left","Center","Right"],v=>setProp(n,"TextXAlignment",v)),
  selectProp("Align Y",prop(n,"TextYAlignment","Center"),["Top","Center","Bottom"],v=>setProp(n,"TextYAlignment",v)),
  boolProp("Wrapped",prop(n,"TextWrapped",true),v=>setProp(n,"TextWrapped",v)),
  textProp("Font",prop(n,"Font","Gotham"),v=>setProp(n,"Font",v))
 ]));
 if(IMAGE_CLASSES.has(n.ClassName))groups.push(group("IMAGE",[
  textProp("Image",prop(n,"Image",""),v=>setProp(n,"Image",v)),
  numProp("Transparency",prop(n,"ImageTransparency",0),v=>setProp(n,"ImageTransparency",clamp(v,0,1)),.01),
  selectProp("ScaleType",prop(n,"ScaleType","Fit"),["Fit","Crop","Stretch","Tile","Slice"],v=>setProp(n,"ScaleType",v))
 ]));
 if(n.ClassName==="UICorner")groups.push(group("UICORNER",[udimProp("CornerRadius",udv(n,"CornerRadius",[0,8]),v=>setProp(n,"CornerRadius",{UDim:v}))]));
 if(n.ClassName==="UIStroke")groups.push(group("UISTROKE",[
  colorProp("Color",prop(n,"Color",[0,0,0]),v=>setProp(n,"Color",v)),numProp("Thickness",prop(n,"Thickness",1),v=>setProp(n,"Thickness",v),.5),
  numProp("Transparency",prop(n,"Transparency",0),v=>setProp(n,"Transparency",clamp(v,0,1)),.01),selectProp("Mode",prop(n,"ApplyStrokeMode","Border"),["Border","Contextual"],v=>setProp(n,"ApplyStrokeMode",v))
 ]));
 if(n.ClassName==="UIListLayout")groups.push(group("LIST LAYOUT",[
  selectProp("Direction",prop(n,"FillDirection","Vertical"),["Vertical","Horizontal"],v=>setProp(n,"FillDirection",v)),
  udimProp("Padding",udv(n,"Padding",[0,0]),v=>setProp(n,"Padding",{UDim:v})),
  selectProp("H Align",prop(n,"HorizontalAlignment","Left"),["Left","Center","Right"],v=>setProp(n,"HorizontalAlignment",v))
 ]));
 if(n.ClassName==="UIGridLayout")groups.push(group("GRID LAYOUT",[
  udim2Prop("CellSize",u2v(n,"CellSize",u2(0,64,0,64)),v=>setProp(n,"CellSize",{UDim2:v})),
  udim2Prop("CellPadding",u2v(n,"CellPadding",u2(0,6,0,6)),v=>setProp(n,"CellPadding",{UDim2:v}))
 ]));
 if(n.ClassName==="UIPadding")groups.push(group("PADDING",["PaddingLeft","PaddingRight","PaddingTop","PaddingBottom"].map(k=>udimProp(k,udv(n,k,[0,0]),v=>setProp(n,k,{UDim:v})))));
 if(!MODIFIERS.has(n.ClassName)&&n!==state.root)groups.push(computedGroup(n));
 groups.push(rawGroup(n));
 els.inspector.innerHTML=groups.join("");
 bindInspectorHandlers(n);
}
function group(title,rows){return `<section class="ins-group"><div class="ins-title">${title}</div><div class="ins-body">${rows.join("")}</div></section>`}
function row(label,html){return `<div class="prop-row"><label>${label}</label>${html}</div>`}
let handlerSeq=1,handlers={};
function h(fn){const id="h"+handlerSeq++;handlers[id]=fn;return id}
function textProp(l,v,fn){return row(l,`<input data-handler="${h(fn)}" value="${esc(v)}">`)}
function textareaProp(l,v,fn){return row(l,`<textarea data-handler="${h(fn)}">${esc(v)}</textarea>`)}
function readonly(l,v){return row(l,`<input value="${esc(v)}" disabled>`)}
function numProp(l,v,fn,step=1){return row(l,`<input type="number" step="${step}" data-handler="${h(fn)}" value="${finite(v)}">`)}
function boolProp(l,v,fn){return row(l,`<input type="checkbox" data-handler="${h(fn)}" ${v?"checked":""}>`)}
function selectProp(l,v,opts,fn){return row(l,`<select data-handler="${h(fn)}">${opts.map(o=>`<option ${o===v?"selected":""}>${o}</option>`).join("")}</select>`)}
function colorProp(l,v,fn){return row(l,`<input type="color" data-handler="${h(fn)}" value="${colorHex(v)}">`)}
function udim2Prop(l,v,fn){
 const id=h(fn);return row(l,`<div class="quad" data-udim2-handler="${id}"><input type="number" step=".01" value="${v[0][0]}" title="X Scale"><input type="number" value="${v[0][1]}" title="X Offset"><input type="number" step=".01" value="${v[1][0]}" title="Y Scale"><input type="number" value="${v[1][1]}" title="Y Offset"></div>`)
}
function vector2Prop(l,v,fn){const id=h(fn);return row(l,`<div class="xy" data-v2-handler="${id}"><input type="number" step=".01" value="${v[0]}"><input type="number" step=".01" value="${v[1]}"></div>`)}
function udimProp(l,v,fn){const id=h(fn);return row(l,`<div class="xy" data-udim-handler="${id}"><input type="number" step=".01" value="${v[0]}"><input type="number" value="${v[1]}"></div>`)}
function computedGroup(n){
 setTimeout(updatePixelReadout,0);
 return group("COMPUTED PIXELS",[`<div id="computedBox" class="computed"><div><small>X</small><strong>—</strong></div><div><small>Y</small><strong>—</strong></div><div><small>W</small><strong>—</strong></div><div><small>H</small><strong>—</strong></div></div>`])
}
function rawGroup(n){return group("RAW PROPERTIES",[`<textarea id="rawProps" class="raw-json" spellcheck="false">${esc(JSON.stringify(n.Properties||{},null,2))}</textarea><button id="applyRaw" class="btn">Применить свойства</button>`])}
function esc(x){return String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}
function bindInspectorHandlers(n){
 els.inspector.querySelectorAll("[data-handler]").forEach(input=>{
  input.addEventListener("change",()=>{pushHistory();const fn=handlers[input.dataset.handler];fn(input.type==="checkbox"?input.checked:input.type==="number"?finite(input.value):input.type==="color"?hexColor(input.value):input.value)})
 });
 els.inspector.querySelectorAll("[data-udim2-handler]").forEach(box=>box.addEventListener("change",()=>{pushHistory();const a=[...box.querySelectorAll("input")].map(x=>finite(x.value));handlers[box.dataset.udim2Handler]([[a[0],roundOffset(a[1])],[a[2],roundOffset(a[3])]])}));
 els.inspector.querySelectorAll("[data-v2-handler]").forEach(box=>box.addEventListener("change",()=>{pushHistory();const a=[...box.querySelectorAll("input")].map(x=>finite(x.value));handlers[box.dataset.v2Handler]([a[0],a[1]])}));
 els.inspector.querySelectorAll("[data-udim-handler]").forEach(box=>box.addEventListener("change",()=>{pushHistory();const a=[...box.querySelectorAll("input")].map(x=>finite(x.value));handlers[box.dataset.udimHandler]([a[0],roundOffset(a[1])])}));
 $("#applyRaw")?.addEventListener("click",()=>{
  try{
   const next=JSON.parse($("#rawProps").value);
   if(TEXT_CLASSES.has(n.ClassName)&&!Object.prototype.hasOwnProperty.call(next,"Text"))next.Text="";
   pushHistory();n.Properties=next;changed();toast("Свойства применены");
  }catch(e){toast("Неверный JSON свойств",true)}
 });
 $("#childrenVisibleBtn")?.addEventListener("click",()=>{
  pushHistory();
  n.Properties=n.Properties||{};
  n.Properties.Visible=true;
  n.Properties.BackgroundTransparency=1;
  changed();
  toast("Контейнер видим, фон прозрачный — дети останутся видимыми");
 });
 els.inspector.querySelectorAll("[data-align]").forEach(b=>b.addEventListener("click",()=>alignSelected(b.dataset.align)));
 $("#tidyBtn")?.addEventListener("click",()=>tidySiblings(finite($("#arrangeColumns")?.value,3),finite($("#arrangeGap")?.value,8)));
 $("#spaceXBtn")?.addEventListener("click",()=>distributeSiblings("x",finite($("#arrangeGap")?.value,8)));
 $("#spaceYBtn")?.addEventListener("click",()=>distributeSiblings("y",finite($("#arrangeGap")?.value,8)));
 $("#fitParentBtn")?.addEventListener("click",fitSelectedParent);
 $("#freeLayoutBtn")?.addEventListener("click",()=>{const current=selected(),parent=current&&findParent(current.__id);if(parent&&bakeLayout(parent)){select(current.__id)}});
 $("#deleteWholeMenuBtn")?.addEventListener("click",deleteWholeMenu);
}
function setProp(n,k,v){n.Properties=n.Properties||{};n.Properties[k]=v;changed()}

function updatePixelReadout(){
 const n=selected(),nodeEl=n&&els.guiRoot.querySelector(`[data-id="${n.__id}"]`),box=$("#computedBox");if(!n||!nodeEl)return;
 const dr=els.guiRoot.getBoundingClientRect(),rr=nodeEl.getBoundingClientRect(),z=state.zoom;
 const vals=[(rr.left-dr.left)/z,(rr.top-dr.top)/z,rr.width/z,rr.height/z].map(x=>Math.round(x*10)/10);
 els.pixels.textContent=`X ${vals[0]}  Y ${vals[1]}  W ${vals[2]}  H ${vals[3]}`;
 if(box)[...box.querySelectorAll("strong")].forEach((s,i)=>s.textContent=vals[i]);
}
function updateStatus(){
 const n=selected(),count=state.selectedIds.size;
 const mode=state.activeUiState?(UI_STATE_TITLES[state.activeUiState]||state.activeUiState):"Empty workspace";
 const saveState=state.autoSaving?" ↻ AUTO SAVE":state.lastAutoSaveError?" ⚠ SAVE ERROR":state.dirty?" ●":" ✓";
 els.status.textContent=saveState+" "+mode+" · "+(count>1?`${count} objects · `:"")+(n?`${n.Name} [${n.ClassName}]`:"");
 els.target.textContent=state.targetPath;
 updateUiStateBar();
}

function isLayoutParent(n){return !!n&&(modifier(n,"UIListLayout")||modifier(n,"UIGridLayout"))}
function bakeLayout(parent,options={}){
 if(!parent)return false;
 const record=options.record!==false,rerender=options.render!==false,notify=options.notify!==false;
 const layout=modifier(parent,"UIListLayout")||modifier(parent,"UIGridLayout");
 if(!layout)return false;
 const parentEl=parent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${parent.__id}"]`);
 if(!parentEl)return false;
 const pr=localRect(parentEl);if(!pr)return false;

 const children=layoutChildNodes(parent);
 const snapshots=[];
 for(const child of children){
  const el=els.guiRoot.querySelector(`[data-id="${child.__id}"]`);
  const r=localRect(el);if(!r)continue;
  snapshots.push({child,r});
 }
 if(!snapshots.length)return false;

 if(record)pushHistory();
 for(const {child,r} of snapshots){
  child.Properties=child.Properties||{};
  const a=v2v(child,"AnchorPoint",[0,0]);
  const relLeft=r.left-pr.left,relTop=r.top-pr.top;
  child.Properties.Position={UDim2:[[0,roundOffset(relLeft+a[0]*r.w)],[0,roundOffset(relTop+a[1]*r.h)]]};
  child.Properties.Size={UDim2:[[0,Math.max(1,roundOffset(r.w))],[0,Math.max(1,roundOffset(r.h))]]};
 }
 parent.Children=(parent.Children||[]).filter(c=>c!==layout);
 markDirty();
 if(rerender)renderAll();
 if(notify)toast((layout.ClassName||"Layout")+" запечён — теперь элементы полностью свободны");
 return true;
}
function startMove(ev,n){
 if(ev.button!==0||MODIFIERS.has(n.ClassName))return;
 ev.stopPropagation();
 const exactNode=n;
 if(!ev.altKey)n=fragmentInteractionRoot(n);
 if(ev.shiftKey||ev.ctrlKey||ev.metaKey){select(n.__id,true);return}
 if(!isSelectedId(n.__id))select(n.__id,false);
 else if(state.selectedId!==n.__id){setPrimarySelection(n.__id);state.selectionAnchorId=n.__id;renderTree();renderInspector();updateOverlay();updateStatus()}
 if(ev.altKey&&n===exactNode)toast("Exact child · Alt selection");

 let nodes=selectedMoveRoots();
 if(!nodes.length)return;

 // One undo snapshot for the entire operation, including automatic layout baking.
 pushHistory();

 const layoutParents=[];
 const seenParents=new Set();
 for(const item of nodes){
  const p=findParent(item.__id);
  if(p&&isLayoutParent(p)&&!seenParents.has(p.__id)){seenParents.add(p.__id);layoutParents.push(p)}
 }
 let baked=false;
 for(const p of layoutParents)baked=bakeLayout(p,{record:false,render:false,notify:false})||baked;
 if(baked){
  renderAll();
  nodes=selectedMoveRoots();
  toast("Layout запечён · групповое перемещение свободно");
 }

 const items=nodes.map(item=>({n:item,pos:deepClone(u2v(item,"Position"))}));
 const geometry=nodes.length>1?collectGroupGuideTargets(nodes):collectGuideTargets(n);
 state.drag={type:"move",n,startX:ev.clientX,startY:ev.clientY,items,geometry,group:nodes.length>1};
 ev.currentTarget.setPointerCapture?.(ev.pointerId);
}
window.addEventListener("pointermove",ev=>{
 if(state.panelResize){
  const rail=document.querySelector(".state-rail");
  if(state.panelResize.side==="explorer"){
   const railRight=rail?.getBoundingClientRect().right||0;
   state.explorerW=clamp(ev.clientX-railRight,180,460);
  }else{
   state.inspectorW=clamp(window.innerWidth-ev.clientX,220,500);
  }
  applyPanelWidths();
  return;
 }
 const d=state.drag;if(!d)return;const dx=(ev.clientX-d.startX)/state.zoom,dy=(ev.clientY-d.startY)/state.zoom,s=state.snap;
 if(d.type==="move"){
  let rx=Math.round(dx/s)*s,ry=Math.round(dy/s)*s,guide={rx,ry,x:null,y:null};
  if(!ev.altKey)guide=smartSnapMove(d.geometry,rx,ry);
  for(const item of d.items||[]){
   const p=deepClone(item.pos);
   p[0][1]=roundOffset(p[0][1]+guide.rx);
   p[1][1]=roundOffset(p[1][1]+guide.ry);
   item.n.Properties.Position={UDim2:p};
  }
  renderViewport();updateOverlay();showSmartGuides(guide.x,guide.y);updatePixelReadout();markDirty();updateStatus()
 }else if(d.type==="resize")resizeFromDrag(d,dx,dy,ev.altKey);
 else if(d.type==="group-resize")resizeGroupFromDrag(d,dx,dy,ev.altKey);
});
window.addEventListener("pointerup",()=>{
 if(state.panelResize){
  document.body.classList.remove("panel-resizing");
  document.querySelectorAll(".panel-resizer.dragging").forEach(x=>x.classList.remove("dragging"));
  state.panelResize=null;
  savePrefs();
  requestAnimationFrame(()=>{updateOverlay();updatePixelReadout()});
 }
 if(state.drag){state.drag=null;clearSmartGuides();renderTree();renderInspector();updateGeometrySelection()}
});

els.overlay.querySelectorAll("i").forEach(handle=>handle.addEventListener("pointerdown",ev=>{
 ev.stopPropagation();ev.preventDefault();
 const n=selected();if(!n)return;
 const roots=selectedMoveRoots();
 if(roots.length>1){
  startGroupResize(ev,handle.dataset.dir,roots);
  return;
 }
 pushHistory();
 state.drag={type:"resize",n,dir:handle.dataset.dir,startX:ev.clientX,startY:ev.clientY,size:deepClone(u2v(n,"Size",u2(0,100,0,100))),pos:deepClone(u2v(n,"Position")),anchor:deepClone(v2v(n,"AnchorPoint")),geometry:collectGuideTargets(n)}
}));

function startGroupResize(ev,dir,nodes){
 const base=groupBounds(nodes);if(!base)return false;

 // One undo snapshot for the entire group resize.
 pushHistory();

 // Layout-managed children need to become free before proportional scaling.
 const parents=[];const seen=new Set();
 for(const item of nodes){
  const p=findParent(item.__id);
  if(p&&isLayoutParent(p)&&!seen.has(p.__id)){seen.add(p.__id);parents.push(p)}
 }
 let baked=false;
 for(const p of parents)baked=bakeLayout(p,{record:false,render:false,notify:false})||baked;
 if(baked){renderAll();nodes=selectedMoveRoots()}

 const refreshedBase=groupBounds(nodes);if(!refreshedBase)return false;
 const items=[];
 for(const item of nodes){
  const el=els.guiRoot.querySelector(`[data-id="${item.__id}"]`),r=localRect(el);if(!r)continue;
  const parent=findParent(item.__id);
  const parentEl=parent&&parent!==state.root?els.guiRoot.querySelector(`[data-id="${parent.__id}"]`):els.guiRoot;
  const pr=localRect(parentEl);if(!pr)continue;
  items.push({
   n:item,r,
   parentRect:pr,
   pos:deepClone(u2v(item,"Position")),
   size:deepClone(u2v(item,"Size",u2(0,r.w,0,r.h))),
   anchor:deepClone(v2v(item,"AnchorPoint",[0,0]))
  });
 }
 if(items.length<2)return false;

 state.drag={
  type:"group-resize",dir,startX:ev.clientX,startY:ev.clientY,
  items,base:refreshedBase,geometry:collectGroupGuideTargets(nodes)
 };
 if(baked)toast("Layout запечён · групповое масштабирование свободно");
 return true;
}
function resizeGroupFromDrag(d,dx,dy,bypassGuides=false){
 const dir=d.dir,s=state.snap,b=d.base;
 let rx=Math.round(dx/s)*s,ry=Math.round(dy/s)*s,guide={rx,ry,x:null,y:null};
 if(!bypassGuides)guide=smartSnapResize({dir,geometry:d.geometry},rx,ry);
 rx=guide.rx;ry=guide.ry;

 let left=b.left,top=b.top,right=b.right,bottom=b.bottom;
 const corner=(dir.includes("e")||dir.includes("w"))&&(dir.includes("n")||dir.includes("s"));

 if(corner){
  let fx=1,fy=1;
  if(dir.includes("e"))fx=(b.w+rx)/Math.max(1,b.w);
  else if(dir.includes("w"))fx=(b.w-rx)/Math.max(1,b.w);
  if(dir.includes("s"))fy=(b.h+ry)/Math.max(1,b.h);
  else if(dir.includes("n"))fy=(b.h-ry)/Math.max(1,b.h);

  // Corner resize is uniform: whichever axis the pointer changed more controls scale.
  let factor=Math.abs(fx-1)>=Math.abs(fy-1)?fx:fy;
  factor=Math.max(.02,factor);
  const nw=Math.max(1,b.w*factor),nh=Math.max(1,b.h*factor);

  if(dir.includes("e"))right=left+nw;else left=right-nw;
  if(dir.includes("s"))bottom=top+nh;else top=bottom-nh;
 }else{
  if(dir.includes("e"))right=Math.max(left+1,b.right+rx);
  if(dir.includes("w"))left=Math.min(right-1,b.left+rx);
  if(dir.includes("s"))bottom=Math.max(top+1,b.bottom+ry);
  if(dir.includes("n"))top=Math.min(bottom-1,b.top+ry);
 }

 const nw=Math.max(1,right-left),nh=Math.max(1,bottom-top);
 const sx=nw/Math.max(1,b.w),sy=nh/Math.max(1,b.h);

 for(const item of d.items){
  const r=item.r,pr=item.parentRect,a=item.anchor;
  const relX=(r.left-b.left)*sx,relY=(r.top-b.top)*sy;
  const targetLeft=left+relX,targetTop=top+relY;
  const targetW=Math.max(1,r.w*sx),targetH=Math.max(1,r.h*sy);

  const sz=deepClone(item.size),ps=deepClone(item.pos);
  sz[0][1]=roundOffset(targetW-item.size[0][0]*Math.max(1,pr.w));
  sz[1][1]=roundOffset(targetH-item.size[1][0]*Math.max(1,pr.h));

  const anchorX=targetLeft-pr.left+a[0]*targetW;
  const anchorY=targetTop-pr.top+a[1]*targetH;
  ps[0][1]=roundOffset(anchorX-item.pos[0][0]*Math.max(1,pr.w));
  ps[1][1]=roundOffset(anchorY-item.pos[1][0]*Math.max(1,pr.h));

  item.n.Properties.Size={UDim2:sz};
  item.n.Properties.Position={UDim2:ps};
 }

 markDirty();renderViewport();updateOverlay();showSmartGuides(guide.x,guide.y);updatePixelReadout();updateStatus();
}

function resizeFromDrag(d,dx,dy,bypassGuides=false){
 const dir=d.dir,s=state.snap;let rx=Math.round(dx/s)*s,ry=Math.round(dy/s)*s,guide={rx,ry,x:null,y:null};
 if(!bypassGuides)guide=smartSnapResize(d,rx,ry);
 rx=guide.rx;ry=guide.ry;
 const sz=deepClone(d.size),ps=deepClone(d.pos),a=d.anchor;
 const base=d.geometry?.base;
 const parent=findParent(d.n.__id);
 const parentEl=parent&&parent!==state.root?els.guiRoot.querySelector(`[data-id="${parent.__id}"]`):els.guiRoot;
 const pr=localRect(parentEl);
 const pw=Math.max(1,pr?.w||state.viewport.w),ph=Math.max(1,pr?.h||state.viewport.h);
 const baseW=Math.max(1,base?.w||(d.size[0][0]*pw+d.size[0][1]));
 const baseH=Math.max(1,base?.h||(d.size[1][0]*ph+d.size[1][1]));

 if(dir.includes("e")){
  const desiredW=Math.max(1,baseW+rx);
  const applied=desiredW-baseW;
  sz[0][1]=roundOffset(desiredW-d.size[0][0]*pw);
  ps[0][1]=roundOffset(d.pos[0][1]+applied*a[0]);
 }
 if(dir.includes("w")){
  const desiredW=Math.max(1,baseW-rx);
  const applied=baseW-desiredW;
  sz[0][1]=roundOffset(desiredW-d.size[0][0]*pw);
  ps[0][1]=roundOffset(d.pos[0][1]+applied*(1-a[0]));
 }
 if(dir.includes("s")){
  const desiredH=Math.max(1,baseH+ry);
  const applied=desiredH-baseH;
  sz[1][1]=roundOffset(desiredH-d.size[1][0]*ph);
  ps[1][1]=roundOffset(d.pos[1][1]+applied*a[1]);
 }
 if(dir.includes("n")){
  const desiredH=Math.max(1,baseH-ry);
  const applied=baseH-desiredH;
  sz[1][1]=roundOffset(desiredH-d.size[1][0]*ph);
  ps[1][1]=roundOffset(d.pos[1][1]+applied*(1-a[1]));
 }
 d.n.Properties.Size={UDim2:sz};d.n.Properties.Position={UDim2:ps};markDirty();renderViewport();updateOverlay();showSmartGuides(guide.x,guide.y);updatePixelReadout();updateStatus();
}

function defaultObject(kind){
 const common={Size:u2(0,160,0,60),Position:u2(0,24,0,24),AnchorPoint:v2(0,0),BackgroundColor3:c3(.10,.14,.19),BackgroundTransparency:0,BorderSizePixel:0,ZIndex:1,Visible:true};
 const m={
  Frame:{...common},
  TextLabel:{...common,BackgroundTransparency:1,Text:"TextLabel",TextColor3:c3(1,1,1),TextSize:14,TextWrapped:true,TextXAlignment:"Center",TextYAlignment:"Center",Font:"Gotham"},
  TextButton:{...common,Text:"Button",TextColor3:c3(1,1,1),TextSize:14,TextWrapped:true,TextXAlignment:"Center",TextYAlignment:"Center",Font:"GothamBold",AutoButtonColor:false},
  ImageLabel:{...common,BackgroundTransparency:1,Image:"",ScaleType:"Fit"},
  ImageButton:{...common,BackgroundTransparency:1,Image:"",ScaleType:"Fit",AutoButtonColor:false},
  ScrollingFrame:{...common,Size:u2(0,280,0,220),CanvasSize:u2(0,0,0,500),ScrollBarThickness:6,ClipsDescendants:true},
  UICorner:{CornerRadius:ud(0,12)},
  UIStroke:{Color:c3(.05,.08,.12),Thickness:2,Transparency:.1,ApplyStrokeMode:"Border"},
  UIListLayout:{Padding:ud(0,6),FillDirection:"Vertical",HorizontalAlignment:"Left",SortOrder:"LayoutOrder"},
  UIGridLayout:{CellSize:u2(0,64,0,64),CellPadding:u2(0,6,0,6),SortOrder:"LayoutOrder"},
  UIPadding:{PaddingLeft:ud(0,8),PaddingRight:ud(0,8),PaddingTop:ud(0,8),PaddingBottom:ud(0,8)}
 };
 return normalizeNode({ClassName:kind,Name:uniqueName(kind),Properties:m[kind]||common,Children:[]});
}

function patternCorner(radius=8){
 return {ClassName:"UICorner",Name:"UICorner",Properties:{CornerRadius:ud(0,radius)},Children:[]};
}
function patternStroke(colorValue=c3(.05,.08,.12),thickness=2,transparency=.08){
 return {ClassName:"UIStroke",Name:"UIStroke",Properties:{Color:colorValue,Thickness:thickness,Transparency:transparency,ApplyStrokeMode:"Border"},Children:[]};
}
function patternText(name,text,size,position,sizePx,colorValue=c3(1,1,1),font="GothamBold"){
 return {ClassName:"TextLabel",Name:name,Properties:{
  BackgroundTransparency:1,BorderSizePixel:0,Position:position,Size:sizePx,AnchorPoint:v2(0,0),
  Text:text,TextColor3:colorValue,TextSize:size,TextWrapped:true,TextXAlignment:"Center",TextYAlignment:"Center",Font:font,
  ZIndex:2,Visible:true
 },Children:[]};
}
function patternButton(name,text,w,h,bg,strokeColor,textColor=c3(1,1,1),textSize=14){
 return {ClassName:"TextButton",Name:name,Properties:{
  Size:u2(0,w,0,h),Position:u2(0,0,0,0),AnchorPoint:v2(0,0),
  BackgroundColor3:bg,BackgroundTransparency:0,BorderSizePixel:0,ZIndex:2,Visible:true,
  Text:text,TextColor3:textColor,TextSize:textSize,TextWrapped:true,TextXAlignment:"Center",TextYAlignment:"Center",
  Font:"GothamBold",AutoButtonColor:false
 },Children:[patternCorner(Math.min(12,Math.round(h*.28))),patternStroke(strokeColor,2,.08)]};
}
function patternFragment(kind){
 const blue=c3(.08,.33,.52),blueStroke=c3(.20,.58,.86),green=c3(.08,.43,.28),greenStroke=c3(.23,.77,.48);
 const dark=c3(.07,.11,.16),darkStroke=c3(.18,.29,.39),red=c3(.34,.10,.14),redStroke=c3(.76,.27,.33);
 let root=null;
 switch(kind){
  case "close":
   root=patternButton("CloseButton","×",38,38,dark,redStroke,c3(.96,.97,1),22);break;
  case "equip":
   root=patternButton("EquipButton","EQUIP",150,44,green,greenStroke,c3(.91,1,.95),14);break;
  case "unequip":
   root=patternButton("UnequipButton","UNEQUIP",150,44,dark,darkStroke,c3(.78,.86,.92),13);break;
  case "confirm":
   root=patternButton("ConfirmButton","CONFIRM",160,44,green,greenStroke,c3(.92,1,.96),13);break;
  case "cancel":
   root=patternButton("CancelButton","CANCEL",140,42,dark,darkStroke,c3(.76,.84,.90),12);break;
  case "back":
   root=patternButton("BackButton","‹  BACK",118,38,dark,darkStroke,c3(.77,.88,.96),12);break;
  case "primary":
   root=patternButton("PrimaryAction","CONTINUE  →",180,46,blue,blueStroke,c3(.94,.98,1),13);break;
  case "icon":
   root=patternButton("IconButton","◆",42,42,dark,blueStroke,c3(.42,.77,1),17);break;
  case "tab":
   root=patternButton("TabButton","OVERVIEW",126,36,c3(.07,.22,.34),blueStroke,c3(.87,.96,1),11);break;
  case "currency":
   root={ClassName:"Frame",Name:"CurrencyPill",Properties:{
    Size:u2(0,164,0,42),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.055,.10,.15),BackgroundTransparency:0,
    BorderSizePixel:0,ZIndex:2,Visible:true
   },Children:[
    patternCorner(12),patternStroke(c3(.20,.43,.60),2,.14),
    patternText("Icon","✦",17,u2(0,10,0,5),u2(0,32,0,32),c3(.95,.74,.25)),
    patternText("Value","12,450",14,u2(0,48,0,4),u2(0,104,0,34),c3(.94,.98,1))
   ]};break;
  case "badge":
   root={ClassName:"TextLabel",Name:"StatusBadge",Properties:{
    Size:u2(0,88,0,26),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.12,.30,.20),BackgroundTransparency:0,
    BorderSizePixel:0,ZIndex:3,Visible:true,Text:"NEW",TextColor3:c3(.75,1,.86),TextSize:10,TextWrapped:false,
    TextXAlignment:"Center",TextYAlignment:"Center",Font:"GothamBold"
   },Children:[patternCorner(13),patternStroke(c3(.28,.68,.45),1,.12)]};break;
  case "progress":
   root={ClassName:"Frame",Name:"ProgressBar",Properties:{
    Size:u2(0,280,0,32),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.045,.075,.11),BackgroundTransparency:0,
    BorderSizePixel:0,ZIndex:2,Visible:true,ClipsDescendants:true
   },Children:[
    patternCorner(10),patternStroke(c3(.16,.30,.40),1,.2),
    {ClassName:"Frame",Name:"Fill",Properties:{
     Size:u2(.62,0,1,0),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.10,.49,.72),BackgroundTransparency:0,
     BorderSizePixel:0,ZIndex:2,Visible:true
    },Children:[patternCorner(10)]},
    patternText("Label","62%",11,u2(),u2(1,0,1,0),c3(.96,.99,1))
   ]};break;
  case "tooltip":
   root={ClassName:"Frame",Name:"Tooltip",Properties:{
    Size:u2(0,248,0,82),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.035,.065,.095),BackgroundTransparency:.02,
    BorderSizePixel:0,ZIndex:20,Visible:true
   },Children:[
    patternCorner(10),patternStroke(c3(.19,.42,.58),1,.1),
    {ClassName:"UIPadding",Name:"UIPadding",Properties:{PaddingLeft:ud(0,12),PaddingRight:ud(0,12),PaddingTop:ud(0,10),PaddingBottom:ud(0,10)},Children:[]},
    patternText("Text","Useful information about this control.",11,u2(),u2(1,0,1,0),c3(.78,.88,.95),"Gotham")
   ]};break;
  case "modalHeader":
   root={ClassName:"Frame",Name:"ModalHeader",Properties:{
    Size:u2(0,520,0,56),Position:u2(),AnchorPoint:v2(0,0),BackgroundColor3:c3(.055,.09,.13),BackgroundTransparency:0,
    BorderSizePixel:0,ZIndex:3,Visible:true
   },Children:[
    patternCorner(12),patternStroke(c3(.15,.31,.43),1,.15),
    {ClassName:"TextLabel",Name:"Title",Properties:{
     Size:u2(1,-64,1,0),Position:u2(0,16,0,0),AnchorPoint:v2(0,0),BackgroundTransparency:1,BorderSizePixel:0,
     Text:"TITLE",TextColor3:c3(.91,.96,1),TextSize:16,TextWrapped:false,TextXAlignment:"Left",TextYAlignment:"Center",
     Font:"GothamBold",ZIndex:4,Visible:true
    },Children:[]},
    {ClassName:"TextButton",Name:"CloseButton",Properties:{
     Size:u2(0,34,0,34),Position:u2(1,-44,.5,-17),AnchorPoint:v2(0,0),BackgroundColor3:dark,BackgroundTransparency:0,
     BorderSizePixel:0,ZIndex:5,Visible:true,Text:"×",TextColor3:c3(.92,.95,.98),TextSize:20,TextWrapped:false,
     TextXAlignment:"Center",TextYAlignment:"Center",Font:"GothamBold",AutoButtonColor:false
    },Children:[patternCorner(9),patternStroke(redStroke,1,.1)]}
   ]};break;
 }
 if(!root)return null;
 root.Name=uniqueName(root.Name||"Pattern");
 return normalizeNode(root);
}
function createPattern(kind){
 if(!state.root)return;
 const parent=nearestCreationParent(selected());
 if(!parent){toast("Не удалось определить родителя для паттерна",true);return}
 const n=patternFragment(kind);
 if(!n){toast("Неизвестный UI Pattern: "+kind,true);return}
 pushHistory();
 const position=creationPosition(parent,n);
 if(position)n.Properties.Position=position;
 parent.Children=parent.Children||[];
 parent.Children.push(n);
 state.selectedId=n.__id;state.selectedIds=new Set([n.__id]);state.selectionAnchorId=n.__id;
 changed();
 requestAnimationFrame(()=>focusSelected());
 toast("Pattern · "+(n.Name||kind)+" создан");
}

function uniqueName(base){let i=1,name=base;const names=new Set();walk(state.root,n=>names.add(n.Name));while(names.has(name))name=base+(++i);return name}
function nearestCreationParent(node){
 let p=node;
 while(p&&p!==state.root&&!CREATION_CONTAINERS.has(p.ClassName))p=findParent(p.__id);
 if(p&&CREATION_CONTAINERS.has(p.ClassName))return p;
 const safeRoot=(state.root?.Children||[]).find(x=>x.Name==="SafeRoot"&&x.ClassName==="Frame");
 return safeRoot||state.root;
}
function creationPosition(parent,node){
 if(MODIFIERS.has(node.ClassName))return null;
 const parentRect=engineV2?.getRect(parent.__id)||localRect(els.guiRoot.querySelector(`[data-id="${parent.__id}"]`));
 const size=u2v(node,"Size",u2(0,160,0,60));
 const pw=Math.max(1,parentRect?.w||state.viewport.w),ph=Math.max(1,parentRect?.h||state.viewport.h);
 const w=Math.max(1,size[0][0]*pw+size[0][1]),h=Math.max(1,size[1][0]*ph+size[1][1]);

 let localX=Math.max(0,(pw-w)/2),localY=Math.max(0,(ph-h)/2);
 if(parentRect){
  const scrollerRect=els.stageScroller.getBoundingClientRect();
  const deviceRect=els.device.getBoundingClientRect();
  const z=state.zoom||1;
  const visibleLeft=(scrollerRect.left-deviceRect.left)/z;
  const visibleTop=(scrollerRect.top-deviceRect.top)/z;
  const visibleRight=(scrollerRect.right-deviceRect.left)/z;
  const visibleBottom=(scrollerRect.bottom-deviceRect.top)/z;
  const vx1=Math.max(parentRect.x??parentRect.left,visibleLeft);
  const vy1=Math.max(parentRect.y??parentRect.top,visibleTop);
  const vx2=Math.min((parentRect.x??parentRect.left)+pw,visibleRight);
  const vy2=Math.min((parentRect.y??parentRect.top)+ph,visibleBottom);
  if(vx2>vx1&&vy2>vy1){
   const px=parentRect.x??parentRect.left,py=parentRect.y??parentRect.top;
   localX=(vx1+vx2-w)/2-px;
   localY=(vy1+vy2-h)/2-py;
  }
 }
 const margin=8;
 localX=clamp(localX,margin,Math.max(margin,pw-w-margin));
 localY=clamp(localY,margin,Math.max(margin,ph-h-margin));
 const a=v2v(node,"AnchorPoint",[0,0]);
 return {UDim2:[[0,roundOffset(localX+a[0]*w)],[0,roundOffset(localY+a[1]*h)]]};
}
function addObject(kind){
 if(!state.root)return;
 let parent=selected();
 if(MODIFIERS.has(kind)){
  if(!parent||parent===state.root||MODIFIERS.has(parent.ClassName)){toast("Выбери GuiObject для "+kind,true);return}
 }else{
  parent=nearestCreationParent(parent);
 }
 if(!parent){toast("Не удалось определить родителя для "+kind,true);return}
 pushHistory();
 const n=defaultObject(kind);
 const position=creationPosition(parent,n);
 if(position)n.Properties.Position=position;
 parent.Children=parent.Children||[];
 parent.Children.push(n);
 state.selectedId=n.__id;state.selectedIds=new Set([n.__id]);state.selectionAnchorId=n.__id;
 changed();
 requestAnimationFrame(()=>focusSelected());
 toast(kind+" создан")
}


function isAncestorOf(ancestor,node){
 let p=findParent(node.__id);
 while(p){if(p===ancestor)return true;p=findParent(p.__id)}
 return false;
}
function canContainNode(parent,node){
 if(!parent||!node||parent===node)return false;
 if(MODIFIERS.has(node.ClassName)){
  return parent.ClassName!=="ScreenGui"&&!MODIFIERS.has(parent.ClassName);
 }
 return CONTAINERS.has(parent.ClassName);
}
function reparentPreserve(nodes,newParent,insertIndex=null){
 nodes=(nodes||[]).filter(Boolean);
 if(!nodes.length||!newParent)return false;
 const roots=nodes.filter(n=>!nodes.some(other=>other!==n&&isAncestorOf(other,n)));
 if(!roots.length)return false;
 if(roots.some(n=>n===state.root||isAncestorOf(n,newParent)||!canContainNode(newParent,n))){
  toast("Сюда нельзя переместить выбранные объекты",true);return false;
 }

 const newParentEl=newParent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${newParent.__id}"]`);
 const newPr=localRect(newParentEl);
 if(!newPr){toast("Не удалось определить геометрию нового родителя",true);return false}

 const snapshots=roots.map(n=>({
  n,
  oldParent:findParent(n.__id),
  r:localRect(els.guiRoot.querySelector(`[data-id="${n.__id}"]`))
 })).filter(x=>x.oldParent&&x.r);
 if(!snapshots.length)return false;

 pushHistory();

 // Full-control behavior: layouts on either side are baked before reparenting.
 const layoutParents=new Set();
 for(const s of snapshots)if(isLayoutParent(s.oldParent))layoutParents.add(s.oldParent);
 if(isLayoutParent(newParent))layoutParents.add(newParent);
 for(const p of layoutParents)bakeLayout(p,{record:false,render:false,notify:false});

 // Remove roots from old parents first.
 for(const {n,oldParent} of snapshots){
  oldParent.Children=(oldParent.Children||[]).filter(c=>c!==n);
 }

 newParent.Children=newParent.Children||[];
 let at=insertIndex==null?newParent.Children.length:Math.max(0,Math.min(insertIndex,newParent.Children.length));
 for(const {n,r} of snapshots){
  n.Properties=n.Properties||{};
  if(!MODIFIERS.has(n.ClassName)){
   const a=v2v(n,"AnchorPoint",[0,0]);
   n.Properties.Position={UDim2:[
    [0,roundOffset(r.left-newPr.left+a[0]*r.w)],
    [0,roundOffset(r.top-newPr.top+a[1]*r.h)]
   ]};
   n.Properties.Size={UDim2:[
    [0,Math.max(1,roundOffset(r.w))],
    [0,Math.max(1,roundOffset(r.h))]
   ]};
  }
  newParent.Children.splice(at++,0,n);
 }

 state.selectedIds=new Set(roots.map(n=>n.__id));
 state.selectedId=roots[roots.length-1].__id;
 state.selectionAnchorId=roots[0].__id;
 markDirty();renderAll();finishSelection();
 toast(roots.length===1?roots[0].Name+" перемещён в "+newParent.Name:roots.length+" объектов перемещено в "+newParent.Name);
 return true;
}
function outdentSelected(){
 const roots=selectedMoveRoots();
 if(!roots.length)return;
 const byTarget=new Map();
 for(const n of roots){
  const parent=findParent(n.__id),grand=parent&&findParent(parent.__id);
  if(!parent||!grand)continue;
  if(!byTarget.has(grand.__id))byTarget.set(grand.__id,{grand,parent,nodes:[]});
  byTarget.get(grand.__id).nodes.push(n);
 }
 if(!byTarget.size){toast("Объект уже находится на верхнем доступном уровне",true);return}

 // Common case: one parent => preserve order and insert right after that parent.
 if(byTarget.size===1){
  const {grand,parent,nodes}=[...byTarget.values()][0];
  const idx=Math.max(0,(grand.Children||[]).indexOf(parent)+1);
  reparentPreserve(nodes,grand,idx);
  return;
 }

 // Different parents: outdent groups independently.
 const original=[...state.selectedIds];
 let first=true;
 for(const {grand,parent,nodes} of byTarget.values()){
  const idx=Math.max(0,(grand.Children||[]).indexOf(parent)+1);
  if(first){reparentPreserve(nodes,grand,idx);first=false}
  else{
   // reuse current geometry with a separate action only when selections span branches
   reparentPreserve(nodes,grand,idx);
  }
 }
 state.selectedIds=new Set(original.filter(id=>findNode(id)));
 if(state.selectedIds.size){state.selectedId=[...state.selectedIds].pop();state.selectionAnchorId=[...state.selectedIds][0];finishSelection()}
}
function treeDropTargetFromRow(row){
 const n=row&&findNode(row.dataset.id);
 return n&&CONTAINERS.has(n.ClassName)?n:null;
}

function groupSelected(){
 let nodes=selectedMoveRoots();
 if(nodes.length<2){toast("Для Group выбери минимум 2 объекта",true);return}
 const parent=findParent(nodes[0].__id);
 if(!parent||nodes.some(n=>findParent(n.__id)!==parent)){
  toast("Group работает для объектов с одним родителем",true);return;
 }

 pushHistory();
 if(isLayoutParent(parent))bakeLayout(parent,{record:false,render:false,notify:false});
 renderViewport();

 nodes=selectedMoveRoots();
 const pr=localRect(parent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${parent.__id}"]`));
 const snapshots=nodes.map(n=>({n,r:localRect(els.guiRoot.querySelector(`[data-id="${n.__id}"]`))})).filter(x=>x.r);
 if(!pr||snapshots.length<2){toast("Не удалось вычислить геометрию группы",true);return}

 const left=Math.min(...snapshots.map(x=>x.r.left)),top=Math.min(...snapshots.map(x=>x.r.top));
 const right=Math.max(...snapshots.map(x=>x.r.right)),bottom=Math.max(...snapshots.map(x=>x.r.bottom));
 const selectedSet=new Set(nodes.map(n=>n.__id));
 const original=parent.Children||[];
 const insertAt=Math.min(...nodes.map(n=>original.indexOf(n)).filter(i=>i>=0));

 const group=normalizeNode({
  ClassName:"Frame",Name:uniqueName("Group"),
  Properties:{
   Size:u2(0,Math.max(1,roundOffset(right-left)),0,Math.max(1,roundOffset(bottom-top))),
   Position:u2(0,roundOffset(left-pr.left),0,roundOffset(top-pr.top)),
   AnchorPoint:v2(0,0),BackgroundTransparency:1,BorderSizePixel:0,ZIndex:1,Visible:true,ClipsDescendants:false
  },
  Children:[]
 });

 for(const {n,r} of snapshots){
  const a=v2v(n,"AnchorPoint",[0,0]);
  n.Properties=n.Properties||{};
  n.Properties.Position={UDim2:[[0,roundOffset(r.left-left+a[0]*r.w)],[0,roundOffset(r.top-top+a[1]*r.h)]]};
  n.Properties.Size={UDim2:[[0,Math.max(1,roundOffset(r.w))],[0,Math.max(1,roundOffset(r.h))]]};
  group.Children.push(n);
 }
 const remaining=original.filter(c=>!selectedSet.has(c.__id));
 remaining.splice(Math.max(0,insertAt),0,group);
 parent.Children=remaining;

 state.selectedId=group.__id;state.selectedIds=new Set([group.__id]);state.selectionAnchorId=group.__id;
 markDirty();renderAll();finishSelection();
 toast(nodes.length+" объектов сгруппировано");
}
function ungroupSelected(){
 const groups=selectedMoveRoots().filter(n=>n.ClassName==="Frame"&&n!==state.root&&(n.Children||[]).some(c=>!MODIFIERS.has(c.ClassName)));
 if(!groups.length){toast("Выбери Frame-группу с дочерними объектами",true);return}

 const plans=[];
 for(const g of groups){
  const parent=findParent(g.__id);if(!parent)continue;
  const parentEl=parent===state.root?els.guiRoot:els.guiRoot.querySelector(`[data-id="${parent.__id}"]`);
  const pr=localRect(parentEl);if(!pr)continue;
  const children=layoutChildNodes(g);
  const snaps=children.map(c=>({c,r:localRect(els.guiRoot.querySelector(`[data-id="${c.__id}"]`))})).filter(x=>x.r);
  if(snaps.length)plans.push({g,parent,pr,snaps,index:(parent.Children||[]).indexOf(g)});
 }
 if(!plans.length){toast("Нечего разгруппировывать",true);return}

 pushHistory();
 const moved=[];
 for(const plan of plans){
  const {g,parent,pr,snaps,index}=plan;
  const out=[];
  for(const {c,r} of snaps){
   const a=v2v(c,"AnchorPoint",[0,0]);
   c.Properties=c.Properties||{};
   c.Properties.Position={UDim2:[[0,roundOffset(r.left-pr.left+a[0]*r.w)],[0,roundOffset(r.top-pr.top+a[1]*r.h)]]};
   c.Properties.Size={UDim2:[[0,Math.max(1,roundOffset(r.w))],[0,Math.max(1,roundOffset(r.h))]]};
   out.push(c);moved.push(c);
  }
  const arr=(parent.Children||[]).filter(c=>c!==g);
  arr.splice(Math.max(0,index),0,...out);
  parent.Children=arr;
 }
 if(!moved.length)return;
 state.selectedIds=new Set(moved.map(n=>n.__id));
 state.selectedId=moved[moved.length-1].__id;
 state.selectionAnchorId=moved[0].__id;
 markDirty();renderAll();finishSelection();
 toast(groups.length+" групп разгруппировано · "+moved.length+" объектов выбрано");
}

function deleteWholeMenu(){
 const menu=selectedMenuRoot();
 if(!menu){toast("Выбранный объект не находится внутри отдельного меню",true);return}
 const parent=findParent(menu.__id);
 if(!parent||menu===state.root||menu.Name==="SafeRoot"){toast("Корневой HUD удалить этой командой нельзя",true);return}
 if(!window.confirm('Удалить меню "'+menu.Name+'" целиком?\n\nБудут удалены все дочерние UI-объекты. Undo останется доступен.'))return;
 const scene=activeSceneForMenuRoot(menu);
 pushHistory();
 parent.Children=(parent.Children||[]).filter(c=>c!==menu);
 if(scene&&state.activeUiState===scene){
  state.activeUiState=null;state.previewScene="empty";state.mode="preview";
  state.selectedId=null;state.selectedIds=new Set();state.selectionAnchorId=null;
 }else{
  state.selectedId=parent.__id;state.selectedIds=new Set([parent.__id]);state.selectionAnchorId=parent.__id;
 }
 changed();
 syncToolbarFromState();
 renderAll();
 toast(menu.Name+" · меню удалено целиком");
}

function deleteSelected(){
 const nodes=selectedNodes().filter(n=>n&&n!==state.root);
 if(!nodes.length)return;
 const ids=new Set(nodes.map(n=>n.__id));
 const primary=selected(),fallback=primary&&findParent(primary.__id);
 pushHistory();
 walk(state.root,n=>{if(n.Children)n.Children=n.Children.filter(c=>!ids.has(c.__id))});
 const next=(fallback&&!ids.has(fallback.__id)?fallback:state.root);
 state.selectedId=next.__id;state.selectedIds=new Set([next.__id]);state.selectionAnchorId=next.__id;changed();
 toast(nodes.length>1?nodes.length+" объектов удалено":"Объект удалён");
}
function duplicateSelected(){
 const n=selected();if(!n||n===state.root)return;const p=findParent(n.__id);pushHistory();const copy=normalizeNode(stripNode(n));copy.Name=uniqueName(n.Name);const pos=u2v(copy,"Position");if(pos){pos[0][1]+=12;pos[1][1]+=12;copy.Properties.Position={UDim2:pos}}p.Children.push(copy);state.selectedId=copy.__id;state.selectedIds=new Set([copy.__id]);state.selectionAnchorId=copy.__id;changed()
}


async function apiJson(url,options={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),options.timeout||1500);
 try{
  const r=await fetch(url,{...options,signal:controller.signal,cache:"no-store"});
  const type=(r.headers.get("content-type")||"").toLowerCase();
  const raw=await r.text();
  if(!type.includes("application/json")){
   const preview=raw.trim().slice(0,60).replace(/\s+/g," ");
   throw new Error("Bloom UI Server устарел или запущен не тот сервер"+(preview?" · ответ: "+preview:""));
  }
  let data;
  try{data=JSON.parse(raw)}catch{throw new Error("Сервер вернул повреждённый JSON")}
  return {r,data};
 }finally{clearTimeout(timer)}
}
async function discoverAssistantBridge(){
 const candidates=[];
 const current=location.origin;
 candidates.push(current);
 if(location.hostname==="127.0.0.1"||location.hostname==="localhost"){
  for(const port of [8765,8766,8767]){
   const base=`${location.protocol}//127.0.0.1:${port}`;
   if(!candidates.includes(base))candidates.push(base);
  }
 }
 for(const base of candidates){
  try{
   const {r,data}=await apiJson(base+"/api/health",{timeout:700});
   if(r.ok&&data?.ok&&Number(data.bridge)>=6){
    state.bridgeBase=base;
    return {ok:true,base,data};
   }
  }catch{}
 }
 state.bridgeBase="";
 return {ok:false,error:"Assistant Bridge v6 не найден. Один раз перезапусти Bloom UI Studio Server через Start Bloom UI Editor.bat"};
}
async function assistantStatus(){
 const badge=$("#aiBridgeStatus");
 if(ROFLOW_NATIVE){
  try{
   const data=await roflowInvoke("project_status");
   state.nativeProjectReady=true;
   if(badge){
    badge.textContent=(data.dirty?"SAFE SYNC · ":"")+((data.head||"").slice(0,7)||"RoFlow ready");
    badge.className="ai-bridge-status "+(data.dirty?"warn":"ready");
    badge.title=(data.dirty?"Есть локальные изменения — RoFlow сохранит их перед sync. · ":"")+(data.subject||"RoFlow native bridge");
   }
   return {...data,native:true};
  }catch(e){
   state.nativeProjectReady=false;
   if(badge){badge.textContent="SELECT PROJECT";badge.className="ai-bridge-status error";badge.title=String(e)}
   return {ok:false,error:String(e)};
  }
 }
 try{
  let bridge=state.bridgeBase?{ok:true,base:state.bridgeBase}:await discoverAssistantBridge();
  if(!bridge.ok)throw new Error(bridge.error);
  let result;
  try{result=await apiJson(bridge.base+"/api/git/status",{timeout:1800})}
  catch{
   bridge=await discoverAssistantBridge();
   if(!bridge.ok)throw new Error(bridge.error);
   result=await apiJson(bridge.base+"/api/git/status",{timeout:1800});
  }
  const {r,data}=result;
  if(!r.ok||!data.ok)throw new Error(data.error||("HTTP "+r.status));
  if(badge){
   const port=new URL(bridge.base).port||"80";
   badge.textContent=(data.dirty?"SAFE SYNC · ":"")+((data.head||"").slice(0,7)||"AI ready");
   badge.className="ai-bridge-status "+(data.dirty?"warn":"ready");
   badge.title=(data.dirty?"Есть локальные изменения — AI SYNC временно сохранит их, подтянет мои и вернёт твои. · ":"")+(data.subject||"Assistant bridge ready")+" · port "+port;
  }
  return {...data,bridgeBase:bridge.base};
 }catch(e){
  if(badge){badge.textContent="RESTART SERVER";badge.className="ai-bridge-status error";badge.title=e.message}
  return {ok:false,error:e.message};
 }
}
async function reloadModelFromServer(label="AI изменения загружены"){
 if(ROFLOW_NATIVE){
  const raw=await roflowInvoke("read_ui_model",{path:state.targetPath});
  let model;
  try{model=JSON.parse(String(raw).replace(/^\uFEFF/,""))}catch{throw new Error("BloomUI.model.json содержит неверный JSON")}
  state.nativeProjectReady=true;
  setRoot(model,label);
  return;
 }
 const base=state.bridgeBase||location.origin;
 const modelUrl=base+"/"+state.targetPath.replace(/^\/+/, "")+"?ts="+Date.now();
 const r=await fetch(modelUrl,{cache:"no-store"});
 if(!r.ok)throw new Error(state.targetPath+" was not found after sync");
 const raw=await r.text();
 if(raw.trim().startsWith("<"))throw new Error("Server returned HTML instead of "+state.targetPath);
 let model;
 try{model=JSON.parse(raw)}catch{throw new Error(state.targetPath+" contains invalid JSON")}
 setRoot(model,label);
}
async function assistantSync(){
 if(state.assistantSyncing)return;
 if(hasProjectConnection()&&state.dirty&&!state.modelLoadFailed){
  toast("AI SYNC: сначала сохраняю текущий UI…");
  await flushAutoSave();
 }
 const btn=$("#aiSyncBtn");
 state.assistantSyncing=true;
 if(btn){btn.disabled=true;btn.textContent="AI SYNC…"}
 try{
  const status=await assistantStatus();
  if(ROFLOW_NATIVE){
   if(status?.ok===false)throw new Error(status?.error||"RoFlow project недоступен");
   if(status?.dirty)toast("AI SYNC: backup → stash → pull → merge → restore");
   const data=await roflowInvoke("safe_ai_sync",{editorModel:state.targetPath===DEFAULT_TARGET&&state.root?stripNode(state.root):null});
   await reloadModelFromServer(data.changed?"AI UI обновлён из GitHub":"AI SYNC: уже актуально");
   await assistantStatus();
   if(data.modelMerged)toast(data.changed?"AI SYNC готов · UI изменения объединены":"AI SYNC готов · локальный UI сохранён");
   else if(data.stashed&&data.restored)toast(data.changed?"AI SYNC готов · локальные изменения возвращены":"AI SYNC готов · всё сохранено");
   try{window.parent?.postMessage({type:"roflow-sync-complete",status:data},"*")}catch{}
   return;
  }
  if(!status?.ok)throw new Error(status?.error||"Assistant Bridge недоступен");
  const base=status.bridgeBase||state.bridgeBase;
  if(status.dirty)toast("AI SYNC: сохраняю локальные изменения → pull → возвращаю их обратно");
  const {r,data}=await apiJson(base+"/api/git/pull",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({editor_model:state.targetPath===DEFAULT_TARGET&&state.root?stripNode(state.root):null}),
   timeout:50000
  });
  if(!r.ok||!data.ok){
   const conflicts=Array.isArray(data.conflicts)&&data.conflicts.length?" · Конфликты: "+data.conflicts.join(", "):"";
   const stash=data.stash_ref?" · Stash сохранён: "+data.stash_ref:"";
   throw new Error((data.error||data.output||("HTTP "+r.status))+conflicts+stash);
  }
  state.bridgeBase=base;
  await reloadModelFromServer(data.changed?"AI UI обновлён из GitHub":"AI SYNC: уже актуально");
  await assistantStatus();
  if(data.invalid_model_fallback)toast("AI SYNC починил повреждённый JSON · старый файл сохранён в "+(data.recovery_backup||".recovery"));
  else if(data.recovered_from_editor)toast("AI SYNC восстановил JSON из памяти редактора"+(data.recovery_backup?" · backup: "+data.recovery_backup:""));
  else if(data.stashed&&data.restored)toast(data.changed?"AI SYNC готов · твои локальные изменения сохранены":"AI SYNC готов · локальные изменения возвращены");
  if(data.changed){
   // AI SYNC can update the editor itself (index.html/app.js), not only the model.
   // Reload so new UI STATE buttons and editor features appear immediately.
   toast("AI SYNC готов · обновляю интерфейс редактора…");
   setTimeout(()=>location.reload(),450);
   return;
  }
 }catch(e){
  toast("AI SYNC: "+e.message,true);
  await assistantStatus();
 }finally{
  state.assistantSyncing=false;
  if(btn){btn.disabled=false;btn.textContent="AI SYNC"}
 }
}

async function connectProject(){
 if(ROFLOW_NATIVE){
  try{
   const dlg=roflowDialog();if(!dlg?.open)throw new Error("Native folder picker unavailable");
   const selected=await dlg.open({directory:true,multiple:false,title:"Choose Bloom_RNG project"});
   if(!selected)return;
   await roflowInvoke("set_project_root",{path:selected});
   state.nativeProjectReady=true;
   try{window.parent?.postMessage({type:"roflow-project-changed",path:selected},"*")}catch{}
   await pullProject();updateStatus();await assistantStatus();
   toast("Проект подключён: "+String(selected).split(/[\\/]/).filter(Boolean).pop());
   if(state.dirty||state.modelLoadFailed)scheduleAutoSave(80);
  }catch(e){toast(String(e),true)}
  return;
 }
 if(!window.showDirectoryPicker){toast("Нужен Chrome/Edge на localhost",true);return}
 try{
  state.projectHandle=await window.showDirectoryPicker({mode:"readwrite"});
  await saveHandle(state.projectHandle);updateStatus();toast("Проект подключён: "+state.projectHandle.name);if(state.dirty||state.modelLoadFailed)scheduleAutoSave(80)
 }catch(e){if(e.name!=="AbortError")toast(e.message,true)}
}
async function getFile(path,create=false){
 if(!state.projectHandle)throw new Error("Сначала подключи C:\\Bloom_RNG");
 const parts=path.replace(/\\/g,"/").split("/").filter(Boolean),file=parts.pop();let dir=state.projectHandle;
 for(const part of parts)dir=await dir.getDirectoryHandle(part,{create});
 return dir.getFileHandle(file,{create});
}

async function writeCurrentModel({silent=false,force=false}={}){
 if(state.autoSaving){state.autoSaveQueued=true;return true}
 if(!hasProjectConnection())return false;
 if(!state.root)return false;

 // If disk JSON was damaged, only repair it when the editor has a real HUD tree.
 if(state.modelLoadFailed&&!currentModelLooksSafe()){
  if(!silent)toast("Сохранение заблокировано: recovery-модель HUD не найдена",true);
  return false;
 }

 let payload;
 try{
  payload=serialize(true)+"\n";
  JSON.parse(payload);
 }catch(e){
  if(!silent)toast("Autosave отменён: модель в памяти невалидна",true);
  return false;
 }

 state.autoSaving=true;
 state.autoSaveQueued=false;
 try{
  if(ROFLOW_NATIVE){
   await roflowInvoke("write_ui_model",{contents:payload,path:state.targetPath});
  }else{
   const h=await getFile(state.targetPath,true);
   const w=await h.createWritable();
   await w.write(payload);
   await w.close();
  }

  state.dirty=false;
  state.modelLoadFailed=false;
  state.lastAutoSaveError="";
  try{localStorage.setItem(lastGoodModelKey(),serialize(false))}catch{}
  const push=$("#pushBtn");
  if(push){push.disabled=false;push.title="Записать модель в игру"}
  updateStatus();
  if(!silent)toast("Сохранено в "+state.targetPath+" — Rojo может синхронизировать");
  return true;
 }catch(e){
  state.lastAutoSaveError=e?.message||String(e);
  if(!silent)toast("Не удалось записать: "+state.lastAutoSaveError,true);
  return false;
 }finally{
  state.autoSaving=false;
  if(state.autoSaveQueued){
   state.autoSaveQueued=false;
   scheduleAutoSave(80);
  }
 }
}
async function autoSaveNow(silent=true){
 clearTimeout(state.autoSaveTimer);
 state.autoSaveTimer=null;
 return await writeCurrentModel({silent});
}
async function flushAutoSave(){
 clearTimeout(state.autoSaveTimer);
 state.autoSaveTimer=null;
 if(!hasProjectConnection())return false;
 if(!state.dirty&&!state.modelLoadFailed)return true;
 return await writeCurrentModel({silent:true,force:true});
}

async function pullProject(){
 try{
  if(ROFLOW_NATIVE){
   const text=await roflowInvoke("read_ui_model",{path:state.targetPath});
   state.nativeProjectReady=true;
   setRoot(JSON.parse(String(text).replace(/^\uFEFF/,"")),"Loaded "+state.targetPath);
   return true;
  }
  const h=await getFile(state.targetPath,false),f=await h.getFile(),raw=JSON.parse(await f.text());
  setRoot(raw,"Loaded "+state.targetPath);
  return true;
 }catch(e){
  toast("Could not read "+state.targetPath+": "+e.message,true);
  return false;
 }
}
async function pushProject(){
 const ok=await writeCurrentModel({silent:false,force:true});
 if(ok)assistantStatus();
}
function download(){
 const blob=new Blob([serialize(true)+"\n"],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(state.root?.Name||"BloomUI")+".model.json";a.click();URL.revokeObjectURL(a.href)
}
async function copyModel(){await navigator.clipboard.writeText(serialize(true));toast("Полная Roblox-модель скопирована для ChatGPT")}
function importFile(file){const r=new FileReader();r.onload=()=>{try{setRoot(JSON.parse(r.result),"JSON импортирован")}catch(e){toast(e.message,true)}};r.readAsText(file)}

function toast(msg,error=false){els.toast.textContent=msg;els.toast.style.borderColor=error?"#a94455":"#45617c";els.toast.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove("show"),2600)}
async function saveHandle(handle){
 try{const db=await idb();const tx=db.transaction("kv","readwrite");tx.objectStore("kv").put(handle,"projectHandle")}catch{}
}
async function loadHandle(){
 try{const db=await idb();return await new Promise((res,rej)=>{const q=db.transaction("kv").objectStore("kv").get("projectHandle");q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}catch{return null}
}
function idb(){return new Promise((res,rej)=>{const q=indexedDB.open("BloomUIStudio",1);q.onupgradeneeded=()=>q.result.createObjectStore("kv");q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}

async function loadInitial(){
 if(ROFLOW_NATIVE){
  try{
   const raw=await roflowInvoke("read_ui_model",{path:state.targetPath});
   state.nativeProjectReady=true;
   setRoot(JSON.parse(String(raw).replace(/^\uFEFF/,"")),"Текущий BloomUI открыт в RoFlow");
   return;
  }catch(e){
   state.nativeProjectReady=false;
   const backup=localStorage.getItem(lastGoodModelKey());
   if(backup){try{state.root=normalizeNode(JSON.parse(backup));state.selectedId=state.root.__id;state.selectedIds=new Set([state.selectedId]);state.selectionAnchorId=state.selectedId;renderAll()}catch{}}
   const push=$("#pushBtn");if(push){push.disabled=true;push.title="Сначала выбери проект в RoFlow"}
   const empty=$("#emptyCanvas");
   if(empty){
    empty.classList.remove("hidden");
    const title=empty.querySelector("strong"),copy=empty.querySelector("span");
    if(title)title.textContent="UI model failed to load";
    if(copy)copy.textContent="RoFlow could not read "+state.targetPath+". Check the project connection or press Reload.";
   }
   console.error("[Bloom UI Studio] native model load failed",e);
   toast("Не удалось загрузить UI: "+String(e),true);
   return;
  }
 }
 state.projectHandle=await loadHandle();
 try{
  const r=await fetch("/"+state.targetPath.replace(/^\/+/, "")+"?ts="+Date.now(),{cache:"no-store"});
  if(r.ok){
   const raw=await r.text();
   try{
    setRoot(JSON.parse(raw.replace(/^\uFEFF/,"")),"Текущий BloomUI открыт");
    return;
   }catch(parseError){
    console.error("[Bloom UI Studio] BloomUI.model.json parse error",parseError);
    state.modelLoadFailed=true;
    const backup=localStorage.getItem(lastGoodModelKey());
    let recovered=false;
    if(backup){
     try{
      state.root=normalizeNode(JSON.parse(backup));
      const safe=(state.root.Children||[]).find(x=>x.Name==="SafeRoot"&&x.ClassName==="Frame");
      state.selectedId=(safe||state.root).__id;state.selectedIds=new Set([state.selectedId]);state.selectionAnchorId=state.selectedId;
      state.history=[];state.future=[];markDirty();recovered=currentModelLooksSafe();
      renderAll();
     }catch{}
    }
    const push=$("#pushBtn");
    if(recovered){
     if(push){push.disabled=false;push.title="Восстановить повреждённый BloomUI.model.json из последней рабочей модели"}
     toast("RECOVERY MODE: рабочая модель найдена · JSON будет восстановлен автосохранением",true);
     scheduleAutoSave(80);
    }else{
     if(push){push.disabled=true;push.title="Заблокировано: нет безопасной recovery-модели"}
     toast("RECOVERY MODE: JSON повреждён и безопасной копии HUD нет",true);
    }
    return;
   }
  }
  throw new Error(state.targetPath+" not found");
 }catch(e){
  state.modelLoadFailed=true;
  const backup=localStorage.getItem(lastGoodModelKey());
  if(backup){try{state.root=normalizeNode(JSON.parse(backup));state.selectedId=state.root.__id;state.selectedIds=new Set([state.selectedId]);state.selectionAnchorId=state.selectedId;renderAll()}catch{}}
  const push=$("#pushBtn");if(push){push.disabled=true;push.title="Заблокировано: исходная модель не загружена"}
  toast("Could not load "+state.targetPath+". Saving is blocked: "+e.message,true);
 }
}

$("#palette").addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(b)addObject(b.dataset.add)});
$("#patternPalette")?.addEventListener("click",e=>{const b=e.target.closest("[data-pattern]");if(b)createPattern(b.dataset.pattern)});
$("#createFirstFrame").onclick=()=>addObject("Frame");
$("#deleteBtn").onclick=deleteSelected;$("#deleteMenuBtn")?.addEventListener("click",deleteWholeMenu);$("#duplicateBtn").onclick=duplicateSelected;$("#outdentBtn").onclick=outdentSelected;$("#groupBtn").onclick=groupSelected;$("#ungroupBtn").onclick=ungroupSelected;
$("#connectBtn").onclick=connectProject;$("#pullBtn").onclick=pullProject;$("#pushBtn").onclick=pushProject;$("#aiSyncBtn").onclick=assistantSync;
$("#exportBtn").onclick=download;$("#copyBtn").onclick=copyModel;$("#importBtn").onclick=()=>els.fileInput.click();
els.fileInput.onchange=()=>els.fileInput.files[0]&&importFile(els.fileInput.files[0]);
$("#presetSelect").onchange=e=>{const [w,h]=e.target.value.split("x").map(Number);state.viewport={w,h};$("#viewportW").value=w;$("#viewportH").value=h;renderAll();savePrefs();fitViewport()};
$("#viewportW").onchange=e=>{state.viewport.w=Math.max(100,+e.target.value);renderAll();savePrefs()};$("#viewportH").onchange=e=>{state.viewport.h=Math.max(100,+e.target.value);renderAll();savePrefs()};
$("#zoomRange").oninput=e=>setZoom(+e.target.value/100);
$("#snapSelect").onchange=e=>{state.snap=+e.target.value;savePrefs()};
$("#labelsToggle").onchange=e=>{state.labels=e.target.checked;renderViewport();updateOverlay();savePrefs()};
$("#gridToggle").onchange=e=>{state.grid=e.target.checked;els.stageScroller.classList.toggle("no-grid",!state.grid);savePrefs()};
$("#geometryToggle").onchange=e=>{state.geometry=e.target.checked;renderViewport();updateOverlay();savePrefs();toast(state.geometry?"Geometry helpers включены":"Geometry helpers выключены")};
$("#hiddenToggle").onchange=e=>{state.showHidden=e.target.checked;renderViewport();renderTree();updateOverlay();toast(state.showHidden?"Скрытые Roblox-объекты показаны только в редакторе":"Скрытые Roblox-объекты спрятаны");savePrefs()};
$("#modeSelect").onchange=()=>{};
$("#sceneSelect").onchange=()=>{};
 $("#uiStateBar")?.addEventListener("click",e=>{const b=e.target.closest("[data-ui-state]");if(!b)return;activateUiState(b.dataset.uiState).catch(error=>{console.error("[Bloom UI Studio] state activation failed",error);toast("UI State не загрузился: "+String(error),true)})});
$("#insetInput").onchange=e=>{state.inset=Math.max(0,+e.target.value);renderAll();savePrefs()};
$("#bgBtn").onclick=()=>$("#bgInput").click();
$("#bgClearBtn").onclick=()=>{els.device.style.backgroundImage="";els.device.style.backgroundColor="#182332";toast("Фон убран")};
$("#bgInput").onchange=()=>{
 const file=$("#bgInput").files?.[0];if(!file)return;
 const url=URL.createObjectURL(file),img=new Image();
 img.onload=()=>{
  els.device.style.backgroundImage=`url("${url}")`;
  els.device.style.backgroundSize="cover";els.device.style.backgroundPosition="center";
  if(img.naturalWidth>100&&img.naturalHeight>100){
   state.viewport={w:img.naturalWidth,h:img.naturalHeight};
   $("#viewportW").value=img.naturalWidth;$("#viewportH").value=img.naturalHeight;
   $("#presetSelect").value="";
  }
  renderAll();toast("Скриншот Roblox установлен как фон");
 };
 img.src=url;
};

$("#undoBtn").onclick=undo;$("#redoBtn").onclick=redo;
$("#fitBtn").onclick=fitViewport;$("#zoom100Btn").onclick=()=>setZoom(1);$("#focusBtn").onclick=focusSelected;
$("#treeSearch").addEventListener("input",e=>{state.treeQuery=e.target.value;renderTree()});
for(const [id,side] of [["explorerResizer","explorer"],["inspectorResizer","inspector"]]){
 const handle=$("#"+id);
 handle?.addEventListener("pointerdown",e=>{
  if(e.button!==0)return;
  e.preventDefault();
  state.panelResize={side};
  handle.classList.add("dragging");
  document.body.classList.add("panel-resizing");
 });
}
els.stageScroller.addEventListener("wheel",e=>{
 if(!e.deltaX&&!e.deltaY)return;
 e.preventDefault();
 if(e.ctrlKey||e.metaKey){
  const raw=e.deltaMode===1?e.deltaY*16:e.deltaMode===2?e.deltaY*els.stageScroller.clientHeight:e.deltaY;
  const delta=clamp(raw,-160,160);
  const factor=Math.exp(-delta*.0028);
  zoomAtClientPoint(state.zoom*factor,e.clientX,e.clientY);
  return;
 }
 els.stageScroller.scrollLeft+=e.deltaX;
 els.stageScroller.scrollTop+=e.deltaY;
},{passive:false});

els.stageScroller.addEventListener("pointerdown",e=>{
 if(e.pointerType==="touch"){
  touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try{els.stageScroller.setPointerCapture(e.pointerId)}catch{}
  if(touchPoints.size===2){
   const pts=[...touchPoints.values()];
   const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
   touchPinch={
    distance:Math.max(1,Math.hypot(dx,dy)),
    zoom:state.zoom,
    centerX:(pts[0].x+pts[1].x)/2,
    centerY:(pts[0].y+pts[1].y)/2
   };
  }
  return;
 }
 if(e.button!==1)return;
 e.preventDefault();
 state.pan={x:e.clientX,y:e.clientY,left:els.stageScroller.scrollLeft,top:els.stageScroller.scrollTop};
 els.stageScroller.classList.add("panning");
});
window.addEventListener("pointermove",e=>{
 if(e.pointerType==="touch"&&touchPoints.has(e.pointerId)){
  touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touchPoints.size===2&&touchPinch){
   const pts=[...touchPoints.values()];
   const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
   const distance=Math.max(1,Math.hypot(dx,dy));
   const centerX=(pts[0].x+pts[1].x)/2,centerY=(pts[0].y+pts[1].y)/2;
   zoomAtClientPoint(touchPinch.zoom*(distance/touchPinch.distance),centerX,centerY);
  }
  return;
 }
 if(!state.pan)return;
 els.stageScroller.scrollLeft=state.pan.left-(e.clientX-state.pan.x);
 els.stageScroller.scrollTop=state.pan.top-(e.clientY-state.pan.y);
});
function endTouchPointer(e){
 if(e.pointerType!=="touch")return;
 touchPoints.delete(e.pointerId);
 if(touchPoints.size<2)touchPinch=null;
}
window.addEventListener("pointerup",e=>{
 endTouchPointer(e);
 if(state.pan){state.pan=null;els.stageScroller.classList.remove("panning")}
});
window.addEventListener("pointercancel",endTouchPointer);
async function setEditorSuspended(suspended,{flush=false}={}){
 if(suspended===state.suspended){
  if(suspended&&flush)return await flushAutoSave();
  return true;
 }
 if(suspended){
  state.suspended=true;
  clearTimeout(state.autoSaveTimer);state.autoSaveTimer=null;
  let saved=true;
  if(flush)saved=await flushAutoSave();
  engineV2?.suspend?.();
  nativeThumbnailCache.clear();
  touchPoints.clear();touchPinch=null;
  state.pan=null;state.drag=null;
  return saved;
 }
 state.suspended=false;
 engineV2?.resume?.();
 renderAll();
 return true;
}
window.addEventListener("beforeunload",e=>{if(state.dirty){e.preventDefault();e.returnValue=""}});

$("#dialogClose").onclick=()=>els.jsonDialog.close();$("#dialogCopy").onclick=()=>navigator.clipboard.writeText(els.jsonArea.value);
$("#dialogApply").onclick=()=>{try{setRoot(JSON.parse(els.jsonArea.value),"JSON применён");els.jsonDialog.close()}catch(e){toast(e.message,true)}};
$("#addMenuBtn").onclick=()=>{
 const patterns=$("#patternPalette"),patternDrawer=patterns?.closest("details");
 if(patternDrawer)patternDrawer.open=true;
 patterns?.scrollIntoView({behavior:"smooth",block:"nearest"});
};
window.addEventListener("resize",()=>{updateOverlay();updatePixelReadout()});
window.addEventListener("keydown",e=>{
 const tag=document.activeElement?.tagName;if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;
 const mod=e.ctrlKey||e.metaKey,code=e.code;
 if(mod&&code==="KeyZ"){e.preventDefault();e.shiftKey?redo():undo();return}
 if(mod&&code==="KeyY"){e.preventDefault();redo();return}
 if(mod&&code==="KeyD"){e.preventDefault();duplicateSelected();return}
 if(mod&&code==="KeyC"){e.preventDefault();copySelectedObject();return}
 if(mod&&code==="KeyV"){e.preventDefault();pasteObject();return}
 if(mod&&code==="KeyF"){e.preventDefault();$("#treeSearch").focus();$("#treeSearch").select();return}
 if(mod&&code==="KeyG"){e.preventDefault();e.shiftKey?ungroupSelected():groupSelected();return}
 if(mod&&e.altKey&&code==="ArrowUp"){e.preventDefault();outdentSelected();return}
 if(mod&&code==="KeyA"){e.preventDefault();selectAllSiblings();return}
 if(code==="Escape"&&state.selectedIds.size>1){e.preventDefault();collapseSelectionToPrimary();return}
 if(code==="Escape"&&state.activeUiState){e.preventDefault();activateUiState(state.activeUiState);return}
 if(code==="F2"){e.preventDefault();renameSelected();return}
 if(code==="KeyF"){e.preventDefault();focusSelected();return}
 if(code==="Digit0"||code==="Numpad0"){e.preventDefault();fitViewport();return}
 if(code==="Equal"||code==="NumpadAdd"){e.preventDefault();setZoom(state.zoom*1.1);return}
 if(code==="Minus"||code==="NumpadSubtract"){e.preventDefault();setZoom(state.zoom/1.1);return}
 if(mod&&code==="KeyS"){e.preventDefault();hasProjectConnection()?pushProject():download();return}
 if(code==="Delete"){deleteSelected();return}
 const nodes=selectedMoveRoots();if(!nodes.length)return;
 const step=e.shiftKey?state.snap:1;
 let dx=0,dy=0;
 if(code==="ArrowLeft")dx=-step;
 else if(code==="ArrowRight")dx=step;
 else if(code==="ArrowUp")dy=-step;
 else if(code==="ArrowDown")dy=step;
 else return;
 e.preventDefault();pushHistory();
 for(const n of nodes){
  const p=u2v(n,"Position");p[0][1]+=dx;p[1][1]+=dy;n.Properties.Position={UDim2:p};
 }
 changed()
});

async function bootEditor(){
 await loadProjectUiConfig();
 loadPrefs();
 syncToolbarFromState();
 hydrateStudioIcons();
 await loadInitial();
 requestAnimationFrame(()=>fitViewport());
 assistantStatus();
 setInterval(()=>{
  if(!state.suspended&&!document.hidden&&state.dirty&&hasProjectConnection()&&!state.assistantSyncing&&!state.autoSaving&&!state.autoSaveTimer)scheduleAutoSave(180)
 },1500);
}
bootEditor().catch(error=>{console.error("[RoFlow UI Studio] boot failed",error);toast("UI Studio boot failed: "+String(error),true)});
})();

window.addEventListener("message",async event=>{
 if(event.data?.type==="roflow-suspend"&&ROFLOW_NATIVE){
  const ok=await setEditorSuspended(true,{flush:event.data.flush!==false});
  try{window.parent?.postMessage({type:"roflow-suspend-ready",requestId:event.data.requestId,ok},"*")}catch{}
  return;
 }
 if(event.data?.type==="roflow-resume"&&ROFLOW_NATIVE){
  await setEditorSuspended(false);
  return;
 }
 if(event.data?.type==="roflow-refresh-model"&&ROFLOW_NATIVE){
  await setEditorSuspended(false);
  reloadModelFromServer("RoFlow sync: model refreshed").catch(error=>toast(String(error),true));
 }
});

document.addEventListener("visibilitychange",()=>{
 if(!ROFLOW_NATIVE)return;
 if(document.hidden)setEditorSuspended(true,{flush:false});
 else if(window.parent===window)setEditorSuspended(false);
});
