// Player input as data: each press or release of a button becomes {player, frame, at, button,
// down} in a queue and the simulation only ever reads the queue. Events are stamped with the
// frame of the backing track the player heard when they happened. Buttons: 1 A, 2 B.
export const A=1,B=2;
export function createInputQueue(player=0){
 const presses=[];
 return {
  presses,
  push(frame,button=A,down=true,at=performance.now()){presses.push({player,at,frame,button,down,done:false});},
  // Marks every event due by this frame as handled; the buttons pressed and let go, or null.
  take(frame){let trig=0,release=0;for(const i of presses)if(!i.done&&i.frame<=frame){if(i.down)trig|=i.button;else release|=i.button;i.done=true;i.processed=performance.now();i.delayMs=i.processed-i.at;}return trig||release?{trig,release}:null;},
 };
}

// A: Space, Left Shift, X, left click, gamepad A. B: Right Shift, right click, gamepad B.
// Escape pauses. Space or X also starts.
const KEYS={Space:A,KeyX:A,ShiftLeft:A,ShiftRight:B};
export function bindControls(canvas,{press,pause,start}){
 // Each event passes its own timestamp, so a busy page does not make an input late.
 window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&!e.repeat){e.preventDefault();pause();return;}
  const button=KEYS[e.code];if(!button)return;e.preventDefault();if(e.repeat)return;
  if(button===A&&e.code!=='ShiftLeft'&&start())return;
  press(button,true,e.timeStamp);
 });
 window.addEventListener('keyup',e=>{const button=KEYS[e.code];if(button){e.preventDefault();press(button,false,e.timeStamp);}});
 // Mouse: a second button pressed or let go while another is held raises no pointerdown or
 // pointerup (only pointermove), so the held buttons are compared on every pointer event.
 let mouseDown=0;
 const mouse=e=>{
  const down=(e.buttons&1?A:0)|(e.buttons&2?B:0);
  for(const button of [A,B])if((down^mouseDown)&button)press(button,!!(down&button),e.timeStamp);
  mouseDown=down;
 };
 canvas.addEventListener('pointerdown',e=>{if(e.button===0||e.button===2)e.preventDefault();mouse(e);});
 window.addEventListener('pointermove',e=>{if(mouseDown)mouse(e);});
 window.addEventListener('pointerup',mouse);window.addEventListener('pointercancel',mouse);
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 let lastPad=0;
 // Called once per animation frame; gamepads have no press events.
 return function pollGamepad(){
  const pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean);
  const down=(pad?.buttons[0]?.pressed?A:0)|(pad?.buttons[1]?.pressed?B:0);
  for(const button of [A,B])if((down^lastPad)&button)press(button,!!(down&button));
  lastPad=down;
 };
}
