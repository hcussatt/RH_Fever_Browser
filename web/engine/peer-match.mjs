// Static-site WebRTC: signaling is an invite/answer exchanged by the players.
// Only summaries cross the wire. The simulation never reads remote input.
import {compareSongs,validMatch} from './versus.mjs';
export const PROTOCOL=3;
const MAX_CODE=48000,MAX_MESSAGE=8192;
export function encodeSignal(value){return btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeSignal(text,type){
 text=text.trim();if(text.includes('#invite='))text=new URL(text).hash.slice(8);
 if(text.length>MAX_CODE||! /^[A-Za-z0-9_-]+$/.test(text))throw new Error('Invalid connection code. Copy the complete code.');
 let v;try{v=JSON.parse(atob(text.replaceAll('-','+').replaceAll('_','/')));}catch{throw new Error('Invalid connection code.');}
 if(v.v!==PROTOCOL||v.type!==type||typeof v.sdp!=='string'||v.sdp.length>32000||! /^[a-z0-9-]{8,64}$/.test(v.id))throw new Error('Wrong or incompatible connection code.');
 return v;
}
const count=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
// Final results also carry the original grade and per-category checkpoint counts (versus.mjs).
export function validStats(s){return !!s&&['hits','misses','through','stray','perfectFailed'].every(k=>count(s[k],1000000))&&(s.grade===undefined||count(s.grade,2))
 &&(s.categories===undefined||Array.isArray(s.categories)&&s.categories.length<=8&&s.categories.every(c=>c&&['total','hits','misses','through'].every(k=>count(c[k],65535))));}
export function compareResults(a,b){if(!validStats(a)||!validStats(b))throw new Error('Invalid result');return compareSongs(a,b);}
export function clockSample(t0,t1,t2,t3){return {rtt:(t3-t0)-(t2-t1),offset:((t1-t0)+(t2-t3))/2};}
const statsOnly=s=>{const o=Object.fromEntries(['hits','misses','through','stray','perfectFailed'].map(k=>[k,s[k]]));
 if(s.grade!==undefined)o.grade=s.grade;if(s.categories)o.categories=s.categories.map(c=>({total:c.total,hits:c.hits,misses:c.misses,through:c.through}));return o;};
export class PeerMatch {
 constructor({identity,name='Player',prepare,start,stop,snapshot,onchange=()=>{},onselect=()=>{},games=[],iceServers=[{urls:'stun:stun.l.google.com:19302'}]}){
  Object.assign(this,{identity,name:name.slice(0,24),prepare,start,stop,snapshot,onchange,onselect,games,iceServers});
  this.state='setup';this.round=0;this.seq=0;this.lastSeq=-1;this.samples=[];this.pings=new Map();
  this.timer=setInterval(()=>this.tick(),200);
 }
 changed(message){if(message)this.message=message;this.onchange(this);}
 send(type,data={}){if(this.control?.readyState==='open')this.control.send(JSON.stringify({type,round:this.round,...data}));}
 async gather(type){
  const pc=this.pc;
  await pc.setLocalDescription(await (type==='offer'?pc.createOffer():pc.createAnswer()));
  if(pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
   const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
   const check=()=>{if(pc.iceGatheringState==='complete')done();};
   const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);if(pc.localDescription?.sdp.includes('a=candidate:'))resolve();else reject(new Error('No network candidates found. Try creating a new connection.'));},10000);
   pc.addEventListener('icegatheringstatechange',check);check();
  });
  return encodeSignal({v:PROTOCOL,id:this.id,type,sdp:pc.localDescription.sdp});
 }
 connection(host){
  if(this.pc)throw new Error('Leave this match before creating another connection.');
  this.host=host;this.state='connecting';this.connectAt=performance.now();
  const pc=this.pc=new RTCPeerConnection({iceServers:this.iceServers});
  pc.ondatachannel=e=>this.channel(e.channel);
  pc.onconnectionstatechange=()=>{
   if(['failed','closed'].includes(pc.connectionState))this.disconnected();
   else if(pc.connectionState==='disconnected')this.changed('Connection interrupted; local play can finish.');
  };
  if(host){this.channel(pc.createDataChannel('control'));this.channel(pc.createDataChannel('presence',{ordered:false,maxRetransmits:0}));}
  this.changed('Gathering connection details…');
 }
 channel(ch){
  if(!['control','presence'].includes(ch.label)){ch.close();return;}
  this[ch.label]=ch;
  if(ch.label==='control'){
   ch.onopen=()=>{this.send('hello',{identity:this.identity,name:this.name});this.changed('Checking game compatibility…');};
   ch.onclose=()=>this.disconnected();
  }
  ch.onmessage=e=>{try{
   if(typeof e.data!=='string'||e.data.length>MAX_MESSAGE)return;
   const m=JSON.parse(e.data);if(ch.label==='presence'){if(m.type==='status')this.receiveStatus(m);return;}this.receive(m);
  }catch{this.interrupt('Invalid peer message.');}};
 }
 async invite(){this.id=crypto.randomUUID();this.connection(true);const code=await this.gather('offer');this.changed('Send the invite, then paste your friend’s answer.');return code;}
 async answer(text){const v=decodeSignal(text,'offer');this.id=v.id;this.connection(false);await this.pc.setRemoteDescription({type:'offer',sdp:v.sdp});const code=await this.gather('answer');this.changed('Send this answer to the host. Keep this tab open.');return code;}
 async accept(text){const v=decodeSignal(text,'answer');if(!this.host||v.id!==this.id)throw new Error('This answer belongs to a different invite.');await this.pc.setRemoteDescription({type:'answer',sdp:v.sdp});this.changed('Connecting directly…');}
 receive(m){
  if(m.type==='hello'){
   if(m.identity!==this.identity){this.state='incompatible';this.changed('Different game or runtime. Both players must load the same version.');return;}
   if(this.state!=='connecting')return;
   this.peerName=typeof m.name==='string'?m.name.slice(0,24):'Friend';this.connected=true;this.state='lobby';this.round=1;this.changed('Connected. Both players can Ready.');return;
  }
  if(!this.connected)return;
  if(m.type==='select'&&!this.host&&m.round===this.round+1&&this.games.includes(m.game)&&['lobby','finished','interrupted'].includes(this.state)){
   if(m.match!==undefined&&!(validMatch(m.match,this.games)&&m.match.games[m.match.index]===m.game))return;
   this.follow(m.match);this.selectedGame=m.game;this.resetRound(m.round);this.onselect(m.game);return;}
  if(m.type==='new-round'&&!this.host&&m.round===this.round+1&&['finished','interrupted'].includes(this.state)){this.resetRound(m.round);return;}
  if(m.round!==this.round)return;
  switch(m.type){
   case 'ready':if(['lobby','syncing'].includes(this.state)){this.peerGameIdentity=m.identity;this.peerReady=true;if(this.localReady&&this.peerGameIdentity!==this.localGameIdentity){this.interrupt('Local game versions differ. Reload or reimport the selected game.');return;}this.changed('Friend is ready.');this.maybeSync();}break;
   case 'ping':if(Number.isFinite(m.t0)){const t1=performance.now();this.send('pong',{t0:m.t0,t1,t2:performance.now()});}break;
   case 'pong':if(this.host&&this.state==='syncing'&&this.pings.has(m.t0)&&[m.t1,m.t2].every(Number.isFinite)){
    this.pings.delete(m.t0);const s=clockSample(m.t0,m.t1,m.t2,performance.now());if(s.rtt>=0&&s.rtt<2000)this.samples.push(s);
   }break;
   case 'propose':if(!this.host&&this.localReady&&this.peerReady&&this.state==='lobby'&&Number.isFinite(m.at)&&m.at-performance.now()>1500&&m.at-performance.now()<10000){this.at=m.at;this.state='armed';this.send('ack');this.changed('Confirming countdown…');}break;
   case 'ack':if(this.host&&this.state==='armed'&&this.at-performance.now()>1500){this.send('commit');this.launch();}break;
   case 'commit':if(!this.host&&this.state==='armed'&&this.at-performance.now()>500)this.launch();else this.interrupt('Countdown arrived too late. Try a new round.');break;
   case 'interrupt':this.interrupt(typeof m.reason==='string'?m.reason.slice(0,120):'Round interrupted.',false);break;
   case 'result':if(validStats(m.result)&&['playing','finished'].includes(this.state)){this.remoteResult=statsOnly(m.result);this.record();this.send('result-ack');this.changed();}break;
   case 'result-ack':this.resultAck=true;break;
   case 'timing-warning':this.unsynchronized=true;this.changed();break;
   case 'rematch':if(this.host&&this.canRematch)this.newRound();break;
  }
 }
 async ready(){
  if(this.state!=='lobby'||this.localReady||this.preparing)return;
  const round=this.round;this.preparing=true;this.changed();
  try{const identity=await this.prepare();if(this.state!=='lobby'||this.round!==round)return;this.localGameIdentity=identity||this.identity;if(this.peerReady&&this.peerGameIdentity!==this.localGameIdentity){this.interrupt('Local game versions differ. Reload or reimport the selected game.');return;}this.localReady=true;this.send('ready',{identity:this.localGameIdentity});this.changed('Ready. Waiting for friend…');this.maybeSync();}
  finally{this.preparing=false;this.changed();}
 }
 get idle(){return this.connected&&(['lobby','interrupted'].includes(this.state)||this.state==='finished'&&!!this.remoteResult);}
 // A single game ends any match. The host's choice; the guest follows.
 selectGame(id,match){
  if(!this.host||!this.games.includes(id)||!this.idle)return false;
  this.match=match?{...match,history:match.index?this.match.history:[]}:null;
  const round=this.round+1;this.selectedGame=id;
  this.send('select',{round,game:id,...match?{match:{title:match.title,games:match.games,index:match.index}}:{}});this.resetRound(round);this.onselect(id);return true;
 }
 // A match is a list of songs, each its own round: both players Ready before every song.
 startMatch({title,games}){const m={title,games:[...games],index:0};return validMatch(m,this.games)&&this.selectGame(m.games[0],m);}
 nextSong(){const m=this.match;if(!m||!m.history[m.index]||m.index+1>=m.games.length)return false;return this.selectGame(m.games[m.index+1],{...m,index:m.index+1});}
 follow(match){
  const same=match&&this.match&&match.index>0&&match.title===this.match.title&&match.games.join()===this.match.games.join();
  this.match=match?{title:match.title,games:[...match.games],index:match.index,history:same?this.match.history:[]}:null;
 }
 record(){if(this.match&&this.state==='finished'&&this.localResult&&this.remoteResult)this.match.history[this.match.index]={local:this.localResult,remote:this.remoteResult};}
 get matchOver(){const m=this.match;return !!m&&m.games.every((_,i)=>m.history[i]);}
 // Inside a match only an interrupted song is replayed; finished ones move on.
 get canRematch(){return this.connected&&(this.state==='interrupted'||this.state==='finished'&&!!this.remoteResult&&!this.match);}
 maybeSync(){if(!this.host||!this.localReady||!this.peerReady||this.state!=='lobby')return;this.state='syncing';this.syncAt=performance.now();this.samples=[];this.pingCount=0;this.changed('Synchronizing clocks…');}
 launch(){this.state='playing';this.began=this.at;this.lastRemote=performance.now();this.start(this.at);this.changed('Countdown…');}
 tick(){
  const now=performance.now();
  if(this.state==='connecting'&&now-this.connectAt>90000){this.changed('Connection timed out. Direct connections may be blocked on this network. Leave and try again.');this.connectAt=now;}
  if(this.state==='syncing'){
   if(this.pingCount<8){const t0=performance.now();this.pings.set(t0,true);this.send('ping',{t0});this.pingCount++;}
   else if(now-this.syncAt>2000){
    const best=this.samples.sort((a,b)=>a.rtt-b.rtt)[0];
    if(!best||best.rtt>400){this.interrupt('Connection too uncertain for a synchronized start. Try a new round.');return;}
    this.estimatedUncertainty=best.rtt/2;this.at=now+4000;this.state='armed';this.send('propose',{at:this.at+best.offset});this.changed('Confirming countdown…');
   }
  }
  if(this.state==='armed'&&this.at-now<1000)this.interrupt('Countdown was not confirmed in time. Try a new round.');
  if(this.state==='playing'&&this.presence?.readyState==='open'&&this.presence.bufferedAmount<4096){
   const s=this.snapshot();if(s&&validStats(s))this.presence.send(JSON.stringify({type:'status',round:this.round,seq:++this.seq,position:Number.isFinite(s.position)?s.position:Math.max(0,(now-this.began)/1000),...statsOnly(s)}));
  }
  if(this.state==='finished'&&this.localResult&&!this.resultAck&&this.control?.readyState==='open')this.send('result',{result:this.localResult});
  if(['playing','finished'].includes(this.state))this.changed();
 }
 receiveStatus(m){
  if(m.round!==this.round||this.state!=='playing'||!Number.isSafeInteger(m.seq)||m.seq<=this.lastSeq||!validStats(m)||!Number.isFinite(m.position))return;
  const now=performance.now();this.lastSeq=m.seq;this.lastRemote=now;this.remote=statsOnly(m);
  // Arrival age includes transit time: this is a conservative diagnostic, never a correction.
  if(!this.unsynchronized&&Math.abs(Math.max(0,(now-this.began)/1000)-m.position)>.5){this.unsynchronized=true;this.send('timing-warning');}
  this.changed();
 }
 finish(result){if(this.state!=='playing')return;this.localResult=statsOnly(result);this.state='finished';this.finishedAt=performance.now();this.record();this.send('result',{result:this.localResult});this.changed();}
 interrupt(reason='Round interrupted.',notify=true){
  // Completed comparisons survive pausing the original results presentation.
  if(this.state==='finished'&&this.remoteResult){this.stop();return;}
  if(!['lobby','syncing','armed','playing','finished'].includes(this.state))return;
  if(notify)this.send('interrupt',{reason});this.state='interrupted';this.localReady=false;this.stop();this.changed(reason);
 }
 disconnected(){this.connected=false;this.changed('Connection lost. Local play can finish; reconnect with a new invite afterward.');if(['syncing','armed'].includes(this.state))this.interrupt('Connection lost during countdown.',false);}
 rematch(){if(!this.canRematch)return;if(this.host)this.newRound();else this.send('rematch');}
 newRound(){const round=this.round+1;this.send('new-round',{round});this.resetRound(round);}
 resetRound(round){this.stop();Object.assign(this,{round,state:'lobby',localReady:false,peerReady:false,localGameIdentity:null,peerGameIdentity:null,remote:null,localResult:null,remoteResult:null,resultAck:false,unsynchronized:false,lastSeq:-1});this.pings.clear();this.changed('New round. Both players must Ready again.');}
 close(){clearInterval(this.timer);this.connected=false;this.pc?.close();this.state='closed';}
}
