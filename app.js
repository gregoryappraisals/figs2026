const svg = document.getElementById("sketch");
const drawing = document.getElementById("drawing");
const currentAreaEl = document.getElementById("currentArea");
const totalAreaEl = document.getElementById("totalArea");
const areasList = document.getElementById("areasList");

const SCALE = 8; // SVG units per foot
const start = {x: 450, y: 325};

let points = [{...start}];
let segments = [];
let completedAreas = [];

function ftValue(){
  const ft = parseFloat(document.getElementById("feet").value || 0);
  const inch = parseFloat(document.getElementById("inches").value || 0);
  return ft + inch/12;
}

function fmtFeet(v){
  const ft = Math.floor(v + 1e-9);
  let inches = Math.round((v-ft)*12*4)/4;
  if (inches >= 12){ return `${ft+1}'`; }
  return inches ? `${ft}' ${inches}"` : `${ft}'`;
}

function polygonArea(pts){
  if (pts.length < 3) return 0;
  let sum = 0;
  for(let i=0;i<pts.length;i++){
    const a = pts[i], b = pts[(i+1)%pts.length];
    sum += a.x*b.y - b.x*a.y;
  }
  return Math.abs(sum)/2/(SCALE*SCALE);
}

function render(){
  drawing.innerHTML = "";
  if(points.length){
    const pl = document.createElementNS("http://www.w3.org/2000/svg","polyline");
    pl.setAttribute("points", points.map(p=>`${p.x},${p.y}`).join(" "));
    pl.setAttribute("fill","none");
    pl.setAttribute("stroke","#111");
    pl.setAttribute("stroke-width","3");
    drawing.appendChild(pl);
  }
  segments.forEach((s,i)=>{
    const mid = {x:(s.a.x+s.b.x)/2, y:(s.a.y+s.b.y)/2};
    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x",mid.x+6);
    t.setAttribute("y",mid.y-6);
    t.setAttribute("font-size","14");
    t.textContent = fmtFeet(s.lengthFt);
    drawing.appendChild(t);
  });
  completedAreas.forEach(area=>{
    const poly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
    poly.setAttribute("points",area.points.map(p=>`${p.x},${p.y}`).join(" "));
    poly.setAttribute("fill","rgba(0,0,0,.04)");
    poly.setAttribute("stroke","#444");
    poly.setAttribute("stroke-width","2");
    drawing.appendChild(poly);

    const cx = area.points.reduce((a,p)=>a+p.x,0)/area.points.length;
    const cy = area.points.reduce((a,p)=>a+p.y,0)/area.points.length;
    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x",cx);
    t.setAttribute("y",cy);
    t.setAttribute("text-anchor","middle");
    t.setAttribute("font-size","16");
    t.setAttribute("font-weight","700");
    t.textContent = `${area.label}: ${area.area.toFixed(0)} SF`;
    drawing.appendChild(t);
  });

  currentAreaEl.textContent = `${polygonArea(points).toFixed(0)} SF`;
  totalAreaEl.textContent = `${completedAreas.reduce((a,b)=>a+b.area,0).toFixed(0)} SF`;

  if(!completedAreas.length) areasList.textContent = "No completed areas yet.";
  else {
    areasList.innerHTML = completedAreas.map((a,i)=>
      `<div class="area-row"><strong>${i+1}. ${a.label}</strong>: ${a.area.toFixed(0)} SF</div>`
    ).join("");
  }
}

function addSegment(dir){
  const lenFt = ftValue();
  if(!lenFt || lenFt <= 0) return;
  const a = points[points.length-1];
  const d = lenFt*SCALE;
  let b = {...a};
  if(dir==="up") b.y -= d;
  if(dir==="down") b.y += d;
  if(dir==="left") b.x -= d;
  if(dir==="right") b.x += d;
  points.push(b);
  segments.push({a:{...a},b:{...b},lengthFt:lenFt});
  render();
}

document.querySelectorAll("[data-dir]").forEach(btn=>{
  btn.addEventListener("click",()=>addSegment(btn.dataset.dir));
});

document.getElementById("undoBtn").onclick = ()=>{
  if(points.length>1){ points.pop(); segments.pop(); render(); }
};

document.getElementById("closeBtn").onclick = ()=>{
  if(points.length < 3) return alert("Draw at least 3 walls first.");
  const first = points[0], last = points[points.length-1];
  const dx = first.x-last.x, dy = first.y-last.y;
  if(Math.abs(dx)>0.01 || Math.abs(dy)>0.01){
    segments.push({
      a:{...last},
      b:{...first},
      lengthFt:Math.sqrt(dx*dx+dy*dy)/SCALE
    });
    points.push({...first});
  }
  render();
};

document.getElementById("newAreaBtn").onclick = ()=>{
  const area = polygonArea(points);
  if(area <= 0) return alert("Complete a shape first.");
  completedAreas.push({
    label: document.getElementById("areaLabel").value,
    area,
    points: points.slice(0,-1).map(p=>({...p}))
  });
  points = [{...start}];
  segments = [];
  render();
};

document.getElementById("saveBtn").onclick = ()=>{
  const key = "gregorySketch:" + (document.getElementById("jobName").value.trim() || "Untitled");
  localStorage.setItem(key, JSON.stringify({
    jobName: document.getElementById("jobName").value,
    points, segments, completedAreas
  }));
  alert("Saved on this device.");
};

document.getElementById("loadBtn").onclick = ()=>{
  const name = prompt("Enter the exact saved Property / Assignment name:");
  if(!name) return;
  const data = localStorage.getItem("gregorySketch:"+name);
  if(!data) return alert("No saved job found with that name.");
  const obj = JSON.parse(data);
  document.getElementById("jobName").value = obj.jobName || name;
  points = obj.points || [{...start}];
  segments = obj.segments || [];
  completedAreas = obj.completedAreas || [];
  render();
};

document.getElementById("exportBtn").onclick = ()=>{
  const serializer = new XMLSerializer();
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  const svgString = serializer.serializeToString(clone);
  const blob = new Blob([svgString], {type:"image/svg+xml"});
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = ()=>{
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1300;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = (document.getElementById("jobName").value.trim() || "Gregory-Sketch") + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = url;
};

document.getElementById("printBtn").onclick = ()=>window.print();

(function drawGrid(){
  const grid = document.getElementById("grid");
  for(let x=0;x<=900;x+=40){
    const l = document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",x); l.setAttribute("x2",x); l.setAttribute("y1",0); l.setAttribute("y2",650);
    l.setAttribute("stroke","#eee"); l.setAttribute("stroke-width","1"); grid.appendChild(l);
  }
  for(let y=0;y<=650;y+=40){
    const l = document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",0); l.setAttribute("x2",900); l.setAttribute("y1",y); l.setAttribute("y2",y);
    l.setAttribute("stroke","#eee"); l.setAttribute("stroke-width","1"); grid.appendChild(l);
  }
})();
render();
