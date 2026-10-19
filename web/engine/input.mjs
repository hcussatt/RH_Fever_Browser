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
 window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&!e.repeat){e.preventDefault();pause();return;}
  const button=KEYS[e.code];if(!button)return;e.preventDefault();if(e.repeat)return;
  if(button===A&&e.code!=='ShiftLeft'&&start())return;
  press(button,true);
 });
 window.addEventListener('keyup',e=>{const button=KEYS[e.code];if(button){e.preventDefault();press(button,false);}});
 const mouse=e=>e.button===0?A:e.button===2?B:0;
 canvas.addEventListener('pointerdown',e=>{const button=mouse(e);if(button){e.preventDefault();press(button,true);}});
 window.addEventListener('pointerup',e=>{const button=mouse(e);if(button)press(button,false);});
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
