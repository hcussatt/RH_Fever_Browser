// The main Pages document owns the connection; game iframes can be replaced freely.
import {siteRoot,assetResponse} from './assets.mjs';
import {PeerMatch,compareResults,decodeSignal} from './peer-match.mjs';
export function mountMultiplayer({games,version,openImport}){
 const root=document.createElement('section');root.id='multiplayer-lobby';root.hidden=true;
 root.innerHTML=`<header class="lobby-heading"><h2>PLAY WITH A FRIEND</h2><button id="lobby-leave">Back to arcade</button></header>
 <p>Private two-player lobby. The host picks the game. Both players use their own local disc data. Some networks block direct connections.</p>
 <div id="lobby-setup"><label>Your name<input id="lobby-name" maxlength="24" value="Player"></label><div class="lobby-actions"><button id="lobby-create">Create invite</button><button id="lobby-join">Generate answer</button></div>
 <label>Invite link or answer code<textarea id="lobby-incoming" rows="2" maxlength="48000" spellcheck="false"></textarea></label><button id="lobby-accept" hidden>Connect with answer</button>
 <label id="lobby-output-label" hidden><span id="lobby-output-title">Connection code</span><textarea id="lobby-output" rows="2" readonly></textarea></label><button id="lobby-copy" hidden>Copy connection details</button></div>
 <div id="lobby-connected" hidden><label>Game<select id="lobby-game"></select></label><p id="lobby-role"></p><div class="lobby-actions"><button id="lobby-ready" disabled>Ready</button><button id="lobby-rematch" hidden>New round</button><button id="lobby-import">Load your disc</button><button id="lobby-reload">Reload local game</button></div></div>
 <p id="lobby-status" role="status" aria-live="polite"></p><p id="lobby-progress"></p><p id="lobby-results"></p><div id="lobby-game-container"></div>`;
 document.querySelector('.cabinet').after(root);
 const $=id=>root.querySelector('#'+id),cabinet=document.querySelector('.cabinet');
 const entry=document.createElement('button');entry.id='open-multiplayer';entry.textContent='MULTIPLAYER';document.querySelector('.deck-buttons').prepend(entry);
 let peer,frame,api,loading=false,loadToken=0,task=false,autoSelected=false,localError='';
 for(const game of games){const option=document.createElement('option');option.value=game.id;option.textContent=game.title;$('lobby-game').append(option);}
 function show(){root.hidden=false;cabinet.hidden=true;}
 entry.onclick=show;
 function update(p){
  $('lobby-setup').hidden=!!p.connected;$('lobby-connected').hidden=!p.connected;
  const idle=p.state==='lobby'||p.state==='interrupted'||p.state==='finished'&&p.remoteResult;
  $('lobby-game').disabled=!p.host||!idle||!p.connected;
  $('lobby-role').textContent=p.host?'You are the host. Choose a game for both players.':'The host chooses the game. Your browser follows automatically.';
  if(p.selectedGame)$('lobby-game').value=p.selectedGame;
  $('lobby-ready').disabled=p.state!=='lobby'||!p.selectedGame||loading||p.localReady||p.preparing;
  $('lobby-ready').textContent=p.preparing?'Preparing…':p.localReady?'Ready — waiting for friend':'Ready';
  $('lobby-rematch').hidden=!p.connected||!(p.state==='interrupted'||p.state==='finished'&&p.remoteResult);
  let text=localError||(loading?(frame?.contentDocument?.querySelector('#status')?.textContent||'Preparing the selected game…'):p.message||'');
  if(p.state==='playing')text=performance.now()<p.began?'Starts in '+Math.ceil((p.began-performance.now())/1000)+'…':'Playing '+(games.find(g=>g.id===p.selectedGame)?.title||'')+(p.connected?'':' · Connection lost; local play continues');
  if(p.state==='finished')text=p.remoteResult?(p.unsynchronized?'Timing uncertain — unofficial comparison':compareResults(p.localResult,p.remoteResult)>0?'You win':compareResults(p.localResult,p.remoteResult)<0?'Friend wins':'Draw'):performance.now()-p.finishedAt>20000?'Comparison unavailable — friend’s result not received':'Finished — waiting for friend’s result…';
  $('lobby-status').textContent=text;
  const r=p.remote;$('lobby-progress').textContent=r?`${p.peerName}: ${r.hits} hits · ${r.misses+r.through} missed · Perfect ${r.perfectFailed?'broken':'active'}${p.state==='playing'&&performance.now()-p.lastRemote>2500?' · Updates interrupted':''}`:p.connected?`You: ${p.localReady?'ready':'not ready'} · ${p.peerName}: ${p.peerReady?'ready':'not ready'}`:'';
  $('lobby-results').textContent=p.state==='finished'&&p.remoteResult?`You: ${p.localResult.hits} hits, ${p.localResult.misses+p.localResult.through} missed. ${p.peerName}: ${p.remoteResult.hits} hits, ${p.remoteResult.misses+p.remoteResult.through} missed. Fewer missed cues wins; ties are draws.`:'';
  if(p.connected&&p.host&&!autoSelected){autoSelected=true;peer.selectGame($('lobby-game').value);}
 }
 async function load(id){
  const token=++loadToken;api?.stop();api=null;loading=true;localError='';
  frame=document.createElement('iframe');frame.id='lobby-player';frame.title=games.find(g=>g.id===id)?.title||'Selected game';frame.allow='autoplay';frame.src=new URL(id+'/?lobby=1',siteRoot);$('lobby-game-container').replaceChildren(frame);update(peer);
  const current=frame;
  try{
   const until=performance.now()+600000;
   while(token===loadToken){
    const rhf=current.contentWindow?.rhf;
    if(rhf?.error)throw new Error(rhf.error.split('\n')[0]);
    if(rhf?.multiplayer){api=rhf.multiplayer;api.attach(peer);loading=false;update(peer);return;}
    if(performance.now()>until)throw new Error('Game loading timed out. Load your disc, then reload the local game.');
    await new Promise(r=>setTimeout(r,100));
   }
  }catch(e){if(token===loadToken){loading=false;localError=e.message;update(peer);}}
 }
 async function fingerprint(){
  const g=api.game(),url=api.gameUrl;
  const paths=[new URL(g.manifest.id+'-core.wasm',url),...['main','runtime','clock','peer-match','audio','input'].map(n=>new URL(n+'.mjs',import.meta.url))];
  const hashes=await Promise.all(paths.map(async u=>{const r=await fetch(u);if(!r.ok)throw new Error('Cannot check runtime compatibility.');return hex(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()));}));
  const timeline=await (await assetResponse(new URL('assets/original-timeline.json',url))).json();
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({manifest:g.manifest,chart:g.chart,timeline,hashes}))));
 }
 const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
 function select(id){
  ++loadToken;api?.stop();api=null;frame=null;loading=false;localError='';
  const message=document.createElement('p');message.textContent='Press Ready to load '+(games.find(g=>g.id===id)?.title||id)+'.';$('lobby-game-container').replaceChildren(message);update(peer);
 }
 function create(){
  if(peer)throw new Error('Leave this lobby before creating another connection.');
  peer=new PeerMatch({identity:'lobby-v2:'+version,games:games.map(g=>g.id),name:$('lobby-name').value.trim()||'Player',onchange:update,onselect:select,
   prepare:async()=>{if(!api)await load(peer.selectedGame);if(!api||loading)throw new Error(localError||'Wait for the selected game to load.');const active=api;await active.prepare();if(active!==api||loading)throw new Error('The selected game changed. Ready again after it loads.');return fingerprint();},
   start:at=>{if(!api)throw new Error('Selected game is unavailable.');api.start(at+performance.timeOrigin-frame.contentWindow.performance.timeOrigin);frame.contentWindow.focus();},stop:()=>api?.stop(),snapshot:()=>api?.snapshot()});
  window.rhfLobby={peer,get frame(){return frame;},get api(){return api;}};return peer;
 }
 async function run(fn){if(task)return;task=true;try{await fn();}catch(e){$('lobby-status').textContent=e.message;}finally{task=false;}}
 function output(code,title){$('lobby-output').value=code;$('lobby-output-title').textContent=title;$('lobby-output-label').hidden=false;$('lobby-copy').hidden=false;}
 $('lobby-create').onclick=()=>run(async()=>{const p=create(),code=await p.invite(),url=new URL(siteRoot);url.hash='invite='+code;output(url.href,'Invite link');$('lobby-create').hidden=true;$('lobby-join').hidden=true;$('lobby-accept').hidden=false;});
 $('lobby-join').onclick=()=>run(async()=>{decodeSignal($('lobby-incoming').value,'offer');output(await create().answer($('lobby-incoming').value),'Answer code');$('lobby-create').hidden=true;$('lobby-join').hidden=true;});
 $('lobby-accept').onclick=()=>run(()=>peer.accept($('lobby-incoming').value));
 $('lobby-copy').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('lobby-output').value);$('lobby-status').textContent='Copied. Send it to your friend.';});
 $('lobby-ready').onclick=()=>run(()=>peer.ready());$('lobby-rematch').onclick=()=>peer.rematch();
 $('lobby-game').onchange=()=>{if(!peer.selectGame($('lobby-game').value))update(peer);};
 $('lobby-import').onclick=openImport;$('lobby-reload').onclick=()=>{if(peer.selectedGame&&peer.state==='lobby'&&!peer.localReady)load(peer.selectedGame);};
 $('lobby-leave').onclick=()=>{if(peer){peer.interrupt('Friend left the lobby.');peer.close();api?.stop();location.href=siteRoot.href;}else{root.hidden=true;cabinet.hidden=false;}};
 if(location.hash.startsWith('#invite=')){$('lobby-incoming').value=location.href;show();history.replaceState(null,'',location.pathname+location.search);}
 else if(location.hash==='#multiplayer')show();
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&peer?.localReady)peer.interrupt('Hidden tab interrupted the round.');});
 window.addEventListener('beforeunload',()=>peer?.close());
}
