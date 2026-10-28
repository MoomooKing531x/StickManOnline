// Stick Duel server: static files + WebSocket matchmaking, parties, and (optionally) the authoritative game sim.
// Game-server mode runs the SAME game code headlessly (vm + real three.js math, stubbed DOM/WebGL), one instance per match.
const http=require("http"),fs=require("fs"),path=require("path"),vm=require("vm"),THREE=require("three"),{WebSocketServer}=require("ws");
const PORT=process.env.PORT||3000,HTML=fs.readFileSync([path.join(__dirname,"public","index.html"),path.join(__dirname,"index.html")].find(p=>fs.existsSync(p))||path.join(__dirname,"public","index.html"),"utf8");
const SRC=(()=>{const i=HTML.lastIndexOf("<script>");return HTML.slice(i+8,HTML.indexOf("</script>",i))})();
const E=["punch","kick","dash","act"],H=["l","r","up","crouch","block"];
function stub(){const f=function(){};return new Proxy(f,{get:(t,k)=>k===Symbol.toPrimitive?()=>0:k in t?t[k]:stub(),apply:()=>stub(),construct:()=>stub(),set:()=>true})}
const T2={...THREE,WebGLRenderer:function(){return stub()}};
function sandbox(){return{THREE:T2,atob:s=>Buffer.from(s,"base64").toString("binary"),performance,console,setTimeout,clearTimeout,
 document:{createElement:()=>stub(),querySelector:()=>stub(),querySelectorAll:()=>[],body:stub(),documentElement:stub()},
 navigator:{getGamepads:()=>[]},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>"#888888"}),
 innerWidth:1280,innerHeight:720,devicePixelRatio:1,addEventListener(){},requestAnimationFrame(){},Image:function(){return stub()}}}
const tx=(ws,t,d)=>ws.readyState==1&&ws.send(JSON.stringify({t,d}));
const bc=(r,t,d,not)=>r.members.forEach(m=>m!==not&&tx(m,t,d));
const queue=[],parties=new Map();let wss;
// open public lobbies (newest first); pushed live to every client that has the party browser open
const pubList=()=>[...parties.values()].filter(p=>p.pub&&!p.run&&p.members.length).slice(-50).reverse().map(p=>({code:p.code,n:p.members.length,auth:p.auth}));
function pushList(){if(!wss)return;const l=pubList();wss.clients.forEach(c=>c.watch&&tx(c,"parties",l))}
function announce(r){r.members.forEach((m,i)=>tx(m,"room",{code:r.q?"":r.code,role:i,auth:r.auth,n:r.members.length,run:!!r.run,pub:!!r.pub}));if(!r.q)pushList()}
function startRoom(r){r.run=1;if(r.auth=="server"){
 const ctx=vm.createContext(sandbox());new vm.Script(SRC+"\n;globalThis.__s={NET,G,start,frame};",{filename:"game.js"}).runInContext(ctx);
 const s=r.sim=ctx.__s;s.NET.h=1;s.NET.r={emit:(t,d)=>bc(r,t,d)};s.start(4);
 r.timer=setInterval(()=>{try{s.frame(performance.now());if(s.G.s=="menu")endRoom(r)}catch(e){console.error("sim error",e);bc(r,"ev",[["end","SERVER ERROR"]]);endRoom(r)}},1000/60)}
 r.members.forEach((m,i)=>tx(m,"go",{auth:r.auth,role:i}));announce(r)}
function endRoom(r){clearInterval(r.timer);r.sim=null;r.run=0;if(r.q){r.members.forEach(m=>m.room=null);r.members=[]}else announce(r)}
function leave(ws){const qi=queue.indexOf(ws);if(qi>=0)queue.splice(qi,1);const r=ws.room;ws.room=null;if(!r)return;const i=r.members.indexOf(ws);if(i<0)return;r.members.splice(i,1);
 if(r.run&&i<2){bc(r,"left");clearInterval(r.timer);r.sim=null;r.run=0;if(r.q){r.members.forEach(m=>m.room=null);r.members=[]}}
 if(!r.members.length){parties.delete(r.code);pushList()}else announce(r)}
const srv=http.createServer((q,res)=>{if(q.url=="/"||q.url.startsWith("/?")){res.writeHead(200,{"content-type":"text/html"});res.end(HTML)}else{res.writeHead(404);res.end()}});
wss=new WebSocketServer({server:srv,path:"/ws"}).on("connection",ws=>{ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}const d=m.d||{},r=ws.room;
 if(m.t=="queue"){leave(ws);const o=queue.shift();if(o&&o.readyState==1){const q={q:1,auth:"server",members:[o,ws]};o.room=ws.room=q;startRoom(q)}else{queue.push(ws);tx(ws,"status","Searching for an opponent...")}}
 else if(m.t=="party"){leave(ws);let c;do c=Math.random().toString(36).slice(2,6).toUpperCase();while(parties.has(c));const p={code:c,auth:d.auth=="host"?"host":"server",pub:d.pub!==false,members:[ws]};parties.set(c,p);ws.room=p;announce(p)}
 else if(m.t=="join"){leave(ws);const p=parties.get(String(d.code||"").toUpperCase());if(!p)return tx(ws,"status","No party with that code.");p.members.push(ws);ws.room=p;announce(p);if(p.run)tx(ws,"go",{auth:p.auth,role:p.members.length-1})}
 else if(m.t=="list"){ws.watch=1;tx(ws,"parties",pubList())}
 else if(m.t=="unwatch")ws.watch=0;
 else if(m.t=="leave")leave(ws);
 else if(m.t=="start"){if(r&&!r.run&&r.members[0]===ws&&r.members.length>1)startRoom(r)}
 else if(m.t=="in"&&r&&r.run){const role=r.members.indexOf(ws);if(role>1)return;if(r.sim){const x=r.sim.NET.rin[role];for(const k of H)x[k]=d[k]?1:0;for(const k of E)if(d[k])x[k]=1}else tx(r.members[0],"in",{from:role,d})}
 else if((m.t=="st"||m.t=="ev")&&r&&r.auth=="host"&&r.members[0]===ws)bc(r,m.t,m.d,ws)});
 ws.on("close",()=>leave(ws))});
srv.listen(PORT,()=>console.log("Stick Duel on :"+PORT));
