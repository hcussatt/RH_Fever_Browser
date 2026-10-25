// The game picker's order, after the original song select: each remix's set (its minigames in the
// order the original lists them, then the remix), then every game that belongs to no remix.
// A minigame's set is the first remix whose graphics it has on the disc (cellanim/<game>/remix0N).
export const SETS=[
 {title:'Remix 1',games:['golf','robot','seesaw','date','remix1']},
 {title:'Remix 2',games:['fork','tambourine','rotation','watch','remix2']},
 {title:'Remix 3',games:['bun','seal','badminton','muscle','remix3']},
 {title:'Remix 4',games:['interview','sort','flea','samurai','remix4']},
 {title:'Remix 5',games:['fishing','goma','batting','birds','remix5']},
 {title:'Remix 6',games:['rocket','concons','receive','rap','remix6']},
 {title:'Remix 7',games:['taptroupe','shrimp','panel','karateman','remix7']},
];
export const OTHER='Other games';
// Groups a game list ({id,...}) into [{title,games}], keeping only the sets that have a game.
export function groupGames(games){
 const byId=new Map(games.map(g=>[g.id,g])),placed=new Set(SETS.flatMap(s=>s.games));
 const groups=SETS.map(s=>({title:s.title,games:s.games.filter(id=>byId.has(id)).map(id=>byId.get(id))}));
 groups.push({title:OTHER,games:games.filter(g=>!placed.has(g.id))});
 return groups.filter(g=>g.games.length);
}

// The song-select columns put each remix above its source games.
export function menuColumns(games){
 return groupGames(games).map(group=>{
  const remix=group.title.toLowerCase().replace(' ','');
  return {...group,games:[...group.games.filter(g=>g.id===remix),...group.games.filter(g=>g.id!==remix)]};
 });
}
// Prepare artwork across each visible row, from the leftmost set to the rightmost.
export function iconLoadOrder(games){
 const columns=menuColumns(games),rows=Math.max(0,...columns.map(g=>g.games.length));
 return Array.from({length:rows},(_,row)=>columns.map(column=>column.games[row]).filter(Boolean)).flat();
}
