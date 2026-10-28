// Versus scoring and match song lists. Pure functions shared by the lobby and the protocol.
// A song's score comes from the original checkpoint manager's per-category counts (the same
// hits*100/total the original grades with), averaged so every category and every song counts
// the same however many cues it has. A match adds its songs' scores.
import {SETS} from './menu.mjs';
export const SUPERB=0;
const MAX_SONGS=8;
// 0-100, to one decimal so both players' browsers round alike.
export function songScore(r){
 const parts=(r.categories||[]).filter(c=>c.total>0).map(c=>Math.min(100,c.hits*100/c.total));
 if(!parts.length){const n=r.hits+r.misses+r.through;parts.push(n?r.hits*100/n:100);}
 return Math.round(parts.reduce((a,b)=>a+b,0)/parts.length*10)/10;
}
export const missed=r=>r.misses+r.through;
export function totals(results){
 const t={score:0,missed:0,superbs:0,perfects:0,songs:results.length};
 for(const r of results){t.score+=songScore(r);t.missed+=missed(r);if(r.grade===SUPERB)t.superbs++;if(!r.perfectFailed)t.perfects++;}
 t.score=Math.round(t.score*10)/10;return t;
}
// >0 when a wins. Higher score, then fewer missed cues, then more Superbs, then more Perfects.
export function compareTotals(a,b){
 return Math.sign(a.score-b.score)||Math.sign(b.missed-a.missed)||Math.sign(a.superbs-b.superbs)||Math.sign(a.perfects-b.perfects);
}
export const compareSongs=(a,b)=>compareTotals(totals([a]),totals([b]));
// Standard: one remix row of the song select, its minigames then the remix.
export const remixSets=available=>SETS.map(s=>({title:s.title,games:s.games.filter(id=>available.has(id))})).filter(s=>s.games.length>1&&s.games.at(-1).startsWith('remix'));
// Shuffle (Henry, 2026-10-28): three different minigames from the remix rows (version 1),
// one "2" version from rows 8 to 10 (never the same game as a version 1 pick), then a random remix.
const second=id=>/2$/.test(id);
export function shuffleMatch(available,random=Math.random){
 const pick=list=>list.splice(Math.floor(random()*list.length),1)[0];
 const minigames=[...new Set(SETS.flatMap(s=>s.games.slice(0,-1)))].filter(id=>available.has(id));
 const firsts=minigames.filter(id=>!second(id)),seconds=minigames.filter(second);
 const remixes=SETS.map(s=>s.games.at(-1)).filter(id=>available.has(id));
 if(firsts.length<3||!seconds.length||!remixes.length)return null;
 const games=[pick(firsts),pick(firsts),pick(firsts)];
 const twos=seconds.filter(id=>!games.includes(id.slice(0,-1)));
 if(!twos.length)return null;
 return {title:'Shuffle',games:[...games,pick(twos),pick(remixes)]};
}
export function validMatch(m,games){
 return m&&typeof m.title==='string'&&m.title.length<=40&&Array.isArray(m.games)&&m.games.length>=1&&m.games.length<=MAX_SONGS&&m.games.every(id=>games.includes(id))&&Number.isSafeInteger(m.index)&&m.index>=0&&m.index<m.games.length;
}
