(()=>{
"use strict";

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
const rgba=(value,transparency=0)=>{
 const c=Array.isArray(value)?value:[1,1,1];
 const a=clamp(1-finite(transparency),0,1);
 return "rgba("+Math.round(clamp(c[0],0,1)*255)+","+Math.round(clamp(c[1],0,1)*255)+","+Math.round(clamp(c[2],0,1)*255)+","+a+")";
};
const udim=value=>{
 const v=value&&value.UDim?value.UDim:value;
 return Array.isArray(v)?[finite(v[0]),finite(v[1])]:[0,0];
};
const udim2=value=>{
 const v=value&&value.UDim2?value.UDim2:value;
 return Array.isArray(v)&&Array.isArray(v[0])&&Array.isArray(v[1])
  ?[[finite(v[0][0]),finite(v[0][1])],[finite(v[1][0]),finite(v[1][1])]]
  :[[0,0],[0,0]];
};
const vector2=(value,fallback=[0,0])=>{
 const v=value&&value.Vector2?value.Vector2:value;
 return Array.isArray(v)?[finite(v[0]),finite(v[1])]:fallback.slice();
};
const intersect=(a,b)=>{
 if(!a)return b?{...b}:null;
 if(!b)return {...a};
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
 const r=Math.min(a.x+a.w,b.x+b.w),bt=Math.min(a.y+a.h,b.y+b.h);
 return {x,y,w:Math.max(0,r-x),h:Math.max(0,bt-y)};
};
const inside=(rect,x,y)=>x>=rect.x&&y>=rect.y&&x<=rect.x+rect.w&&y<=rect.y+rect.h;
const roundedPath=(ctx,x,y,w,h,r)=>{
 const radius=Math.max(0,Math.min(r,w/2,h/2));
 ctx.beginPath();
 if(ctx.roundRect){ctx.roundRect(x,y,w,h,radius);return}
 ctx.moveTo(x+radius,y);ctx.lineTo(x+w-radius,y);ctx.quadraticCurveTo(x+w,y,x+w,y+radius);
 ctx.lineTo(x+w,y+h-radius);ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);
 ctx.lineTo(x+radius,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-radius);
 ctx.lineTo(x,y+radius);ctx.quadraticCurveTo(x,y,x+radius,y);ctx.closePath();
};
const sortChildren=children=>(children||[]).map((node,index)=>({node,index})).sort((a,b)=>{
 const az=finite(a.node&&a.node.Properties&&a.node.Properties.ZIndex,1);
 const bz=finite(b.node&&b.node.Properties&&b.node.Properties.ZIndex,1);
 if(az!==bz)return az-bz;
 const ao=finite(a.node&&a.node.Properties&&a.node.Properties.LayoutOrder,0);
 const bo=finite(b.node&&b.node.Properties&&b.node.Properties.LayoutOrder,0);
 return ao===bo?a.index-b.index:ao-bo;
}).map(entry=>entry.node);

class BloomEditorEngineV2{
 constructor(options){
  this.canvas=options.canvas;
  this.proxyHost=options.proxyHost;
  this.device=options.device;
  this.scroller=options.scroller;
  this.adapter=options.adapter||{};
  this.ctx=this.canvas.getContext("2d",{alpha:true,desynchronized:true});
  this.scene=[];
  this.byId=new Map();
  this.imageCache=new Map();
  this.model=null;
  this.suspended=false;
  this.view={viewport:{w:1366,h:768},zoom:1,inset:0,showHidden:true,labels:false,selectedIds:new Set()};
  this.pointer={x:0,y:0,hit:null};
  this._onPointerDown=event=>this.onPointerDown(event);
  this._onPointerMove=event=>this.onPointerMove(event);
  this.canvas.addEventListener("pointerdown",this._onPointerDown);
  this.canvas.addEventListener("pointermove",this._onPointerMove);
  this.canvas.addEventListener("contextmenu",event=>event.preventDefault());
  this.canvas.dataset.engine="canvas2d-v2";
 }
 destroy(){
  this.canvas.removeEventListener("pointerdown",this._onPointerDown);
  this.canvas.removeEventListener("pointermove",this._onPointerMove);
  this.scene=[];this.byId.clear();this.imageCache.clear();
  this.canvas.width=1;this.canvas.height=1;
  if(this.proxyHost)this.proxyHost.innerHTML="";
 }
 suspend(){
  if(this.suspended)return;
  this.suspended=true;
  this.scene=[];this.byId.clear();this.imageCache.clear();
  if(this.proxyHost)this.proxyHost.innerHTML="";
  this.canvas.width=1;this.canvas.height=1;
 }
 resume(){
  if(!this.suspended)return;
  this.suspended=false;
  if(!this.model)return;
  this.resizeSurface();
  this.buildScene();
  this.syncProxies();
  this.paint();
 }
 render(payload){
  this.model=payload.root||null;
  this.view={
   viewport:{w:Math.max(1,finite(payload.viewport&&payload.viewport.w,1366)),h:Math.max(1,finite(payload.viewport&&payload.viewport.h,768))},
   zoom:Math.max(.01,finite(payload.zoom,1)),
   inset:Math.max(0,finite(payload.inset,0)),
   showHidden:payload.showHidden!==false,
   labels:payload.labels===true,
   selectedIds:payload.selectedIds instanceof Set?payload.selectedIds:new Set(payload.selectedIds||[]),
   activeUiState:payload.activeUiState||null,
   previewScene:payload.previewScene||null
  };
  if(this.suspended)return;
  this.resizeSurface();
  this.buildScene();
  this.syncProxies();
  this.paint();
 }
 resizeSurface(){
  const w=this.view.viewport.w,h=this.view.viewport.h;
  const nativeCap=window.__ROFLOW_EMBEDDED__===true?1.35:2;
  const dpr=Math.min(nativeCap,Math.max(1,window.devicePixelRatio||1)*Math.max(1,Math.min(this.view.zoom,1.35)));
  const width=Math.max(1,Math.round(w*dpr)),height=Math.max(1,Math.round(h*dpr));
  if(this.canvas.width!==width)this.canvas.width=width;
  if(this.canvas.height!==height)this.canvas.height=height;
  this.canvas.style.width=w+"px";this.canvas.style.height=h+"px";
  this.ctx.setTransform(dpr,0,0,dpr,0,0);
  this.pixelRatio=dpr;
 }
 modifier(node,kind){
  if(this.adapter.modifier)return this.adapter.modifier(node,kind);
  return (node&&node.Children||[]).find(child=>child.ClassName===kind);
 }
 isModifier(node){
  return this.adapter.isModifier?this.adapter.isModifier(node):false;
 }
 previewVisible(node){
  return this.adapter.previewVisible?this.adapter.previewVisible(node):null;
 }
 previewSize(node){
  return this.adapter.previewSize?this.adapter.previewSize(node):null;
 }
 nodeSize(node,parentRect){
  const p=node.Properties||{};
  const runtime=this.previewSize(node);
  const value=udim2(runtime||p.Size||[[0,100],[0,100]]);
  let w=value[0][0]*parentRect.w+value[0][1],h=value[1][0]*parentRect.h+value[1][1];
  const aspect=this.modifier(node,"UIAspectRatioConstraint");
  if(aspect){
   const ap=aspect.Properties||{},ratio=Math.max(.0001,finite(ap.AspectRatio,1));
   if((ap.DominantAxis||"Width")==="Height")w=h*ratio;else h=w/ratio;
  }
  return {w:Math.max(0,w),h:Math.max(0,h)};
 }
 nodeRect(node,parentRect,override){
  if(override)return {...override};
  const p=node.Properties||{},size=this.nodeSize(node,parentRect);
  const pos=udim2(p.Position||[[0,0],[0,0]]);
  const anchor=vector2(p.AnchorPoint,[0,0]);
  const px=parentRect.x+pos[0][0]*parentRect.w+pos[0][1];
  const py=parentRect.y+pos[1][0]*parentRect.h+pos[1][1];
  return {x:px-anchor[0]*size.w,y:py-anchor[1]*size.h,w:size.w,h:size.h};
 }
 paddingRect(node,rect){
  const padding=this.modifier(node,"UIPadding");
  if(!padding)return {...rect};
  const p=padding.Properties||{};
  const left=udim(p.PaddingLeft),right=udim(p.PaddingRight),top=udim(p.PaddingTop),bottom=udim(p.PaddingBottom);
  const l=left[0]*rect.w+left[1],r=right[0]*rect.w+right[1],t=top[0]*rect.h+top[1],b=bottom[0]*rect.h+bottom[1];
  return {x:rect.x+l,y:rect.y+t,w:Math.max(0,rect.w-l-r),h:Math.max(0,rect.h-t-b)};
 }
 childLayout(node,rect,children){
  const list=this.modifier(node,"UIListLayout"),grid=this.modifier(node,"UIGridLayout");
  if(!list&&!grid)return null;
  const content=this.paddingRect(node,rect),map=new Map();
  const ordered=sortChildren(children);
  if(list){
   const p=list.Properties||{},horizontal=(p.FillDirection||"Vertical")==="Horizontal";
   const pad=udim(p.Padding),axis=horizontal?content.w:content.h;
   const gap=pad[0]*axis+pad[1];
   const sizes=ordered.map(child=>this.nodeSize(child,content));
   const total=sizes.reduce((sum,size)=>sum+(horizontal?size.w:size.h),0)+Math.max(0,sizes.length-1)*gap;
   let cursor=horizontal?content.x:content.y;
   const mainAlign=horizontal?(p.HorizontalAlignment||"Left"):(p.VerticalAlignment||"Top");
   const mainSpace=horizontal?content.w:content.h;
   if(mainAlign==="Center")cursor+=(mainSpace-total)/2;
   else if(mainAlign==="Right"||mainAlign==="Bottom")cursor+=mainSpace-total;
   ordered.forEach((child,index)=>{
    const size=sizes[index];
    let x=content.x,y=content.y;
    if(horizontal){
     x=cursor;
     const align=p.VerticalAlignment||"Center";
     y=align==="Bottom"?content.y+content.h-size.h:align==="Top"?content.y:content.y+(content.h-size.h)/2;
     cursor+=size.w+gap;
    }else{
     y=cursor;
     const align=p.HorizontalAlignment||"Left";
     x=align==="Right"?content.x+content.w-size.w:align==="Center"?content.x+(content.w-size.w)/2:content.x;
     cursor+=size.h+gap;
    }
    map.set(child.__id,{x,y,w:size.w,h:size.h});
   });
   return map;
  }
  const gp=grid.Properties||{},cell=udim2(gp.CellSize||[[0,64],[0,64]]),gap=udim2(gp.CellPadding||[[0,6],[0,6]]);
  const cellW=Math.max(1,cell[0][0]*content.w+cell[0][1]),cellH=Math.max(1,cell[1][0]*content.h+cell[1][1]);
  const gapX=gap[0][0]*content.w+gap[0][1],gapY=gap[1][0]*content.h+gap[1][1];
  let columns=Math.max(1,Math.floor((content.w+gapX)/(cellW+gapX)));
  const maxCells=Math.max(0,Math.floor(finite(gp.FillDirectionMaxCells,0)));
  if(maxCells>0)columns=Math.min(columns,maxCells);
  ordered.forEach((child,index)=>{
   const col=index%columns,row=Math.floor(index/columns);
   map.set(child.__id,{x:content.x+col*(cellW+gapX),y:content.y+row*(cellH+gapY),w:cellW,h:cellH});
  });
  return map;
 }
 buildScene(){
  this.scene=[];this.byId.clear();
  if(!this.model)return;
  const viewport=this.view.viewport;
  const rootRect={x:0,y:this.view.inset,w:viewport.w,h:Math.max(0,viewport.h-this.view.inset)};
  const roots=this.model.ClassName==="ScreenGui"?(this.model.Children||[]):[this.model];
  this.walkChildren(sortChildren(roots),rootRect,null,null,null);
 }
 walkChildren(children,parentRect,parentNode,parentClip,parentLayoutMap){
  for(const node of children||[]){
   if(this.isModifier(node))continue;
   const forced=this.previewVisible(node);
   const runtimeHidden=node.Properties&&node.Properties.Visible===false;
   if(forced===false)continue;
   if(runtimeHidden&&forced!==true&&!this.view.showHidden)continue;
   const rect=this.nodeRect(node,parentRect,parentLayoutMap&&parentLayoutMap.get(node.__id));
   if(rect.w<=0||rect.h<=0)continue;
   const p=node.Properties||{},anchor=vector2(p.AnchorPoint,[0,0]);
   const item={
    id:node.__id,node,parentNode,rect,anchor,rotation:finite(p.Rotation,0),
    hidden:runtimeHidden&&forced!==true,clip:parentClip,z:finite(p.ZIndex,1),
    clips:p.ClipsDescendants===true
   };
   this.scene.push(item);this.byId.set(item.id,item);
   const childClip=item.clips?intersect(parentClip,rect):parentClip;
   const childNodes=(node.Children||[]).filter(child=>!this.isModifier(child));
   const childLayoutMap=this.childLayout(node,rect,childNodes);
   let childRect=rect;
   if(node.ClassName==="ScrollingFrame"){
    const cp=vector2(p.CanvasPosition,[0,0]);
    childRect={x:rect.x-cp[0],y:rect.y-cp[1],w:rect.w,h:rect.h};
   }
   this.walkChildren(sortChildren(childNodes),childRect,node,childClip,childLayoutMap);
  }
 }
 syncProxies(){
  if(!this.proxyHost)return;
  this.proxyHost.innerHTML="";
  const frag=document.createDocumentFragment();
  for(const item of this.scene){
   const el=document.createElement("div");
   el.className="gui-node engine-proxy";
   el.dataset.id=item.id;el.dataset.class=item.node.ClassName;
   el.style.left=item.rect.x+"px";el.style.top=item.rect.y+"px";
   el.style.width=item.rect.w+"px";el.style.height=item.rect.h+"px";
   el.style.zIndex=String(item.z);
   if(item.rotation){
    const ox=item.anchor[0]*100,oy=item.anchor[1]*100;
    el.style.transformOrigin=ox+"% "+oy+"%";
    el.style.transform="rotate("+item.rotation+"deg)";
   }
   frag.appendChild(el);
  }
  this.proxyHost.appendChild(frag);
 }
 applyClip(item){
  if(!item.clip)return false;
  const c=item.clip;
  this.ctx.beginPath();this.ctx.rect(c.x,c.y,c.w,c.h);this.ctx.clip();
  return true;
 }
 cornerRadius(item){
  const corner=this.modifier(item.node,"UICorner");
  if(!corner)return 0;
  const value=udim(corner.Properties&&corner.Properties.CornerRadius||[0,0]);
  return Math.max(0,value[0]*Math.min(item.rect.w,item.rect.h)+value[1]);
 }
 paint(){
  if(this.suspended)return;
  const ctx=this.ctx,w=this.view.viewport.w,h=this.view.viewport.h;
  ctx.save();ctx.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);ctx.clearRect(0,0,w,h);
  for(const item of this.scene)this.paintItem(item);
  ctx.restore();
 }
 paintItem(item){
  const ctx=this.ctx,r=item.rect,p=item.node.Properties||{};
  ctx.save();
  this.applyClip(item);
  if(item.hidden)ctx.globalAlpha*=.34;
  if(item.rotation){
   const ox=r.x+item.anchor[0]*r.w,oy=r.y+item.anchor[1]*r.h;
   ctx.translate(ox,oy);ctx.rotate(item.rotation*Math.PI/180);ctx.translate(-ox,-oy);
  }
  const radius=this.cornerRadius(item);
  const bgTransparency=finite(p.BackgroundTransparency,0);
  if(bgTransparency<1){
   roundedPath(ctx,r.x,r.y,r.w,r.h,radius);
   ctx.fillStyle=rgba(p.BackgroundColor3||[1,1,1],bgTransparency);ctx.fill();
  }
  const border=Math.max(0,finite(p.BorderSizePixel,0));
  if(border>0){
   roundedPath(ctx,r.x+.5*border,r.y+.5*border,Math.max(0,r.w-border),Math.max(0,r.h-border),radius);
   ctx.strokeStyle=rgba(p.BorderColor3||[0,0,0],0);ctx.lineWidth=border;ctx.stroke();
  }
  const stroke=this.modifier(item.node,"UIStroke");
  if(stroke){
   const sp=stroke.Properties||{},th=Math.max(0,finite(sp.Thickness,1));
   if(th>0&&finite(sp.Transparency,0)<1){
    roundedPath(ctx,r.x+.5*th,r.y+.5*th,Math.max(0,r.w-th),Math.max(0,r.h-th),radius);
    ctx.strokeStyle=rgba(sp.Color||[0,0,0],sp.Transparency||0);ctx.lineWidth=th;ctx.stroke();
   }
  }
  if(this.adapter.isImage&&this.adapter.isImage(item.node))this.paintImage(item);
  if(this.adapter.isText&&this.adapter.isText(item.node))this.paintText(item);
  if(this.view.labels)this.paintLabel(item);
  ctx.restore();
 }
 paintImage(item){
  const key=this.adapter.imageKey?this.adapter.imageKey(item.node,item.parentNode):item.id;
  if(!key)return;
  let entry=this.imageCache.get(key);
  if(!entry){
   while(this.imageCache.size>=96){
    const oldest=this.imageCache.keys().next().value;
    if(oldest===undefined)break;
    this.imageCache.delete(oldest);
   }
   entry={state:"loading",img:null};this.imageCache.set(key,entry);
   Promise.resolve(this.adapter.resolveImage?this.adapter.resolveImage(item.node,item.parentNode):"").then(url=>{
    if(!url){entry.state="empty";return}
    const img=new Image();
    img.onload=()=>{entry.state="ready";entry.img=img;this.paint()};
    img.onerror=()=>{entry.state="error"};
    img.src=url;
   }).catch(()=>{entry.state="error"});
  }
  if(entry.state!=="ready"||!entry.img)return;
  const ctx=this.ctx,r=item.rect,p=item.node.Properties||{},img=entry.img;
  ctx.save();ctx.globalAlpha*=1-clamp(finite(p.ImageTransparency,0),0,1);
  const type=p.ScaleType||"Stretch",iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  if(type==="Stretch"||!iw||!ih)ctx.drawImage(img,r.x,r.y,r.w,r.h);
  else{
   const contain=type!=="Crop";
   const scale=contain?Math.min(r.w/iw,r.h/ih):Math.max(r.w/iw,r.h/ih);
   const dw=iw*scale,dh=ih*scale,dx=r.x+(r.w-dw)/2,dy=r.y+(r.h-dh)/2;
   ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.drawImage(img,dx,dy,dw,dh);ctx.restore();
  }
  ctx.restore();
 }
 wrapText(ctx,text,maxWidth){
  const paragraphs=String(text||"").split(/\n/),lines=[];
  for(const paragraph of paragraphs){
   const words=paragraph.split(/\s+/);
   if(!words.length){lines.push("");continue}
   let line="";
   for(const word of words){
    const test=line?line+" "+word:word;
    if(line&&ctx.measureText(test).width>maxWidth){lines.push(line);line=word}else line=test;
   }
   lines.push(line);
  }
  return lines;
 }
 paintText(item){
  const ctx=this.ctx,r=item.rect,p=item.node.Properties||{};
  const padding=this.paddingRect(item.node,r),text=this.adapter.previewText?this.adapter.previewText(item.node,item.parentNode):p.Text||"";
  const size=Math.max(1,finite(p.TextSize,14)),font=String(p.Font||"");
  ctx.save();
  ctx.font=(/Bold|Black/i.test(font)?"700 ":"400 ")+size+"px "+(/Code/i.test(font)?"Consolas, monospace":"Segoe UI, Arial, sans-serif");
  ctx.fillStyle=rgba(p.TextColor3||[1,1,1],p.TextTransparency||0);
  ctx.textBaseline="top";
  const align=p.TextXAlignment||"Left";
  ctx.textAlign=align==="Center"?"center":align==="Right"?"right":"left";
  const lines=p.TextWrapped===false?String(text||"").split(/\n/):this.wrapText(ctx,text,Math.max(1,padding.w));
  const lineHeight=size*1.18,total=lines.length*lineHeight;
  const va=p.TextYAlignment||"Center";
  let y=va==="Top"?padding.y:va==="Bottom"?padding.y+padding.h-total:padding.y+(padding.h-total)/2;
  const x=align==="Center"?padding.x+padding.w/2:align==="Right"?padding.x+padding.w:padding.x;
  const strokeTrans=finite(p.TextStrokeTransparency,1);
  for(const line of lines){
   if(strokeTrans<1){
    ctx.lineWidth=2;ctx.strokeStyle=rgba(p.TextStrokeColor3||[0,0,0],strokeTrans);ctx.strokeText(line,x,y);
   }
   ctx.fillText(line,x,y);y+=lineHeight;
  }
  ctx.restore();
 }
 paintLabel(item){
  const ctx=this.ctx,r=item.rect,text=(item.node.Name||"Object")+" · "+(item.node.ClassName||"GuiObject");
  ctx.save();ctx.font="600 9px Segoe UI, Arial";const width=Math.min(190,ctx.measureText(text).width+8);
  const y=Math.max(0,r.y-14);ctx.fillStyle="rgba(29,111,180,.96)";ctx.fillRect(r.x,y,width,13);
  ctx.fillStyle="#fff";ctx.textBaseline="middle";ctx.textAlign="left";ctx.fillText(text,r.x+4,y+6.5);ctx.restore();
 }
 point(event){
  const rect=this.canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*(this.view.viewport.w/Math.max(1,rect.width)),y:(event.clientY-rect.top)*(this.view.viewport.h/Math.max(1,rect.height))};
 }
 hitItem(item,x,y){
  if(item.clip&&!inside(item.clip,x,y))return false;
  const r=item.rect;
  if(!item.rotation)return inside(r,x,y);
  const ox=r.x+item.anchor[0]*r.w,oy=r.y+item.anchor[1]*r.h;
  const angle=-item.rotation*Math.PI/180,dx=x-ox,dy=y-oy;
  const rx=ox+dx*Math.cos(angle)-dy*Math.sin(angle),ry=oy+dx*Math.sin(angle)+dy*Math.cos(angle);
  return inside(r,rx,ry);
 }
 hitTest(x,y){
  for(let i=this.scene.length-1;i>=0;i--){
   const item=this.scene[i];
   if(this.hitItem(item,x,y))return item;
  }
  return null;
 }
 onPointerDown(event){
  if(event.button!==0)return;
  const point=this.point(event),hit=this.hitTest(point.x,point.y);
  this.pointer={x:point.x,y:point.y,hit};
  if(hit&&this.adapter.onNodePointerDown)this.adapter.onNodePointerDown(event,hit.node,hit);
  else if(this.adapter.onBlankPointerDown)this.adapter.onBlankPointerDown(event);
 }
 onPointerMove(event){
  const point=this.point(event),hit=this.hitTest(point.x,point.y);
  this.pointer={x:point.x,y:point.y,hit};
  this.canvas.style.cursor=hit?"default":"grab";
  if(this.adapter.onHover)this.adapter.onHover(hit&&hit.node,point,hit);
 }
 getItem(id){return this.byId.get(id)||null}
 getRect(id){const item=this.getItem(id);return item?{...item.rect}:null}
}

window.BloomEditorEngineV2=BloomEditorEngineV2;
})();