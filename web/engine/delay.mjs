// The player's audio delay: how much later than the browser reports the sound actually reaches
// them (wireless headphones often add more than the browser knows). The rhythm test (the
// calibrate game) measures it; every game then judges presses and draws frames that much later.
// It is kept in this browser only; 0 is the default.
const KEY='rhf-audio-delay-ms';
export const LIMIT_MS=[-200,600];
export function getDelayMs(){try{const v=Number(localStorage.getItem(KEY));return Number.isFinite(v)?v:0;}catch{return 0;}}
export function setDelayMs(ms){
 const v=Math.round(Math.min(LIMIT_MS[1],Math.max(LIMIT_MS[0],ms)));
 try{if(v)localStorage.setItem(KEY,String(v));else localStorage.removeItem(KEY);}catch{}
 return v;
}
export function resetDelay(){return setDelayMs(0);}
// The delay from the rhythm test's presses: each one's offset from its beat in seconds (late is
// positive). Their median is added to the delay the test ran with; fewer than 8 presses near the
// beats measure nothing (null).
export function measureDelay(offsets,currentMs){
 if(offsets.length<8)return null;
 const sorted=[...offsets].sort((a,b)=>a-b),mid=sorted.length>>1;
 const median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
 return currentMs+median*1000;
}
