// Player input as data: each press becomes {player, frame, at} in a queue and the
// simulation only ever reads the queue. Presses are stamped with the frame of the
// backing track the player heard when they pressed.
export function createInputQueue(player=0){
 const presses=[];
 return {
  presses,
  push(frame,at=performance.now()){presses.push({player,at,frame,done:false});},
  // Marks every press due by this frame as handled; true if there was one.
  take(frame){let pressed=false;for(const i of presses)if(!i.done&&i.frame<=frame){pressed=true;i.done=true;i.processed=performance.now();i.delayMs=i.processed-i.at;}return pressed;},
 };
}

// Space / X / click / gamepad A press; Escape pauses. Space or X also starts.
export function bindControls(canvas,{press,pause,start,release=()=>{}}){
 window.addEventListener('keydown',e=>{if(e.target.closest?.('input,textarea,dialog'))return;if(e.code==='Escape'&&!e.repeat){e.preventDefault();pause();return;}if(['Space','KeyX'].includes(e.code)){e.preventDefault();if(!e.repeat)start()||press();}});
 canvas.addEventListener('pointerdown',e=>{e.preventDefault();press();});
 window.addEventListener('keyup',e=>{if(e.target.closest?.('input,textarea,dialog'))return;if(['Space','KeyX'].includes(e.code)){e.preventDefault();release();}});
 window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
 let lastPad=false;
 // Called once per animation frame; gamepads have no press events.
 return function pollGamepad(){const pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean),down=!!pad?.buttons[0]?.pressed;if(down&&!lastPad)press();else if(!down&&lastPad)release();lastPad=down;};
}
