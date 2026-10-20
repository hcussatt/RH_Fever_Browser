// The game picker's order, after the original song select: each remix's set (its minigames in the
// order the original lists them, then the remix), then every game that belongs to no remix.
// A minigame's set is the first remix whose graphics it has on the disc (cellanim/<game>/remix0N).
export const SETS=[
 {title:'Remix 1',games:['golf','robot','seesaw','date','remix1']},
 {title:'Remix 3',games:['bun','seal','badminton','muscle','remix3']},
 {title:'Remix 6',games:['rocket','concons','receive','rap','remix6']},
];
export const OTHER='Other games';
// Groups a game list ({id,...}) into [{title,games}], keeping only the sets that have a game.
export function groupGames(games){
 const byId=new Map(games.map(g=>[g.id,g])),placed=new Set(SETS.flatMap(s=>s.games));
 const groups=SETS.map(s=>({title:s.title,games:s.games.filter(id=>byId.has(id)).map(id=>byId.get(id))}));
 groups.push({title:OTHER,games:games.filter(g=>!placed.has(g.id))});
 return groups.filter(g=>g.games.length);
}
