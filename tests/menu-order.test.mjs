import {test} from 'node:test';
import assert from 'node:assert/strict';
import {menuColumns,iconLoadOrder} from '../web/engine/menu.mjs';
test('artwork loads left to right across rows of the displayed song-select columns',()=>{
 const games=['golf','robot','remix1','fork','remix2','tap','agbghost'].map(id=>({id}));
 assert.deepEqual(menuColumns(games).map(c=>c.games.map(g=>g.id)),[['remix1','golf','robot'],['remix2','fork'],['tap','agbghost']]);
 assert.deepEqual(iconLoadOrder(games).map(g=>g.id),['remix1','remix2','tap','golf','fork','agbghost','robot']);
 assert.deepEqual(games.map(g=>g.id),['golf','robot','remix1','fork','remix2','tap','agbghost']);
 assert.deepEqual(iconLoadOrder([]),[]);
});
