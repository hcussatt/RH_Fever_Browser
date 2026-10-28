import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{Room,newRoomCode,ROOM_ALPHABET,ROOM_LENGTH} from '../matchmaker/worker.mjs';
import {normalizeRoom,openRoom,readOffer,sendAnswer,waitForAnswer} from '../web/engine/matchmaker.mjs';
// In-memory stand-ins for the Durable Object namespace, storage and alarm.
function environment(){
 const rooms=new Map();
 const storage=()=>{const data=new Map();return {data,alarm:null,async get(k){return data.get(k);},async put(k,v){data.set(k,v);},async deleteAll(){data.clear();},async setAlarm(t){this.alarm=t;},async deleteAlarm(){this.alarm=null;}};};
 const env={ALLOWED_ORIGINS:'https://hcussatt.github.io',rooms,ROOMS:{idFromName:name=>name,get(id){if(!rooms.has(id))rooms.set(id,new Room({storage:storage()}));const room=rooms.get(id);return {fetch:(url,init)=>room.fetch(new Request(url,init))};}}};
 const fetchFn=(url,init={},origin='https://hcussatt.github.io')=>worker.fetch(new Request(url,{...init,headers:{origin}}),env);
 return {env,fetchFn,base:'https://matchmaker.example/'};
}
const offer='eyJ2IjoyLCJ0eXBlIjoib2ZmZXIifQ',answer='eyJ2IjoyLCJ0eXBlIjoiYW5zd2VyIn0';
test('room codes are six unambiguous characters and links or typed codes normalize',()=>{
 for(let i=0;i<200;i++){const code=newRoomCode();assert.equal(code.length,ROOM_LENGTH);assert.ok([...code].every(c=>ROOM_ALPHABET.includes(c)));}
 assert.equal(normalizeRoom('https://hcussatt.github.io/RH_Fever_Browser/#room=ABC234'),'ABC234');
 assert.equal(normalizeRoom(' abc-234 '),'ABC234');
 for(const bad of ['ABC23','ABC2345','ABCO23','ABC1I2',''])assert.throws(()=>normalizeRoom(bad));
});
test('host opens a room, guest reads the invite and answers, host receives it once',async()=>{
 const {env,fetchFn,base}=environment(),o={base,fetchFn};
 const code=await openRoom(offer,o);assert.match(code,/^[A-Z2-9]{6}$/);
 const storage=[...env.rooms.values()][0].storage;assert.ok(storage.alarm>Date.now());
 assert.equal(await readOffer(code.toLowerCase(),o),offer);
 const waiting=waitForAnswer(code,{...o,interval:5});
 await sendAnswer(code,answer,o);
 assert.equal(await waiting,answer);
 assert.equal(storage.data.size,0,'collecting the answer deletes the room');
 await assert.rejects(readOffer(code,o),/No room/);
});
test('a room takes one answer; missing and expired rooms fail clearly',async()=>{
 const {env,fetchFn,base}=environment(),o={base,fetchFn};
 const code=await openRoom(offer,o);await sendAnswer(code,answer,o);
 await assert.rejects(sendAnswer(code,answer,o),/already joined/);
 await assert.rejects(sendAnswer('ZZZZZZ',answer,o),/expired/);
 await assert.rejects(readOffer('ZZZZZZ',o),/No room/);
 const other=await openRoom(offer,o);await env.rooms.get(other).alarm();
 await assert.rejects(waitForAnswer(other,{...o,interval:5}),/expired/);
 const third=await openRoom(offer,o);
 await assert.rejects(waitForAnswer(third,{...o,interval:5,timeout:20}),/expired/);
 const controller=new AbortController(),stopped=waitForAnswer(third,{...o,interval:5,signal:controller.signal});controller.abort();
 await assert.rejects(stopped,/Stopped/);
});
test('worker refuses other sites, bad codes and unknown routes; answers CORS preflight',async()=>{
 const {fetchFn,base}=environment();
 assert.equal((await fetchFn(base+'rooms',{method:'POST',body:offer},'https://evil.example')).status,403);
 assert.equal((await fetchFn(base+'rooms',{method:'POST',body:offer},null)).status,403);
 assert.equal((await fetchFn(base+'rooms',{method:'POST',body:offer},'http://127.0.0.1:8080')).status,201);
 assert.equal((await fetchFn(base+'rooms',{method:'POST',body:'not a code!'})).status,400);
 assert.equal((await fetchFn(base+'rooms',{method:'POST',body:'a'.repeat(48001)})).status,400);
 assert.equal((await fetchFn(base+'rooms/ABC234/offer',{method:'PUT',body:offer})).status,405);
 assert.equal((await fetchFn(base+'rooms/abc/offer')).status,404);
 assert.equal((await fetchFn(base+'other')).status,404);
 const pre=await fetchFn(base+'rooms',{method:'OPTIONS'});
 assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://hcussatt.github.io');
 await assert.rejects(openRoom(offer,{base,fetchFn:()=>Promise.reject(new TypeError('offline'))}),/Cannot reach/);
});
