const SVGNS="http://www.w3.org/2000/svg";
const sketch=document.getElementById("sketch"), completedLayer=document.getElementById("completedLayer"),
currentLayer=document.getElementById("currentLayer"), annotationLayer=document.getElementById("annotationLayer"),
markerLayer=document.getElementById("markerLayer"), areasList=document.getElementById("areasList"),
modal=document.getElementById("modal"), jobsList=document.getElementById("jobsList"), modeMessage=document.getElementById("modeMessage");
const SCALE=10, DEFAULT_START={x:600,y:400}, SNAP=10;
let currentSegments=[], completedAreas=[], cursor={...DEFAULT_START}, selected=null, zoom=1;
let roomLabels=[], symbols=[], notes={updates:"",condition:"",features:"",other:""};
let mode="normal", drag=null;
let history=[];

function snapshotState(){
  return JSON.stringify({currentSegments,completedAreas,cursor,roomLabels,symbols,notes,selected});
}
function pushHistory(){
  history.push(snapshotState());
  if(history.length>40) history.shift();
}
function restoreSnapshot(raw){
  const d=JSON.parse(raw);
  currentSegments=d.currentSegments||[]; completedAreas=d.completedAreas||[]; cursor=d.cursor||{...DEFAULT_START};
  roomLabels=d.roomLabels||[]; symbols=d.symbols||[]; notes=d.notes||notes; selected=d.selected||null;
  fillNotes(); render(); autosave();
}


function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function parseMeasurement(raw){
  raw=String(raw||"").trim().toLowerCase();
  if(!raw)return NaN;
  let m=raw.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if(m)return parseFloat(m[1])+(m[2]?parseFloat(m[2])/12:0);
  m=raw.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
  if(m)return parseFloat(m[1])+parseFloat(m[2])/12;
  return parseFloat(raw);
}
function fmtFeet(v){let ft=Math.floor(v+1e-8),ins=Math.round((v-ft)*12*4)/4;if(ins>=12){ft++;ins=0}return ins?`${ft}' ${ins}"`:`${ft}'`}
function ptKey(p){return `${Math.round(p.x)},${Math.round(p.y)}`}
function lenFt(a,b){return Math.hypot(b.x-a.x,b.y-a.y)/SCALE}
function segment(a,b,parts){return {id:uid(),a:{...a},b:{...b},lengthFt:lenFt(a,b),parts:parts||[lenFt(a,b)]}}
function directionVector(dir){
 const d=Math.SQRT1_2;
 return {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0],upleft:[-d,-d],upright:[d,-d],downleft:[-d,d],downright:[d,d]}[dir];
}
function sameDirection(s,v){
 const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,L=Math.hypot(dx,dy)||1;
 return Math.abs(dx/L-v[0])<.001&&Math.abs(dy/L-v[1])<.001;
}
function addWall(dir){
 const feet=parseMeasurement(document.getElementById("measurement").value);
 if(!(feet>0))return alert("Enter a measurement first.");
 pushHistory();
 const v=directionVector(dir), a={...cursor}, b={x:a.x+v[0]*feet*SCALE,y:a.y+v[1]*feet*SCALE};
 const last=currentSegments.at(-1);
 if(last && sameDirection(last,v) && Math.hypot(last.b.x-a.x,last.b.y-a.y)<1){
   last.b={...b}; last.lengthFt=lenFt(last.a,last.b); last.parts=(last.parts||[]).concat([feet]); cursor={...b};
   selected={kind:"current",index:currentSegments.length-1};
 }else{
   currentSegments.push(segment(a,b,[feet])); cursor={...b}; selected={kind:"current",index:currentSegments.length-1};
 }
 document.getElementById("measurement").select(); render(); autosave();
}
function orderedPolygon(){
 if(currentSegments.length<3)return null;
 const adj=new Map();
 currentSegments.forEach((s,i)=>{for(const p of [s.a,s.b]){let k=ptKey(p);if(!adj.has(k))adj.set(k,[]);adj.get(k).push(i)}});
 if([...adj.values()].some(a=>a.length!==2))return null;
 let used=new Set(), pts=[], si=0, p={...currentSegments[0].a}, startKey=ptKey(p);
 while(used.size<currentSegments.length){
   pts.push({...p});
   const choices=adj.get(ptKey(p)).filter(i=>!used.has(i));
   if(!choices.length)return null;
   si=choices[0];used.add(si);const s=currentSegments[si];
   p=ptKey(s.a)===ptKey(p)?{...s.b}:{...s.a};
 }
 if(ptKey(p)!==startKey)return null;
 return pts;
}
function polyArea(pts){if(!pts||pts.length<3)return 0;let s=0;for(let i=0;i<pts.length;i++){let a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y}return Math.abs(s)/2/SCALE/SCALE}
function closeShape(){
 if(currentSegments.length<2)return alert("Draw at least two walls first.");
 pushHistory();
 const first=currentSegments[0].a,last=cursor;
 if(Math.hypot(first.x-last.x,first.y-last.y)<1)return render();
 currentSegments.push(segment(last,first));cursor={...first};render();autosave();
}
function commitArea(){
 const pts=orderedPolygon();
 if(!pts)return alert("The area is not fully connected yet. Connect the open wall sections before saving the area.");
 const area=polyArea(pts); if(!(area>0))return alert("The shape does not contain measurable area.");
 pushHistory();
 completedAreas.push({id:uid(),label:document.getElementById("areaLabel").value.trim()||"Area",type:document.getElementById("areaType").value,points:pts,segments:JSON.parse(JSON.stringify(currentSegments)),area});
 currentSegments=[];cursor={...DEFAULT_START};selected=null;render();autosave();
}
function renderWall(group,s,ref){
 const line=document.createElementNS(SVGNS,"line");for(const [k,v] of Object.entries({x1:s.a.x,y1:s.a.y,x2:s.b.x,y2:s.b.y}))line.setAttribute(k,v);
 line.setAttribute("class","wall-line"+(selected&&JSON.stringify(selected)===JSON.stringify(ref)?" wall-selected":""));group.appendChild(line);
 const hit=line.cloneNode();hit.setAttribute("class","wall-hit");hit.onclick=e=>{e.stopPropagation();selected=ref;render()};group.appendChild(hit);
 const mx=(s.a.x+s.b.x)/2,my=(s.a.y+s.b.y)/2,dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,L=Math.hypot(dx,dy)||1;
 const t=document.createElementNS(SVGNS,"text");t.setAttribute("x",mx-dy/L*17);t.setAttribute("y",my+dx/L*17);t.setAttribute("class","dim-text");t.setAttribute("text-anchor","middle");t.textContent=fmtFeet(s.lengthFt);group.appendChild(t);
}
function renderArea(a,idx){
 const p=document.createElementNS(SVGNS,"polygon");p.setAttribute("points",a.points.map(q=>q.x+","+q.y).join(" "));p.setAttribute("class","area-outline "+(a.type==="gla"?"area-fill-gla":"area-fill-nongla"));completedLayer.appendChild(p);
 a.segments.forEach((s,j)=>renderWall(completedLayer,s,{kind:"area",areaIndex:idx,index:j}));
 let cx=a.points.reduce((x,p)=>x+p.x,0)/a.points.length,cy=a.points.reduce((x,p)=>x+p.y,0)/a.points.length;
 let t=document.createElementNS(SVGNS,"text");t.setAttribute("x",cx);t.setAttribute("y",cy);t.setAttribute("class","area-label");t.textContent=`${a.label} • ${a.area.toFixed(0)} SF`;completedLayer.appendChild(t);
}
function svgPoint(e){const q=sketch.createSVGPoint();q.x=e.clientX;q.y=e.clientY;return q.matrixTransform(sketch.getScreenCTM().inverse())}
function snapPoint(p){return {x:Math.round(p.x/SNAP)*SNAP,y:Math.round(p.y/SNAP)*SNAP}}
function svgEl(tag,attrs={}){const e=document.createElementNS(SVGNS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e}
function symbolLine(g,x1,y1,x2,y2,cls="symbol-stroke"){g.appendChild(svgEl("line",{x1,y1,x2,y2,class:cls}))}
function symbolRect(g,x,y,w,h,rx=0,cls="symbol-stroke"){g.appendChild(svgEl("rect",{x,y,width:w,height:h,rx,class:cls}))}
function symbolPath(g,d,cls="symbol-stroke"){g.appendChild(svgEl("path",{d,class:cls}))}
function symbolEllipse(g,cx,cy,rx,ry,cls="symbol-stroke"){g.appendChild(svgEl("ellipse",{cx,cy,rx,ry,class:cls}))}
function addArrow(g,x1,y1,x2,y2){symbolLine(g,x1,y1,x2,y2);const a=Math.atan2(y2-y1,x2-x1),l=8;symbolLine(g,x2,y2,x2-Math.cos(a-.55)*l,y2-Math.sin(a-.55)*l);symbolLine(g,x2,y2,x2-Math.cos(a+.55)*l,y2-Math.sin(a+.55)*l)}
function buildArchitecturalSymbol(type){
 const g=svgEl("g",{class:"architect-symbol"});
 if(type==="car"||type==="suv"||type==="pickup"){
   const w=type==="car"?34:40,h=type==="car"?70:76;
   symbolPath(g,`M ${-w/2+5} ${-h/2} Q ${-w/2} ${-h/2+8} ${-w/2} ${-h/2+18} L ${-w/2} ${h/2-18} Q ${-w/2} ${h/2-8} ${-w/2+5} ${h/2} L ${w/2-5} ${h/2} Q ${w/2} ${h/2-8} ${w/2} ${h/2-18} L ${w/2} ${-h/2+18} Q ${w/2} ${-h/2+8} ${w/2-5} ${-h/2} Z`);
   symbolLine(g,-w/2+5,-h/2+20,w/2-5,-h/2+20);symbolLine(g,-w/2+5,h/2-20,w/2-5,h/2-20);
   if(type==="car"){symbolPath(g,`M ${-w/2+6} -12 Q 0 -21 ${w/2-6} -12 L ${w/2-6} 12 Q 0 21 ${-w/2+6} 12 Z`)}
   if(type==="suv"){symbolRect(g,-w/2+6,-13,w-12,26,7)}
   if(type==="pickup"){symbolRect(g,-w/2+6,-h/2+24,w-12,24,5);symbolRect(g,-w/2+5,8,w-10,h/2-15,2);symbolLine(g,-w/2+5,8,w/2-5,8)}
   [-1,1].forEach(side=>{symbolRect(g,side*(w/2+1)-3,-h/2+13,6,15,2,"symbol-wheel");symbolRect(g,side*(w/2+1)-3,h/2-28,6,15,2,"symbol-wheel")});
 } else if(type==="door"){
   symbolLine(g,0,-30,0,30);symbolLine(g,0,30,38,30);symbolPath(g,"M 0 -8 A 38 38 0 0 1 38 30","symbol-arc");
 } else if(type==="double-door"){
   symbolLine(g,-42,0,42,0);symbolLine(g,-42,0,-42,34);symbolLine(g,42,0,42,34);symbolLine(g,-42,0,0,34);symbolLine(g,42,0,0,34);symbolPath(g,"M -42 0 A 42 42 0 0 0 0 42","symbol-arc");symbolPath(g,"M 42 0 A 42 42 0 0 1 0 42","symbol-arc");
 } else if(type==="window"){
   symbolLine(g,-42,-6,42,-6);symbolLine(g,-42,6,42,6);symbolLine(g,-34,-12,-34,12);symbolLine(g,34,-12,34,12);
 } else if(type==="garage"){
   symbolRect(g,-45,-30,90,60,2);for(let y=-18;y<=18;y+=12)symbolLine(g,-43,y,43,y);symbolLine(g,-30,-28,-30,28);symbolLine(g,30,-28,30,28);
 } else if(type==="stairs-up"||type==="stairs-down"){
   symbolRect(g,-34,-40,68,80,0);for(let y=-30;y<=30;y+=10)symbolLine(g,-34,y,34,y);if(type==="stairs-up")addArrow(g,0,30,0,-30);else addArrow(g,0,-30,0,30);
 } else if(type==="fireplace"){
   symbolRect(g,-38,-26,76,52,0);symbolLine(g,-28,-16,28,-16);symbolPath(g,"M -18 18 Q -26 2 -11 -5 Q -6 7 0 -8 Q 8 0 13 -10 Q 28 5 18 18 Z");
 } else if(type==="sink"){
   symbolRect(g,-34,-25,68,50,7);symbolEllipse(g,0,2,20,15);symbolEllipse(g,0,-15,2.5,2.5);symbolLine(g,0,-13,0,-6);
 } else if(type==="toilet"){
   symbolRect(g,-20,-34,40,20,6);symbolEllipse(g,0,8,22,30);symbolEllipse(g,0,8,13,20);symbolEllipse(g,0,-24,2.5,2.5);
 } else if(type==="tub"){
   symbolRect(g,-45,-24,90,48,10);symbolRect(g,-36,-16,72,32,8);symbolEllipse(g,31,-12,3,3);symbolLine(g,26,-12,18,-12);
 } else {
   symbolEllipse(g,0,0,18,18);
 }
 return g;
}
function renderAnnotations(){
 annotationLayer.innerHTML="";
 roomLabels.forEach((r,i)=>{let t=document.createElementNS(SVGNS,"text");t.setAttribute("x",r.x);t.setAttribute("y",r.y);t.setAttribute("class","room-label");t.textContent=r.text;t.dataset.ann="room";t.dataset.index=i;annotationLayer.appendChild(t)});
 symbols.forEach((s,i)=>{const g=buildArchitecturalSymbol(s.type);g.setAttribute("transform",`translate(${s.x} ${s.y}) rotate(${s.rotation||0}) scale(${s.scale||1})`);g.dataset.ann="symbol";g.dataset.index=i;if(selected?.kind==="symbol"&&selected.index===i)g.classList.add("symbol-selected");g.querySelectorAll("*").forEach(n=>{n.dataset.ann="symbol";n.dataset.index=i;n.style.pointerEvents="all"});annotationLayer.appendChild(g)});
}
function renderMarker(){
 markerLayer.innerHTML="";let c=document.createElementNS(SVGNS,"circle");c.setAttribute("cx",cursor.x);c.setAttribute("cy",cursor.y);c.setAttribute("r",10);c.setAttribute("class","active-marker");markerLayer.appendChild(c);
 for(const [x1,y1,x2,y2] of [[cursor.x-15,cursor.y,cursor.x+15,cursor.y],[cursor.x,cursor.y-15,cursor.x,cursor.y+15]]){let l=document.createElementNS(SVGNS,"line");Object.entries({x1,y1,x2,y2}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("class","active-cross");markerLayer.appendChild(l)}
}
function render(){
 completedLayer.innerHTML="";currentLayer.innerHTML="";completedAreas.forEach(renderArea);currentSegments.forEach((s,i)=>renderWall(currentLayer,s,{kind:"current",index:i}));renderAnnotations();renderMarker();
 const pts=orderedPolygon(),cur=polyArea(pts);document.getElementById("currentArea").textContent=(pts?cur.toFixed(0):"Open")+" SF";
 document.getElementById("glaTotal").textContent=completedAreas.filter(a=>a.type==="gla").reduce((n,a)=>n+a.area,0).toFixed(0)+" SF";
 document.getElementById("nonglaTotal").textContent=completedAreas.filter(a=>a.type==="nongla").reduce((n,a)=>n+a.area,0).toFixed(0)+" SF";
 areasList.innerHTML=completedAreas.length?completedAreas.map((a,i)=>`<div class="area-row"><div><strong>${esc(a.label)}</strong><div class="job-meta">${a.type==="gla"?"GLA":"Non-GLA"} • ${a.area.toFixed(0)} SF</div></div><button data-area="${i}">Select</button></div>`).join(""):"No completed areas yet.";
 document.querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>{selected={kind:"area",areaIndex:+b.dataset.area,index:0};render()});
}
function setMode(m,msg){mode=m;modeMessage.textContent=msg}
function newStart(){setMode("newstart","NEW START POINT: tap anywhere on the grid. Existing measurements will stay in place.")}
function placeRoom(){let preset=document.getElementById("roomPreset").value,text=preset==="Custom"?document.getElementById("customRoom").value.trim():preset;if(!text)return alert("Enter a room name.");window.pendingRoom=text;setMode("room","PLACE ROOM LABEL: tap where the room sits on the sketch.")}
function placeSymbol(type){window.pendingSymbol=type;setMode("symbol","PLACE SYMBOL: tap where you want it on the sketch.")}
function undo(){
 if(history.length){restoreSnapshot(history.pop());setMode("normal","Last change undone.");return;}
 if(currentSegments.length){let s=currentSegments.pop();cursor={...s.a};selected=null;render();autosave();}
 else setMode("normal","Nothing to undo.");
}
function editWall(){
 if(!selected)return alert("Tap a wall first.");
 let raw=prompt("Enter new wall length in feet (decimals or feet/inches):");if(raw===null)return;let feet=parseMeasurement(raw);if(!(feet>0))return alert("Enter a valid measurement.");
 let s=selected.kind==="current"?currentSegments[selected.index]:completedAreas[selected.areaIndex].segments[selected.index],dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,L=Math.hypot(dx,dy)||1;
 s.b={x:s.a.x+dx/L*feet*SCALE,y:s.a.y+dy/L*feet*SCALE};s.lengthFt=feet;s.parts=[feet];
 if(selected.kind==="current"){if(selected.index===currentSegments.length-1)cursor={...s.b}}else{let a=completedAreas[selected.areaIndex];a.points=orderedAreaPoints(a.segments)||a.points;a.area=polyArea(a.points)}
 render();autosave();
}
function orderedAreaPoints(segs){let old=currentSegments;currentSegments=segs;let p=orderedPolygon();currentSegments=old;return p}
function deleteSelected(){
 if(!selected)return alert("Select a wall or completed area first.");
 if(selected.kind==="area"){let i=selected.areaIndex;if(confirm(`Delete ${completedAreas[i].label}?`)){pushHistory();completedAreas.splice(i,1);selected=null;render();autosave()}}else undo();
}
function moveArea(){
 if(!selected||selected.kind!=="area")return alert("Select a completed area first.");
 setMode("movearea","MOVE AREA: drag the selected completed area to a new position."); 
}
function translateArea(a,dx,dy){a.points=a.points.map(p=>({x:p.x+dx,y:p.y+dy}));a.segments.forEach(s=>{s.a.x+=dx;s.a.y+=dy;s.b.x+=dx;s.b.y+=dy})}
function collectNotes(){notes={updates:notesUpdates.value,condition:notesCondition.value,features:notesFeatures.value,other:notesOther.value}}
function fillNotes(){notesUpdates.value=notes.updates||"";notesCondition.value=notes.condition||"";notesFeatures.value=notes.features||"";notesOther.value=notes.other||""}
function saveJob(show=true){
 collectNotes();let name=jobName.value.trim();if(!name)return show&&alert("Enter a Property / Assignment name first.");
 let data={version:3,name,updated:new Date().toISOString(),currentSegments,completedAreas,cursor,roomLabels,symbols,notes,areaLabel:areaLabel.value,areaType:areaType.value};
 localStorage.setItem("gregorySketchJob:"+name,JSON.stringify(data));localStorage.setItem("gregorySketchLast",name);if(show)alert("Saved on this device.");
}
function autosave(){if(jobName.value.trim())saveJob(false)}
function loadJob(name){
 let d=JSON.parse(localStorage.getItem("gregorySketchJob:"+name));jobName.value=d.name||name;currentSegments=d.currentSegments||[];completedAreas=d.completedAreas||[];cursor=d.cursor||DEFAULT_START;roomLabels=d.roomLabels||[];symbols=d.symbols||[];notes=d.notes||notes;areaLabel.value=d.areaLabel||"1st Floor";areaType.value=d.areaType||"gla";fillNotes();selected=null;history=[];render();modal.classList.add("hidden");
}
function listJobs(){let arr=[];for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(k.startsWith("gregorySketchJob:"))try{arr.push(JSON.parse(localStorage.getItem(k)))}catch{}}arr.sort((a,b)=>new Date(b.updated)-new Date(a.updated));jobsList.innerHTML=arr.length?arr.map(j=>`<div class="job-row"><div><strong>${esc(j.name)}</strong><div class="job-meta">${new Date(j.updated).toLocaleString()}</div></div><button data-load="${encodeURIComponent(j.name)}">Open</button><button data-del="${encodeURIComponent(j.name)}">Delete</button></div>`).join(""):"<p>No saved sketches yet.</p>";document.querySelectorAll("[data-load]").forEach(b=>b.onclick=()=>loadJob(decodeURIComponent(b.dataset.load)));document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{let n=decodeURIComponent(b.dataset.del);if(confirm(`Delete saved sketch "${n}"?`)){localStorage.removeItem("gregorySketchJob:"+n);listJobs()}});modal.classList.remove("hidden")}
function newJob(){if((currentSegments.length||completedAreas.length)&&!confirm("Start a new job? Unsaved work may be lost."))return;jobName.value="";currentSegments=[];completedAreas=[];cursor={...DEFAULT_START};roomLabels=[];symbols=[];notes={updates:"",condition:"",features:"",other:""};fillNotes();selected=null;history=[];render()}
function exportBackup(){let jobs={};for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(k.startsWith("gregorySketchJob:"))jobs[k]=localStorage.getItem(k)}let blob=new Blob([JSON.stringify({version:3,exported:new Date().toISOString(),jobs},null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="Gregory-Sketch-Backup.json";a.click()}
async function restoreBackup(f){try{let d=JSON.parse(await f.text());Object.entries(d.jobs||{}).forEach(([k,v])=>localStorage.setItem(k,v));alert("Backup restored.")}catch{alert("That file could not be restored.")}}
function exportPNG(){let clone=sketch.cloneNode(true);clone.querySelectorAll("#grid,.wall-hit,#markerLayer").forEach(e=>e.remove());let str=new XMLSerializer().serializeToString(clone),blob=new Blob([str],{type:"image/svg+xml"}),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{let c=document.createElement("canvas");c.width=1800;c.height=1200;let x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);let a=document.createElement("a");a.download=(jobName.value.trim()||"Gregory-Sketch")+".png";a.href=c.toDataURL("image/png");a.click();URL.revokeObjectURL(url)};img.src=url}
function setZoom(z){zoom=Math.max(.5,Math.min(2,z));sketch.style.transform=`scale(${zoom})`;zoomLabel.textContent=Math.round(zoom*100)+"%"}

sketch.addEventListener("click",e=>{
 if(e.target.classList.contains("wall-hit")||e.target.dataset.ann)return;
 let p=snapPoint(svgPoint(e));
 if(mode==="newstart"||(!currentSegments.length&&mode==="normal")){pushHistory();cursor=p;setMode("normal","Starting point set. The bright marker shows where the next wall begins.");render();autosave();return}
 if(mode==="room"){pushHistory();roomLabels.push({id:uid(),text:window.pendingRoom,x:p.x,y:p.y});setMode("normal","Room label placed.");render();autosave();return}
 if(mode==="symbol"){pushHistory();symbols.push({id:uid(),type:window.pendingSymbol,x:p.x,y:p.y,rotation:0,scale:1});setMode("normal","Symbol placed.");render();autosave();return}
});
sketch.addEventListener("pointerdown",e=>{
 if(mode==="movearea"&&selected?.kind==="area"){pushHistory();let p=svgPoint(e);drag={kind:"area",index:selected.areaIndex,start:p,snapshot:JSON.parse(JSON.stringify(completedAreas[selected.areaIndex]))};e.preventDefault();return}
 if(e.target.dataset.ann){let p=svgPoint(e),kind=e.target.dataset.ann,index=+e.target.dataset.index;if(kind==="symbol")selected={kind:"symbol",index};pushHistory();drag={kind,index,start:p};render();e.preventDefault()}
});
sketch.addEventListener("pointermove",e=>{
 if(!drag)return;let p=svgPoint(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
 if(drag.kind==="area"){completedAreas[drag.index]=JSON.parse(JSON.stringify(drag.snapshot));translateArea(completedAreas[drag.index],dx,dy)}
 if(drag.kind==="room"){roomLabels[drag.index].x+=dx;roomLabels[drag.index].y+=dy;drag.start=p}
 if(drag.kind==="symbol"){symbols[drag.index].x+=dx;symbols[drag.index].y+=dy;drag.start=p}
 render();e.preventDefault()
});
sketch.addEventListener("pointerup",e=>{if(drag){drag=null;if(mode==="movearea")setMode("normal","Area moved.");autosave();e.preventDefault()}});

document.querySelectorAll("[data-dir]").forEach(b=>b.onclick=()=>addWall(b.dataset.dir));
document.querySelectorAll("[data-symbol]").forEach(b=>b.onclick=()=>placeSymbol(b.dataset.symbol));
undoBtn.onclick=undo;newStartBtn.onclick=newStart;closeBtn.onclick=closeShape;commitAreaBtn.onclick=commitArea;editLastBtn.onclick=editWall;moveAreaBtn.onclick=moveArea;deleteAreaBtn.onclick=deleteSelected;
clearCurrentBtn.onclick=()=>{if(!currentSegments.length||confirm("Clear the current unfinished measurements?")){pushHistory();currentSegments=[];cursor={...DEFAULT_START};selected=null;render();autosave()}};
placeRoomBtn.onclick=placeRoom;saveBtn.onclick=()=>saveJob(true);saveNotesBtn.onclick=()=>{saveJob(false);alert("Notes saved.")};manageBtn.onclick=listJobs;closeModal.onclick=()=>modal.classList.add("hidden");backupBtn.onclick=exportBackup;restoreInput.onchange=e=>e.target.files[0]&&restoreBackup(e.target.files[0]);exportBtn.onclick=exportPNG;printBtn.onclick=()=>window.print();newJobTop.onclick=newJob;
zoomIn.onclick=()=>setZoom(zoom+.1);zoomOut.onclick=()=>setZoom(zoom-.1);resetView.onclick=()=>setZoom(1);
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab,.tab-page").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.getElementById(b.dataset.tab).classList.add("active")});
[notesUpdates,notesCondition,notesFeatures,notesOther].forEach(x=>x.addEventListener("change",autosave));
jobName.addEventListener("change",autosave);

(function(){let g=document.getElementById("grid");for(let x=0;x<=1200;x+=50){let l=document.createElementNS(SVGNS,"line");Object.entries({x1:x,x2:x,y1:0,y2:800,stroke:"#ededed","stroke-width":1}).forEach(([k,v])=>l.setAttribute(k,v));g.appendChild(l)}for(let y=0;y<=800;y+=50){let l=document.createElementNS(SVGNS,"line");Object.entries({x1:0,x2:1200,y1:y,y2:y,stroke:"#ededed","stroke-width":1}).forEach(([k,v])=>l.setAttribute(k,v));g.appendChild(l)}})();
let last=localStorage.getItem("gregorySketchLast");if(last&&localStorage.getItem("gregorySketchJob:"+last))loadJob(last);else{fillNotes();render()}setZoom(1);

// V3.2 tablet keypad and quick placement tools
let fieldKeyValue="";
function fieldKeyUpdate(){measurement.value=fieldKeyValue;fieldMeasureDisplay.textContent=fieldKeyValue||"0";}
document.querySelectorAll("[data-key]").forEach(b=>b.onclick=()=>{let k=b.dataset.key;if(k==="del")fieldKeyValue=fieldKeyValue.slice(0,-1);else if(k==="."&&fieldKeyValue.includes("."))return;else fieldKeyValue+=k;fieldKeyUpdate();});
document.querySelectorAll("[data-dir]").forEach(b=>b.addEventListener("click",()=>{fieldKeyValue="";fieldKeyUpdate();}));
quickLabelBtn.onclick=()=>{let t=prompt("Room label (Living, Kitchen, Bedroom, Bath, Dining, Laundry, Office, Garage, etc.):");if(t&&t.trim()){window.pendingRoom=t.trim();setMode("room","PLACE ROOM LABEL: tap where the room sits on the sketch.");}};
const symbolModal=document.getElementById("symbolModal");
function openSymbolPicker(){symbolModal.classList.remove("hidden")}
function closeSymbolPicker(){symbolModal.classList.add("hidden")}
quickSymbolBtn.onclick=openSymbolPicker;
document.getElementById("closeSymbolModal").onclick=closeSymbolPicker;
document.querySelectorAll("[data-symbol-pick]").forEach(b=>b.onclick=()=>{placeSymbol(b.dataset.symbolPick);closeSymbolPicker()});
function rotateSelectedSymbol(step=90){if(!selected||selected.kind!=="symbol"||!symbols[selected.index])return alert("Tap a placed symbol first.");pushHistory();symbols[selected.index].rotation=((symbols[selected.index].rotation||0)+step)%360;render();autosave()}
function deleteSelectedSymbol(){if(!selected||selected.kind!=="symbol"||!symbols[selected.index])return alert("Tap a placed symbol first.");if(confirm("Delete the selected symbol?")){pushHistory();symbols.splice(selected.index,1);selected=null;render();autosave()}}
["rotateSymbolBtn","modalRotateSymbolBtn"].forEach(id=>{const b=document.getElementById(id);if(b)b.onclick=()=>rotateSelectedSymbol(90)});
["rotate45SymbolBtn","modalRotate45SymbolBtn"].forEach(id=>{const b=document.getElementById(id);if(b)b.onclick=()=>rotateSelectedSymbol(45)});
["deleteSymbolBtn","modalDeleteSymbolBtn"].forEach(id=>{const b=document.getElementById(id);if(b)b.onclick=deleteSelectedSymbol});
function renderSymbolPreviews(){document.querySelectorAll("[data-preview]").forEach(host=>{host.innerHTML="";const svg=svgEl("svg",{viewBox:"-55 -55 110 110","aria-hidden":"true"});svg.appendChild(buildArchitecturalSymbol(host.dataset.preview));host.appendChild(svg)})}
renderSymbolPreviews();


// V3.2 corrected: DETAILS tab syncs with the app's existing job controls.
const detailsJobName = document.getElementById("detailsJobName");
const detailsAreaType = document.getElementById("detailsAreaType");
const detailsAreaLabel = document.getElementById("detailsAreaLabel");
const detailsCurrentArea = document.getElementById("detailsCurrentArea");
const detailsGlaTotal = document.getElementById("detailsGlaTotal");
const detailsNonglaTotal = document.getElementById("detailsNonglaTotal");
const detailsAreasList = document.getElementById("detailsAreasList");

function syncDetailsFromCore(){
  if(!detailsJobName) return;
  detailsJobName.value = jobName.value || "";
  detailsAreaType.value = areaType.value || "gla";
  detailsAreaLabel.value = areaLabel.value || "1st Floor";
  detailsCurrentArea.textContent = currentArea.textContent;
  detailsGlaTotal.textContent = glaTotal.textContent;
  detailsNonglaTotal.textContent = nonglaTotal.textContent;
  detailsAreasList.innerHTML = areasList.innerHTML;
  detailsAreasList.querySelectorAll("[data-area]").forEach(b=>{
    b.onclick=()=>{
      selected={kind:"area",areaIndex:+b.dataset.area,index:0};
      render();
    };
  });
}
function syncCoreFromDetails(){
  jobName.value = detailsJobName.value;
  areaType.value = detailsAreaType.value;
  areaLabel.value = detailsAreaLabel.value;
}
detailsJobName.addEventListener("input",()=>{jobName.value=detailsJobName.value;});
detailsAreaType.addEventListener("change",()=>{areaType.value=detailsAreaType.value;autosave();});
detailsAreaLabel.addEventListener("input",()=>{areaLabel.value=detailsAreaLabel.value;autosave();});

document.getElementById("detailsSaveBtn").onclick=()=>{syncCoreFromDetails();saveJob(true);syncDetailsFromCore();};
document.getElementById("detailsManageBtn").onclick=()=>{syncCoreFromDetails();listJobs();};
document.getElementById("detailsBackupBtn").onclick=exportBackup;
document.getElementById("detailsRestoreInput").onchange=e=>e.target.files[0]&&restoreBackup(e.target.files[0]);
document.getElementById("detailsExportBtn").onclick=exportPNG;
document.getElementById("detailsPrintBtn").onclick=()=>window.print();

const _renderForDetails = render;
render = function(){ _renderForDetails(); syncDetailsFromCore(); };

const _loadJobForDetails = loadJob;
loadJob = function(name){ _loadJobForDetails(name); syncDetailsFromCore(); };

syncDetailsFromCore();

// V3.3 field toolbar, pan and fit
(function(){
 const viewport=document.getElementById("viewport"), svg=document.getElementById("sketch");
 if(!viewport||!svg) return;
 const undo=document.getElementById("undoBtn");
 const newStart=document.getElementById("newStartBtn");
 const close=document.getElementById("closeBtn")||document.getElementById("closeAreaBtn");
 toolbarUndo.onclick=()=>undo&&undo.click();
 toolbarNewStart.onclick=()=>newStart&&newStart.click();
 toolbarClose.onclick=()=>{if(close)close.click(); else if(typeof closeShape==="function")closeShape();};
 toolbarLabel.onclick=()=>quickLabelBtn&&quickLabelBtn.click();
 toolbarSymbol.onclick=()=>quickSymbolBtn&&quickSymbolBtn.click();

 let pan=false, drag=false, sx=0, sy=0, sl=0, st=0;
 toolbarPan.onclick=()=>{pan=!pan;viewport.classList.toggle("pan-mode",pan);toolbarPan.textContent=pan?"✓ Pan On":"✋ Pan";};
 viewport.addEventListener("pointerdown",e=>{
   if(!pan)return;
   drag=true;viewport.classList.add("dragging");sx=e.clientX;sy=e.clientY;sl=viewport.scrollLeft;st=viewport.scrollTop;
   try{viewport.setPointerCapture(e.pointerId)}catch(_){}
   e.preventDefault();
 },true);
 viewport.addEventListener("pointermove",e=>{
   if(!pan||!drag)return;
   viewport.scrollLeft=sl-(e.clientX-sx);viewport.scrollTop=st-(e.clientY-sy);e.preventDefault();
 },true);
 function stop(){drag=false;viewport.classList.remove("dragging")}
 viewport.addEventListener("pointerup",stop,true);viewport.addEventListener("pointercancel",stop,true);

 toolbarFit.onclick=()=>{
   const groups=["completedLayer","currentLayer","annotationLayer","markerLayer"].map(id=>document.getElementById(id)).filter(Boolean);
   let box=null;
   groups.forEach(g=>{try{const b=g.getBBox();if(!b.width&&!b.height)return;
     if(!box)box={x:b.x,y:b.y,x2:b.x+b.width,y2:b.y+b.height};
     else{box.x=Math.min(box.x,b.x);box.y=Math.min(box.y,b.y);box.x2=Math.max(box.x2,b.x+b.width);box.y2=Math.max(box.y2,b.y+b.height);}
   }catch(_){}}); 
   if(!box){svg.setAttribute("viewBox","0 0 1200 800");return;}
   const p=80; svg.setAttribute("viewBox",`${box.x-p} ${box.y-p} ${box.x2-box.x+p*2} ${box.y2-box.y+p*2}`);
   viewport.scrollLeft=0;viewport.scrollTop=0;
 };
})();
