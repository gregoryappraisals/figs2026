const SVGNS="http://www.w3.org/2000/svg";
const sketch=document.getElementById("sketch"), completedLayer=document.getElementById("completedLayer"),
currentLayer=document.getElementById("currentLayer"), annotationLayer=document.getElementById("annotationLayer"),
markerLayer=document.getElementById("markerLayer"), areasList=document.getElementById("areasList"),
modal=document.getElementById("modal"), jobsList=document.getElementById("jobsList"), modeMessage=document.getElementById("modeMessage");
const SCALE=10, DEFAULT_START={x:600,y:400}, SNAP=10;
let currentSegments=[], completedAreas=[], cursor={...DEFAULT_START}, selected=null, zoom=1;
let roomLabels=[], symbols=[], notes={updates:"",condition:"",features:"",other:""};
let mode="normal", drag=null;

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
 const first=currentSegments[0].a,last=cursor;
 if(Math.hypot(first.x-last.x,first.y-last.y)<1)return render();
 currentSegments.push(segment(last,first));cursor={...first};render();autosave();
}
function commitArea(){
 const pts=orderedPolygon();
 if(!pts)return alert("The area is not fully connected yet. Connect the open wall sections before saving the area.");
 const area=polyArea(pts); if(!(area>0))return alert("The shape does not contain measurable area.");
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
function renderAnnotations(){
 annotationLayer.innerHTML="";
 roomLabels.forEach((r,i)=>{let t=document.createElementNS(SVGNS,"text");t.setAttribute("x",r.x);t.setAttribute("y",r.y);t.setAttribute("class","room-label");t.textContent=r.text;t.dataset.ann="room";t.dataset.index=i;annotationLayer.appendChild(t)});
 const glyph={car:"🚗",truck:"🚙",garage:"▥",stairs:"⇅",fireplace:"▣"};
 symbols.forEach((s,i)=>{let t=document.createElementNS(SVGNS,"text");t.setAttribute("x",s.x);t.setAttribute("y",s.y);t.setAttribute("class","symbol-label");t.textContent=glyph[s.type]||"●";t.dataset.ann="symbol";t.dataset.index=i;annotationLayer.appendChild(t)});
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
function undo(){if(currentSegments.length){let s=currentSegments.pop();cursor={...s.a};selected=null;render();autosave()}}
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
 if(selected.kind==="area"){let i=selected.areaIndex;if(confirm(`Delete ${completedAreas[i].label}?`)){completedAreas.splice(i,1);selected=null;render();autosave()}}else undo();
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
 let d=JSON.parse(localStorage.getItem("gregorySketchJob:"+name));jobName.value=d.name||name;currentSegments=d.currentSegments||[];completedAreas=d.completedAreas||[];cursor=d.cursor||DEFAULT_START;roomLabels=d.roomLabels||[];symbols=d.symbols||[];notes=d.notes||notes;areaLabel.value=d.areaLabel||"1st Floor";areaType.value=d.areaType||"gla";fillNotes();selected=null;render();modal.classList.add("hidden");
}
function listJobs(){let arr=[];for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(k.startsWith("gregorySketchJob:"))try{arr.push(JSON.parse(localStorage.getItem(k)))}catch{}}arr.sort((a,b)=>new Date(b.updated)-new Date(a.updated));jobsList.innerHTML=arr.length?arr.map(j=>`<div class="job-row"><div><strong>${esc(j.name)}</strong><div class="job-meta">${new Date(j.updated).toLocaleString()}</div></div><button data-load="${encodeURIComponent(j.name)}">Open</button><button data-del="${encodeURIComponent(j.name)}">Delete</button></div>`).join(""):"<p>No saved sketches yet.</p>";document.querySelectorAll("[data-load]").forEach(b=>b.onclick=()=>loadJob(decodeURIComponent(b.dataset.load)));document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{let n=decodeURIComponent(b.dataset.del);if(confirm(`Delete saved sketch "${n}"?`)){localStorage.removeItem("gregorySketchJob:"+n);listJobs()}});modal.classList.remove("hidden")}
function newJob(){if((currentSegments.length||completedAreas.length)&&!confirm("Start a new job? Unsaved work may be lost."))return;jobName.value="";currentSegments=[];completedAreas=[];cursor={...DEFAULT_START};roomLabels=[];symbols=[];notes={updates:"",condition:"",features:"",other:""};fillNotes();selected=null;render()}
function exportBackup(){let jobs={};for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(k.startsWith("gregorySketchJob:"))jobs[k]=localStorage.getItem(k)}let blob=new Blob([JSON.stringify({version:3,exported:new Date().toISOString(),jobs},null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="Gregory-Sketch-Backup.json";a.click()}
async function restoreBackup(f){try{let d=JSON.parse(await f.text());Object.entries(d.jobs||{}).forEach(([k,v])=>localStorage.setItem(k,v));alert("Backup restored.")}catch{alert("That file could not be restored.")}}
function exportPNG(){let clone=sketch.cloneNode(true);clone.querySelectorAll("#grid,.wall-hit,#markerLayer").forEach(e=>e.remove());let str=new XMLSerializer().serializeToString(clone),blob=new Blob([str],{type:"image/svg+xml"}),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{let c=document.createElement("canvas");c.width=1800;c.height=1200;let x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);let a=document.createElement("a");a.download=(jobName.value.trim()||"Gregory-Sketch")+".png";a.href=c.toDataURL("image/png");a.click();URL.revokeObjectURL(url)};img.src=url}
function setZoom(z){zoom=Math.max(.5,Math.min(2,z));sketch.style.transform=`scale(${zoom})`;zoomLabel.textContent=Math.round(zoom*100)+"%"}

sketch.addEventListener("click",e=>{
 if(e.target.classList.contains("wall-hit")||e.target.dataset.ann)return;
 let p=snapPoint(svgPoint(e));
 if(mode==="newstart"||(!currentSegments.length&&mode==="normal")){cursor=p;setMode("normal","Starting point set. The bright marker shows where the next wall begins.");render();autosave();return}
 if(mode==="room"){roomLabels.push({id:uid(),text:window.pendingRoom,x:p.x,y:p.y});setMode("normal","Room label placed.");render();autosave();return}
 if(mode==="symbol"){symbols.push({id:uid(),type:window.pendingSymbol,x:p.x,y:p.y});setMode("normal","Symbol placed.");render();autosave();return}
});
sketch.addEventListener("pointerdown",e=>{
 if(mode==="movearea"&&selected?.kind==="area"){let p=svgPoint(e);drag={kind:"area",index:selected.areaIndex,start:p,snapshot:JSON.parse(JSON.stringify(completedAreas[selected.areaIndex]))};e.preventDefault();return}
 if(e.target.dataset.ann){let p=svgPoint(e);drag={kind:e.target.dataset.ann,index:+e.target.dataset.index,start:p};e.preventDefault()}
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
clearCurrentBtn.onclick=()=>{if(!currentSegments.length||confirm("Clear the current unfinished measurements?")){currentSegments=[];cursor={...DEFAULT_START};selected=null;render();autosave()}};
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
quickSymbolBtn.onclick=()=>{let t=prompt("Symbol: car, truck, garage, stairs, or fireplace","car");if(t){t=t.trim().toLowerCase();if(["car","truck","garage","stairs","fireplace"].includes(t)){window.pendingSymbol=t;setMode("symbol","PLACE SYMBOL: tap where you want it on the sketch.");}else alert("Choose car, truck, garage, stairs, or fireplace.");}};
