// Room-code matchmaker for the multiplayer lobby (docs/multiplayer.md). It only passes the two
// browsers' connection codes to each other: one invite and one answer per room, deleted once the
// host collects the answer or after ten minutes. Gameplay never goes through it.
export const ROOM_ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789',ROOM_LENGTH=6,ROOM_TTL=10*60*1000,MAX_SIGNAL=48000;
const ROOM=new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_LENGTH}}$`),SIGNAL=/^[A-Za-z0-9_-]+$/;
const LOCAL=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export function newRoomCode(random=crypto.getRandomValues(new Uint8Array(ROOM_LENGTH))){
 // 248 = 8 x 31: dropping larger bytes keeps every letter equally likely.
 let code='';for(const b of random)if(b<248)code+=ROOM_ALPHABET[b%ROOM_ALPHABET.length];
 return code.length===ROOM_LENGTH?code:newRoomCode();
}
// One Durable Object per room code.
export class Room {
 constructor(state){this.storage=state.storage;}
 async fetch(request){
  const part=new URL(request.url).pathname.split('/').pop(),s=this.storage;
  if(request.method==='PUT'&&part==='offer'){
   if(await s.get('offer'))return new Response(null,{status:409});
   await s.put('offer',await request.text());await s.setAlarm(Date.now()+ROOM_TTL);return new Response(null,{status:201});
  }
  if(request.method==='GET'&&part==='offer'){const offer=await s.get('offer');return offer?new Response(offer):new Response(null,{status:404});}
  if(request.method==='PUT'&&part==='answer'){
   if(!await s.get('offer'))return new Response(null,{status:404});
   if(await s.get('answer'))return new Response(null,{status:409});
   await s.put('answer',await request.text());return new Response(null,{status:201});
  }
  if(request.method==='GET'&&part==='answer'){
   const answer=await s.get('answer');if(!answer)return new Response(null,{status:await s.get('offer')?204:404});
   await s.deleteAll();await s.deleteAlarm();return new Response(answer);
  }
  return new Response(null,{status:405});
 }
 async alarm(){await this.storage.deleteAll();}
}
function allowed(origin,env){return !!origin&&(LOCAL.test(origin)||(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).includes(origin));}
export default {
 async fetch(request,env){
  const origin=request.headers.get('origin');
  if(!allowed(origin,env))return new Response('Forbidden',{status:403});
  const cors={'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, PUT','access-control-allow-headers':'content-type','access-control-max-age':'86400',vary:'origin','cache-control':'no-store'};
  const reply=(body,status=200)=>new Response(body,{status,headers:cors});
  if(request.method==='OPTIONS')return reply(null,204);
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);
  if(parts[0]!=='rooms'||parts.length>3)return reply('Not found',404);
  let body=null;
  if(request.method==='POST'||request.method==='PUT'){
   body=await request.text();
   if(body.length>MAX_SIGNAL||!SIGNAL.test(body))return reply('Invalid connection code',400);
  }
  const room=code=>env.ROOMS.get(env.ROOMS.idFromName(code));
  if(request.method==='POST'&&parts.length===1){
   // A clash with a live room is rare (31^6 codes); try a few fresh codes.
   for(let i=0;i<5;i++){
    const code=newRoomCode(),r=await room(code).fetch(`https://room/${code}/offer`,{method:'PUT',body});
    if(r.status===201)return reply(JSON.stringify({code}),201);
   }
   return reply('Try again',503);
  }
  if(parts.length!==3||!ROOM.test(parts[1])||!['offer','answer'].includes(parts[2]))return reply('Not found',404);
  if(!['GET','PUT'].includes(request.method)||(request.method==='PUT'&&parts[2]!=='answer'))return reply(null,405);
  const r=await room(parts[1]).fetch(`https://room/${parts[1]}/${parts[2]}`,{method:request.method,body});
  return reply(r.status===200?await r.text():null,r.status);
 }
};
