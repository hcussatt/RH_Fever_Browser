// The main Pages document owns the connection; game iframes can be replaced freely.
import {siteRoot,assetResponse} from './assets.mjs';
import {PeerMatch,compareResults,decodeSignal} from './peer-match.mjs';
import {songScore,missed,totals,compareTotals,remixSets,shuffleMatch,lead} from './versus.mjs';
export function mountMultiplayer({games,version,openImport,showGame=()=>{}}){
 const root=document.createElement('section');root.id='multiplayer-lobby';root.hidden=true;
 root.innerHTML=`<header class="lobby-heading"><h2>PLAY WITH A FRIEND</h2><button id="lobby-leave">Back to arcade</button></header>
 <p>Private two-player lobby. The host picks one game or a match. Both players use their own local disc data. Some networks block direct connections.</p>
 <div id="lobby-setup"><label>Your name<input id="lobby-name" maxlength="24" value="Player"></label><div class="lobby-actions"><button id="lobby-create">Create invite</button><button id="lobby-join">Generate answer</button></div>
 <label>Invite link or answer code<textarea id="lobby-incoming" rows="2" maxlength="48000" spellcheck="false"></textarea></label><button id="lobby-accept" hidden>Connect with answer</button>
 <label id="lobby-output-label" hidden><span id="lobby-output-title">Connection code</span><textarea id="lobby-output" rows="2" readonly></textarea></label><button id="lobby-copy" hidden>Copy connection details</button></div>
 <div id="lobby-connected" hidden><label>Mode<select id="lobby-mode"><option value="single">One game</option></select></label><label id="lobby-game-label">Game<select id="lobby-game"></select></label><p id="lobby-role"></p><div class="lobby-actions"><button id="lobby-start-match" hidden>Start match</button><button id="lobby-ready" disabled>Ready</button><button id="lobby-skip-practice" hidden>Skip practice</button><button id="lobby-next" hidden>Next song</button><button id="lobby-rematch" hidden>New round</button><button id="lobby-import">Load your disc</button><button id="lobby-reload">Reload local game</button></div></div>
 <p id="lobby-status" role="status" aria-live="polite"></p>
 <div id="lobby-lead" hidden><div class="lead-names"><span>You</span><span id="lobby-lead-friend">Friend</span></div><div class="lead-track" role="img"><span class="lead-diamond"></span></div></div><p id="lobby-progress"></p><p id="lobby-results"></p><div id="lobby-match" hidden></div><div id="lobby-game-container"></div>`;
 document.querySelector('.cabinet').after(root);
 const $=id=>root.querySelector('#'+id),cabinet=document.querySelector('.cabinet');
 const entry=document.createElement('button');entry.id='open-multiplayer';entry.textContent='MULTIPLAYER';document.querySelector('.deck-buttons').prepend(entry);
 let peer,frame,api,practising=false,practised=null,loading=false,loadToken=0,task=false,autoSelected=false,localError='';
 for(const game of games){const option=document.createElement('option');option.value=game.id;option.textContent=game.title;$('lobby-game').append(option);}
 const available=new Set(games.map(g=>g.id)),title=id=>games.find(g=>g.id===id)?.title||id,sets=remixSets(available);
 for(const set of sets){const option=document.createElement('option');option.value='set:'+set.title;option.textContent=set.title+' set ('+set.games.length+' songs)';$('lobby-mode').append(option);}
 if(shuffleMatch(available)){const option=document.createElement('option');option.value='shuffle';option.textContent='Shuffle (3 random games, a random "2" game and a random remix)';$('lobby-mode').append(option);}
 const modeOf=m=>!m?'single':m.title==='Shuffle'?'shuffle':'set:'+m.title;
 const score=n=>n.toFixed(1),grade=r=>['Superb','OK','Try Again'][r.grade]??'';
 function show(){root.hidden=false;cabinet.hidden=true;}
 entry.onclick=show;
 function update(p){
  $('lobby-setup').hidden=!!p.connected;$('lobby-connected').hidden=!p.connected;
  const idle=p.state==='lobby'||p.state==='interrupted'||p.state==='finished'&&p.remoteResult;
  const m=p.match,single=$('lobby-mode').value==='single';
  $('lobby-game').disabled=!p.host||!idle||!p.connected;$('lobby-mode').disabled=!p.host||!idle;
  if(!p.host)$('lobby-mode').value=modeOf(m);
  $('lobby-game-label').hidden=!p.host?!!m:!single;
  $('lobby-start-match').hidden=!p.host||single;$('lobby-start-match').disabled=!idle;$('lobby-start-match').textContent=m&&!p.matchOver?'Restart match':'Start match';
  $('lobby-next').hidden=!p.host||!m||!m.history[m.index]||p.matchOver;
  $('lobby-role').textContent=m?`${m.title} match · song ${m.index+1} of ${m.games.length}: ${title(m.games[m.index])}. `+(p.host?(p.matchOver?'Match over. Start another match or pick a mode.':'You are the host: press Next song after each song.'):'The host moves the match on. Your browser follows automatically.')
   :p.host?'You are the host. Choose a game or a match for both players.':'The host chooses the game. Your browser follows automatically.';
  if(p.selectedGame)$('lobby-game').value=p.selectedGame;
  // A game with a practice makes each player practise (or skip it) to become ready; replays just Ready.
  const practice=!!api?.hasPractice?.()&&practised!==p.selectedGame&&!p.localReady;
  $('lobby-ready').disabled=p.state!=='lobby'||!p.selectedGame||!api||loading||p.localReady||p.preparing||practising;
  $('lobby-ready').textContent=p.preparing?'Preparing…':p.localReady?'Ready — waiting for friend':practising?'Practising…':practice?'Practice':'Ready';
  $('lobby-skip-practice').hidden=!(practice||practising);$('lobby-skip-practice').disabled=p.state!=='lobby'||loading||p.preparing;
  $('lobby-rematch').hidden=!p.canRematch;$('lobby-rematch').textContent=m?'Replay this song':'New round';
  let text=localError||(loading?'Loading the host’s selected game…':p.message||'');
  if(p.state==='playing')text=performance.now()<p.began?'Starts in '+Math.ceil((p.began-performance.now())/1000)+'…':'Playing '+(games.find(g=>g.id===p.selectedGame)?.title||'')+(p.connected?'':' · Connection lost; local play continues');
  if(p.state==='finished')text=p.remoteResult?(p.unsynchronized?'Timing uncertain — unofficial comparison':outcome(p)):performance.now()-p.finishedAt>20000?'Comparison unavailable — friend’s result not received':'Finished — waiting for friend’s result…';
  $('lobby-status').textContent=text;
  const r=p.remote;$('lobby-progress').textContent=r?`${p.peerName}: ${r.hits} hits · ${r.misses+r.through} missed · Perfect ${r.perfectFailed?'broken':'active'}${p.state==='playing'&&performance.now()-p.lastRemote>2500?' · Updates interrupted':''}`:p.connected?`You: ${p.localReady?'ready':'not ready'} · ${p.peerName}: ${p.peerReady?'ready':'not ready'}`:'';
  const line=(who,r)=>`${who}: ${score(songScore(r))} (${grade(r)||'no grade'}), ${missed(r)} missed`;
  $('lobby-results').textContent=p.state==='finished'&&p.remoteResult?`${line('You',p.localResult)}. ${line(p.peerName,p.remoteResult)}. Higher score wins (0–100, the original's hit rate averaged over the song's categories); ties go to fewer missed cues.`:'';
  scoreboard(p);leadBar(p);
  if(p.connected&&p.host&&!autoSelected){autoSelected=true;peer.selectGame($('lobby-game').value);}
 }
 function outcome(p){
  const song=compareResults(p.localResult,p.remoteResult),songText=song>0?'You win this song':song<0?'Friend wins this song':'This song is a draw';
  if(!p.match)return song>0?'You win':song<0?'Friend wins':'Draw';
  if(!p.matchOver)return songText+'. '+(p.host?'Press Next song when you’re both set.':'Waiting for the host to start the next song.');
  const c=compareTotals(...matchTotals(p));return c>0?'You win the match!':c<0?p.peerName+' wins the match':'The match is a draw';
 }
 // Green is you, red your friend: the diamond slides toward whoever leads, further the bigger the lead.
 function leadBar(p){
  const live=p.state==='playing'&&performance.now()>=p.began,done=p.state==='finished'&&p.remoteResult;
  const mine=done?p.localResult:live?api?.snapshot():null,theirs=done?p.remoteResult:p.remote;
  $('lobby-lead').hidden=!(mine&&theirs);if($('lobby-lead').hidden)return;
  const l=lead(mine,theirs);$('lobby-lead-friend').textContent=p.peerName||'Friend';
  root.querySelector('.lead-diamond').style.left=(50-l*50)+'%';
  root.querySelector('.lead-track').setAttribute('aria-label',Math.abs(l)<.05?'Even':(l>0?'You lead':(p.peerName||'Friend')+' leads'));
 }
 function matchTotals(p){const h=p.match.history.filter(Boolean);return [totals(h.map(x=>x.local)),totals(h.map(x=>x.remote))];}
 // One row per song, then the running totals: score, then missed, Superbs and Perfects (the tie-breaks in order).
 function scoreboard(p){
  const m=p.match,board=$('lobby-match');board.hidden=!m;if(!m)return;
  const table=document.createElement('table'),row=(cells,head)=>{const tr=table.insertRow();for(const c of cells){const td=document.createElement(head?'th':'td');td.textContent=c;tr.append(td);}};
  row(['Song','You',p.peerName||'Friend'],true);
  m.games.forEach((id,i)=>{const h=m.history[i],cell=r=>r?`${score(songScore(r))} · ${grade(r)}`:i===m.index?'playing':'—';row([`${i+1}. ${title(id)}`,cell(h?.local),cell(h?.remote)]);});
  const [a,b]=matchTotals(p);
  row(['Total score',score(a.score),score(b.score)]);row(['Missed cues',a.missed,b.missed]);row(['Superbs · Perfects',`${a.superbs} · ${a.perfects}`,`${b.superbs} · ${b.perfects}`]);
  const caption=table.createCaption();caption.textContent=`${m.title} match`;board.replaceChildren(table);
 }
 async function load(id){
  const token=++loadToken;showGame(id);practised=null;api?.stop();api=null;loading=true;localError='';
  frame=document.createElement('iframe');frame.id='lobby-player';frame.title=games.find(g=>g.id===id)?.title||'Selected game';frame.allow='autoplay';frame.src=new URL(id+'/?lobby=1',siteRoot);$('lobby-game-container').replaceChildren(frame);update(peer);
  const current=frame;
  try{
   const until=performance.now()+120000;
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
  const paths=[new URL(g.manifest.id+'-core.wasm',url),...['main','runtime','clock','peer-match','versus','audio','input'].map(n=>new URL(n+'.mjs',import.meta.url))];
  const hashes=await Promise.all(paths.map(async u=>{const r=await fetch(u);if(!r.ok)throw new Error('Cannot check runtime compatibility.');return hex(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()));}));
  const timeline=await (await assetResponse(new URL('assets/original-timeline.json',url))).json();
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({manifest:g.manifest,chart:g.chart,timeline,hashes}))));
 }
 const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
 function create(){
  if(peer)throw new Error('Leave this lobby before creating another connection.');
  peer=new PeerMatch({identity:'lobby-v3:'+version,games:games.map(g=>g.id),name:$('lobby-name').value.trim()||'Player',onchange:update,onselect:id=>load(id),
   prepare:async()=>{if(!api||loading)throw new Error('Wait for the selected game to load.');const active=api;await active.prepare();if(active!==api||loading)throw new Error('The selected game changed. Ready again after it loads.');return fingerprint();},
   start:at=>{if(!api)throw new Error('Selected game is unavailable.');
    // Hand the iframe its own clock reading plus the time left, both read now. Shifting by the two
    // pages' timeOrigins broke when Chrome on macOS reported them ~990 s apart from their real
    // clocks: the music was scheduled in the past and both players crashed.
    const left=at-performance.now();if(left<0){peer.interrupt('The countdown was missed. Start a new round.');return;}
    api.start(frame.contentWindow.performance.now()+left);frame.contentWindow.focus();},stop:()=>api?.stop(),snapshot:()=>api?.snapshot()});
  window.rhfLobby={peer,get frame(){return frame;},get api(){return api;}};return peer;
 }
 async function run(fn){if(task)return;task=true;try{await fn();}catch(e){$('lobby-status').textContent=e.message;}finally{task=false;}}
 function output(code,title){$('lobby-output').value=code;$('lobby-output-title').textContent=title;$('lobby-output-label').hidden=false;$('lobby-copy').hidden=false;}
 $('lobby-create').onclick=()=>run(async()=>{const p=create(),code=await p.invite(),url=new URL(siteRoot);url.hash='invite='+code;output(url.href,'Invite link');$('lobby-create').hidden=true;$('lobby-join').hidden=true;$('lobby-accept').hidden=false;});
 $('lobby-join').onclick=()=>run(async()=>{decodeSignal($('lobby-incoming').value,'offer');output(await create().answer($('lobby-incoming').value),'Answer code');$('lobby-create').hidden=true;$('lobby-join').hidden=true;});
 $('lobby-accept').onclick=()=>run(()=>peer.accept($('lobby-incoming').value));
 $('lobby-copy').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('lobby-output').value);$('lobby-status').textContent='Copied. Send it to your friend.';});
 $('lobby-ready').onclick=()=>{
  if(!api?.hasPractice?.()||practised===peer.selectedGame){run(()=>peer.ready());return;}
  // Practise in the game frame; once it is done (or skipped) the song waits, paused, and this player is ready.
  const active=api,game=peer.selectedGame;practising=true;update(peer);frame.contentWindow.focus();
  active.practice().then(()=>{practising=false;if(active!==api||game!==peer.selectedGame)return update(peer);practised=game;run(()=>peer.ready());},
   e=>{practising=false;$('lobby-status').textContent=e.message;update(peer);});
 };
 $('lobby-skip-practice').onclick=()=>{if(practising){api?.skipPractice();return;}practised=peer.selectedGame;run(()=>peer.ready());};$('lobby-rematch').onclick=()=>peer.rematch();
 $('lobby-game').onchange=()=>{if(!peer.selectGame($('lobby-game').value))update(peer);};
 $('lobby-mode').onchange=()=>{if($('lobby-mode').value==='single'&&peer.match&&!peer.selectGame($('lobby-game').value))$('lobby-mode').value=modeOf(peer.match);update(peer);};
 $('lobby-start-match').onclick=()=>{const mode=$('lobby-mode').value,match=mode==='shuffle'?shuffleMatch(available):sets.find(s=>'set:'+s.title===mode);if(match&&!peer.startMatch(match))update(peer);};
 $('lobby-next').onclick=()=>{if(!peer.nextSong())update(peer);};
 $('lobby-import').onclick=openImport;$('lobby-reload').onclick=()=>{if(peer.selectedGame&&peer.state==='lobby'&&!peer.localReady)load(peer.selectedGame);};
 $('lobby-leave').onclick=()=>{if(peer){peer.interrupt('Friend left the lobby.');peer.close();api?.stop();location.href=siteRoot.href;}else{root.hidden=true;cabinet.hidden=false;showGame(null);}};
 if(location.hash.startsWith('#invite=')){$('lobby-incoming').value=location.href;show();history.replaceState(null,'',location.pathname+location.search);}
 else if(location.hash==='#multiplayer')show();
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&peer?.localReady)peer.interrupt('Hidden tab interrupted the round.');});
 window.addEventListener('beforeunload',()=>peer?.close());
}
