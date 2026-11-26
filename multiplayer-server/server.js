import { WebSocketServer } from "ws";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT=process.env.PORT||2567, HOST_KEY=process.env.TITAN_HOST_KEY||"CHANGE_THIS_HOST_KEY";
const http=createServer((req,res)=>{res.writeHead(200,{"content-type":"application/json","access-control-allow-origin":"*"});res.end(JSON.stringify({service:"TITAN multiplayer",status:"online"}));});
const wss=new WebSocketServer({server:http});
const rooms=new Map(), sockets=new Map();
const code=()=>randomBytes(3).toString("hex").toUpperCase();
const id=()=>randomBytes(8).toString("hex");
const safe=(v,n=32)=>String(v??"").replace(/[<>]/g,"").trim().slice(0,n);
function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj));}
function snapshot(r){return {code:r.code,status:r.status,createdAt:r.createdAt,settings:r.settings,ships:r.ships,players:[...r.players.values()].map(({ws,...p})=>p),winner:r.winner,startedAt:r.startedAt};}
function broadcast(r){const msg=JSON.stringify({type:"state",state:snapshot(r)});for(const c of r.clients)if(c.readyState===1)c.send(msg);}
function fail(ws,message){send(ws,{type:"error",message});}
function authHost(msg){const a=Buffer.from(String(msg.hostKey||""));const b=Buffer.from(HOST_KEY);return a.length===b.length&&timingSafeEqual(a,b)&&HOST_KEY!=="CHANGE_THIS_HOST_KEY";}
wss.on("connection",ws=>{
 let session={room:null,role:null,playerId:null};sockets.set(ws,session);
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return fail(ws,"Invalid message")}
  const s=sockets.get(ws);
  if(m.type==="host:create"){
   if(!authHost(m))return fail(ws,"Host key is not configured or is incorrect.");
   let c=code();while(rooms.has(c))c=code();
   const r={code:c,status:"lobby",createdAt:Date.now(),settings:{maxPerTeam:15,destination:"FINISH LINE",map:"TITAN CUSTOM COURSE"},players:new Map(),clients:new Set(),winner:null,startedAt:null,hostWs:ws,
    ships:{A:{x:-5,z:0,yaw:0,speed:0,progress:0,hp:100},B:{x:5,z:0,yaw:0,speed:0,progress:0,hp:100}}};
   rooms.set(c,r);session.room=c;session.role="host";r.clients.add(ws);send(ws,{type:"created",code:c,hostSession:id()});broadcast(r);return;
  }
  const r=rooms.get(s.room||safe(m.code,8).toUpperCase());
  if(m.type==="watch"){
   if(!r)return fail(ws,"Room not found.");s.room=r.code;s.role="spectator";r.clients.add(ws);send(ws,{type:"watching"});broadcast(r);return;
  }
  if(m.type==="join"){
   if(!r)return fail(ws,"Room not found.");
   if(r.status!=="lobby")return fail(ws,"This race has already started.");
   const team=m.team==="B"?"B":"A",pid=safe(m.deviceId,80)||id();
   const existing=r.players.get(pid);if(existing&&existing.ws&&existing.ws!==ws)return fail(ws,"This player is already connected on another device.");
   const count=[...r.players.values()].filter(p=>p.team===team&&p.id!==pid).length;
   if(!existing&&count>=15)return fail(ws,"That team is full (15 players).");
   const p={id:pid,name:safe(m.name,22)||"Crew Member",team,ready:false,x:team==="A"?-5:5,z:0,y:0,yaw:0,joinedAt:Date.now(),ws};
   r.players.set(pid,p);r.clients.add(ws);Object.assign(s,{room:r.code,role:"player",playerId:pid});
   send(ws,{type:"joined",playerId:pid,team});broadcast(r);return;
  }
  if(!r)return fail(ws,"Join or create a room first.");
  if(m.type==="host:claim"){
   if(!authHost(m))return fail(ws,"Host key incorrect.");
   if(r.hostWs&&r.hostWs!==ws&&r.hostWs.readyState===1)return fail(ws,"This room already has an active host device.");
   r.hostWs=ws;s.role="host";r.clients.add(ws);broadcast(r);send(ws,{type:"host:claimed"});return;
  }
  if(m.type==="player:ready"&&s.role==="player"){
   const p=r.players.get(s.playerId);if(p){p.ready=!!m.ready;broadcast(r)}return;
  }
  if(m.type==="player:move"&&s.role==="player"){
   const p=r.players.get(s.playerId);if(!p)return;
   p.x=Math.max(-30,Math.min(30,Number(m.x)||0));p.z=Math.max(-200,Math.min(200,Number(m.z)||0));p.yaw=Number(m.yaw)||0;return;
  }
  if(m.type==="host:start"&&s.role==="host"){
   if(r.status!=="lobby")return;
   const count=r.players.size;if(count<2)return fail(ws,"At least two players are required.");
   if([...r.players.values()].some(p=>!p.ready))return fail(ws,"Every player must be ready before starting.");
   r.status="racing";r.startedAt=Date.now();broadcast(r);return;
  }
  if(m.type==="host:ship"&&s.role==="host"){
   const t=m.team==="B"?"B":"A",ship=r.ships[t];
   for(const k of ["x","z","yaw","speed","progress","hp"])if(Number.isFinite(Number(m[k])))ship[k]=Math.max(k==="hp"||k==="progress"?0:-10000,Math.min(k==="hp"||k==="progress"?100:10000,Number(m[k])));
   broadcast(r);return;
  }
  if(m.type==="host:finish"&&s.role==="host"){
   if(r.status==="racing"){r.status="finished";r.winner=m.team==="B"?"B":"A";broadcast(r)}return;
  }
  if(m.type==="host:reset"&&s.role==="host"){
   r.status="lobby";r.winner=null;r.startedAt=null;
   for(const p of r.players.values())p.ready=false;
   for(const t of ["A","B"])Object.assign(r.ships[t],{x:t==="A"?-5:5,z:0,yaw:0,speed:0,progress:0,hp:100});
   broadcast(r);return;
  }
  if(m.type==="host:kick"&&s.role==="host"){
   const p=r.players.get(safe(m.playerId,80));if(p){send(p.ws,{type:"kicked"});r.clients.delete(p.ws);r.players.delete(p.id);broadcast(r)}return;
  }
 });
 ws.on("close",()=>{
  const s=sockets.get(ws);if(!s)return;const r=rooms.get(s.room);
  if(r){r.clients.delete(ws);if(s.role==="host"&&r.hostWs===ws)r.hostWs=null;if(s.role==="player"){const p=r.players.get(s.playerId);if(p&&p.ws===ws){p.connected=false;p.ws=null;setTimeout(()=>{const cur=rooms.get(s.room),q=cur?.players.get(s.playerId);if(q&&!q.ws){cur.players.delete(s.playerId);broadcast(cur)}},30000)}}}
  sockets.delete(ws);
 });
});
setInterval(()=>{for(const r of rooms.values())if(r.status==="racing"){const dt=(Date.now()-(r._tick||Date.now()))/1000;r._tick=Date.now();for(const t of ["A","B"]){const sh=r.ships[t];sh.z-=sh.speed*dt*.025;sh.progress=Math.min(100,Math.max(0,(-sh.z/1000)*100));if(sh.progress>=100&&r.status==="racing"){r.status="finished";r.winner=t}}broadcast(r)}},100);
http.listen(PORT,()=>console.log(`TITAN multiplayer listening on ${PORT}`));
