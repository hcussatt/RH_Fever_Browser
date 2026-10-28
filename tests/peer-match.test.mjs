import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROTOCOL,PeerMatch,encodeSignal,decodeSignal,compareResults,clockSample} from '../web/engine/peer-match.mjs';
import {songScore,totals,compareTotals,remixSets,shuffleMatch} from '../web/engine/versus.mjs';
import {SETS} from '../web/engine/menu.mjs';
const stats=(hits=10,misses=0,through=0)=>({hits,misses,through,stray:0,perfectFailed:0});
function pair(){
 const options={identity:'same',prepare:async()=>{},start:()=>{},stop:()=>{},snapshot:()=>stats()};
 const a=new PeerMatch(options),b=new PeerMatch(options);a.host=true;b.host=false;
 a.state=b.state='connecting';
 a.control={readyState:'open',send:s=>queueMicrotask(()=>b.receive(JSON.parse(s)))};
 b.control={readyState:'open',send:s=>queueMicrotask(()=>a.receive(JSON.parse(s)))};
 a.send('hello',{identity:'same',name:'A'});b.send('hello',{identity:'same',name:'B'});
 return [a,b];
}
const flush=()=>new Promise(r=>setImmediate(r));
test('manual signaling roundtrip, URL fragments, malformed and wrong answers',()=>{
 const v={v:PROTOCOL,id:'12345678-abcd',type:'offer',sdp:'v=0\r\na=candidate:example'};
 const code=encodeSignal(v);assert.deepEqual(decodeSignal('https://example.com/golf/#invite='+code,'offer'),v);
 assert.throws(()=>decodeSignal(code,'answer'));assert.throws(()=>decodeSignal('!!!','offer'));assert.throws(()=>decodeSignal('a'.repeat(48001),'offer'));
});
test('single-song comparison scores hit rate, counts throughs and permits a draw; rejects invalid counters',()=>{
 assert.equal(compareResults(stats(10,0,3),stats(10,1,0)),-1);
 assert.equal(compareResults(stats(),stats()),0);assert.equal(compareResults(stats(),stats(8,1,1)),1);
 assert.throws(()=>compareResults({...stats(),hits:-1},stats()));
});
test('clock estimate handles different monotonic clock origins and processing time',()=>{
 assert.deepEqual(clockSample(100,615,620,130),{rtt:25,offset:502.5});
});
test('ready, scheduled start, results and rematch require both players again',async()=>{
 const [a,b]=pair();try{
  await flush();assert.equal(a.state,'lobby');assert.equal(b.peerName,'A');
  await a.ready();await b.ready();await flush();assert.equal(a.state,'syncing');
  a.samples=[{rtt:20,offset:0}];a.pingCount=8;a.syncAt=performance.now()-2500;a.tick();await flush();await flush();
  assert.equal(a.state,'playing');assert.equal(b.state,'playing');assert.ok(Math.abs(a.began-b.began)<1);
  a.finish(stats());b.finish(stats(8,1,1));await flush();await flush();assert.deepEqual(a.remoteResult,stats(8,1,1));assert.ok(a.resultAck);
  a.interrupt('Pause during results');assert.equal(a.state,'finished');
  b.rematch();await flush();await flush();assert.equal(a.round,2);assert.equal(b.round,2);assert.equal(a.localReady,false);assert.equal(b.peerReady,false);
  b.receive({type:'result',round:1,result:stats()});assert.equal(b.remoteResult,null);
 }finally{a.close();b.close();}
});
test('interruption cancels both games and stale/out-of-order presence is ignored',async()=>{
 const [a,b]=pair();try{await flush();a.state=b.state='playing';a.began=b.began=performance.now();
  a.receiveStatus({type:'status',round:1,seq:2,position:0,...stats(3)});
  a.receiveStatus({type:'status',round:1,seq:1,position:0,...stats(1)});assert.equal(a.remote.hits,3);
  a.interrupt('Hidden tab');await flush();assert.equal(b.state,'interrupted');
  a.receive({type:'result',round:1,result:stats()});assert.equal(a.remoteResult,undefined);
 }finally{a.close();b.close();}
});
test('unconfirmed and high-uncertainty countdowns cannot start; mismatched builds cannot ready',async()=>{
 const [a,b]=pair();try{await flush();a.state='armed';a.at=performance.now()+200;a.tick();assert.equal(a.state,'interrupted');
  a.state='syncing';a.syncAt=performance.now()-2500;a.samples=[{rtt:600,offset:0}];a.pingCount=8;a.tick();assert.equal(a.state,'interrupted');
  b.state='connecting';b.receive({type:'hello',identity:'wrong'});assert.equal(b.state,'incompatible');await b.ready();assert.ok(!b.localReady);
 }finally{a.close();b.close();}
});
test('disconnect preserves local play and a late commit never starts',async()=>{
 const [a,b]=pair();try{await flush();a.state='playing';a.disconnected();assert.equal(a.state,'playing');assert.equal(a.connected,false);
  let started=false;b.start=()=>{started=true;};b.state='armed';b.at=performance.now()-10;b.receive({type:'commit',round:1});assert.equal(started,false);assert.equal(b.state,'interrupted');
 }finally{a.close();b.close();}
});
test('preparation failures can retry and timing warnings reach both players',async()=>{
 const [a,b]=pair();try{await flush();a.prepare=async()=>{throw new Error('Cannot unlock audio');};await assert.rejects(a.ready(),/unlock/);assert.equal(a.preparing,false);assert.ok(!a.localReady);
  a.state=b.state='playing';a.began=performance.now()-2000;a.receiveStatus({round:1,seq:1,position:0,...stats()});await flush();assert.equal(a.unsynchronized,true);assert.equal(b.unsynchronized,true);
 }finally{a.close();b.close();}
});

test('only host changes the game; selection clears readiness and guests follow',async()=>{
 const [a,b]=pair();try{await flush();a.games=b.games=['golf','tap'];let followed;b.onselect=id=>{followed=id;};
  assert.equal(b.selectGame('tap'),false);assert.equal(a.selectGame('golf'),true);await flush();assert.equal(followed,'golf');
  a.localReady=true;b.localReady=true;a.selectGame('tap');await flush();assert.equal(b.selectedGame,'tap');assert.equal(b.localReady,false);assert.equal(a.localReady,false);
  a.state='playing';assert.equal(a.selectGame('golf'),false);
 }finally{a.close();b.close();}
});
test('game-version mismatch prevents a countdown',async()=>{
 const [a,b]=pair();try{await flush();a.prepare=async()=> 'one';b.prepare=async()=> 'two';await a.ready();await flush();await b.ready();await flush();assert.equal(a.state,'interrupted');assert.equal(b.state,'interrupted');
 }finally{a.close();b.close();}
});

test('host waits for both final results before changing games',async()=>{
 const [a,b]=pair();try{await flush();a.games=b.games=['golf','tap'];
  a.state='finished';a.localResult=stats();a.remoteResult=null;
  assert.equal(a.selectGame('tap'),false);
  a.remoteResult=stats();assert.equal(a.selectGame('tap'),true);
 }finally{a.close();b.close();}
});

test('song score averages the original category hit rates; match totals break ties in order',()=>{
 const cat=(total,hits)=>({total,hits,misses:total-hits,through:0});
 // A short category counts as much as a long one.
 assert.equal(songScore({...stats(),categories:[cat(100,100),cat(10,5)]}),75);
 assert.equal(songScore({...stats(),categories:[cat(0,0),cat(3,2)]}),66.7);
 assert.equal(songScore(stats(3,1,0)),75);assert.equal(songScore(stats(0,0,0)),100);
 const r=(score,miss,grade,perfectFailed=1)=>({...stats(score,0,miss),grade,perfectFailed,categories:[cat(100,score)]});
 assert.equal(compareTotals(totals([r(90,0,1),r(80,0,1)]),totals([r(85,0,1),r(84,0,1)])),1);
 assert.equal(compareTotals(totals([r(90,5,1)]),totals([r(90,0,1)])),-1,'equal score: fewer missed wins');
 assert.equal(compareTotals(totals([r(90,0,0)]),totals([r(90,0,1)])),1,'then more Superbs');
 assert.equal(compareTotals(totals([r(90,0,1,0)]),totals([r(90,0,1)])),1,'then Perfects');
 assert.equal(compareTotals(totals([r(90,0,1)]),totals([r(90,0,1)])),0);
 assert.throws(()=>compareResults({...stats(),categories:[{total:-1,hits:0,misses:0,through:0}]},stats()));
});
test('standard sets follow the song select rows; shuffle draws 3 different minigames and a remix',()=>{
 const all=new Set(SETS.flatMap(s=>s.games));
 const sets=remixSets(all);assert.equal(sets.length,10);assert.deepEqual(sets[0].games,['golf','robot','seesaw','date','remix1']);
 assert.equal(remixSets(new Set(['golf','robot'])).length,0,'a set needs its remix');
 for(let seed=0;seed<50;seed++){let x=seed;const m=shuffleMatch(all,()=>(x=(x*9301+49297)%233280)/233280);
  assert.equal(m.games.length,4);assert.equal(new Set(m.games).size,4);assert.ok(m.games.slice(0,3).every(id=>!id.startsWith('remix')));assert.ok(m.games[3].startsWith('remix'));}
 assert.equal(shuffleMatch(new Set(['golf','remix1'])),null);
});
test('a match plays its songs in order, records both results and ends with totals',async()=>{
 const [a,b]=pair();try{await flush();const list=['golf','robot','remix1'];a.games=b.games=['golf','robot','seesaw','remix1'];
  const loaded=[];b.onselect=id=>loaded.push(id);
  assert.equal(b.startMatch({title:'Remix 1',games:list}),false,'guests cannot start a match');
  assert.equal(a.startMatch({title:'Remix 1',games:['golf','nope']}),false);
  assert.equal(a.startMatch({title:'Remix 1',games:list}),true);await flush();
  assert.deepEqual(loaded,['golf']);assert.equal(b.match.index,0);assert.equal(a.nextSong(),false,'not before results');
  for(let i=0;i<list.length;i++){
   a.state=b.state='playing';a.finish(stats(10,i));b.finish(stats(10,0));await flush();await flush();
   assert.deepEqual(a.match.history[i],{local:stats(10,i),remote:stats(10,0)});assert.deepEqual(b.match.history[i],{local:stats(10,0),remote:stats(10,i)});
   assert.equal(a.canRematch,false,'finished songs move on');
   if(i<list.length-1){assert.equal(a.matchOver,false);assert.equal(a.nextSong(),true);await flush();assert.equal(b.selectedGame,list[i+1]);assert.equal(b.match.history.length,i+1);}
  }
  assert.ok(a.matchOver&&b.matchOver);assert.equal(a.nextSong(),false);assert.deepEqual(loaded,list);
  // An interrupted song is replayed inside the match; picking one game ends it.
  assert.equal(a.startMatch({title:'Remix 1',games:list}),true);await flush();assert.equal(b.match.history.length,0);
  a.state='playing';a.interrupt('Pause');await flush();assert.ok(b.canRematch);b.rematch();await flush();await flush();assert.equal(a.state,'lobby');assert.equal(a.match.index,0);
  a.selectGame('seesaw');await flush();assert.equal(a.match,null);assert.equal(b.match,null);
  // A guest ignores a match whose song does not match the selection.
  b.receive({type:'select',round:b.round+1,game:'golf',match:{title:'x',games:['robot'],index:0}});assert.equal(b.selectedGame,'seesaw');
 }finally{a.close();b.close();}
});
