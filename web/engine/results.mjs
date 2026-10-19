// Original results and epilogue: disc layouts, font, artwork, CCheckPointManager
// comments and grade, and the live original TickFlow sequence. No JS thresholds.
import {createLayout} from './layout.mjs';
import {assetResponse,assetImage} from './assets.mjs';
export async function createResults(g,canvas){
 let steps=0,events=[],cursor=0,screen=0,ready=false,done=false,fade=0,fadeFrom=0,fadeTarget=0,fadeFrame=0,fadeDuration=0,result;
 let frame=0,resolved=0,sfx,origin,wave;
 let promptMode='hidden',promptFrame=0;
 const session={base:g.base,manifest:g.manifest,layoutEvents:[],get steps(){return steps;}};
 const [layout,epilogue,art]=await Promise.all([
  createLayout(session,{spec:{animations:[['RootPane','grading_loop_00']]},file:'results-layout.json',fontFile:'results-font.png'}),
  createLayout(session,{spec:{animations:[]},file:'epilogue-layout.json',fontFile:'results-font.png'}),
  assetResponse(new URL('assets/epilogue.json',g.base)).then(r=>r.json())]);
 const textures=await Promise.all(art.textures.map(n=>assetImage(new URL('assets/'+n,g.base))));
 const prompt=g.gradingData.prompt,promptTextures=await Promise.all(prompt.textures.map(n=>assetImage(new URL('assets/'+n,g.base))));
 const ctx=canvas.getContext('2d'),freeze=document.createElement('canvas');freeze.width=canvas.width;freeze.height=canvas.height;
 const p=name=>layout.panes[layout.byName[name]];
 const hidden=['W_Caption_00','T_Caption_00','T_Comment_00','T_Comment_01','T_Comment_02','T_Follow_00','N_HI_00','N_OK_00','N_NG_00','N_Medal_00','N_But_00','N_Follow_00'];
 function initialize(){
  hidden.forEach(n=>p(n).visible=false);
  p('T_Caption_00').text=result.caption;layout.fitText(p('T_Caption_00'),32,38);
  let min=100;
  for(let i=0;i<3;i++){const pane=p('T_Comment_0'+i);pane.text=result.comments[i]||'';if(pane.text)min=Math.min(min,layout.fitText(pane,25.6,30.4));}
  if(min<100)for(let i=0;i<3;i++)p('T_Comment_0'+i).fontSize=[min*25.6,30.4];
  const dy=p('T_Comment_01').translate[1]-p('T_Comment_00').translate[1];
  if(result.comments.length===1)p('T_Comment_00').translate[1]+=dy;
  else if(result.comments.length===2){p('T_Comment_00').translate[1]+=dy/2;p('T_Comment_01').translate[1]+=dy/2;}
  p('T_Follow_00').text=result.follow;
  const a=layout.animations[0];a.frame=0;a.playing=true;a.skip=true;a.enabled=true;
  const message=epilogue.panes[epilogue.byName.T_Message_00];message.text=g.gradingData.epilogueMessages[result.grade];epilogue.fitText(message,32,38);
 }
 const bits=new DataView(new ArrayBuffer(4)),float=u=>(bits.setUint32(0,u),bits.getFloat32(0));
 function schedule(list){
  let last=null;const sounds=[];
  for(const e of list){
   if(e.kind===10){if(last)last[['volume','pitch','pan'][e.value]]=float(e.extra);continue;}
   last=null;
   if(e.kind===1||e.kind===5){last={sound:e.value,seconds:e.seconds,tempo:120};sounds.push(last);}
   if(e.kind===21)wave=sfx.playWave(e.value,origin+e.seconds);
   if(e.kind===23)sfx.stopWave(wave,origin+e.seconds,e.value);
  }
  for(const s of sounds)sfx.play(s.sound,origin+s.seconds,s);
 }
 function step(){resolved++;return g.stepGrading();}
 // Only the input wait depends on the player. Resolve the original flow to
 // that wait so its sounds can be scheduled ahead on the audio thread.
 function resolve(){
  const list=[];
  for(let i=0;!(g.core._grading_state()&17);i++){
   if(i>=3600)throw new Error('Original result flow did not reach its input wait');
   list.push(...step());
  }
  events.push(...list);schedule(list);
 }
 function begin(audio,start){
  sfx=audio;origin=start;freeze.getContext('2d').drawImage(canvas,0,0);g.startGrading();
  events=g.resultEvents.map(e=>({kind:e[0],value:e[1],extra:e[2],frame:0,seconds:0}));
  resolve();result=g.result();initialize();return result;
 }
 function input(down){
  if(!ready||done)return;
  g.core._grading_input(down?1:0);
  for(const e of g.drain())if(e[0]===1)sfx.play(e[1]);
  if(down){promptMode='pressed';promptFrame=frame;}
  else {ready=false;resolve();}
 }
 function apply(e,at){
  if(e.kind===22){fadeFrom=fade;fadeTarget=e.value?0:1;fadeDuration=e.extra;fadeFrame=at;}
  if(e.kind===16){promptMode=e.value===0?'loop':'out';promptFrame=at+(e.value===0?Math.ceil(e.extra/1.6)+1:0);}
  if(e.kind!==20)return;
  if(e.value===9){screen=1;steps=0;}
  if(e.value===10)screen=2;
  if(e.value===11){done=true;ready=false;}
  if(e.value===0){p('W_Caption_00').visible=p('T_Caption_00').visible=true;}
  if(e.value===1)for(let i=0;i<3;i++)p('T_Comment_0'+i).visible=true;
  if(e.value===2){p(['N_HI_00','N_OK_00','N_NG_00'][result.grade]).visible=true;p('N_But_00').visible=result.but;}
  if(e.value===4)p('T_Follow_00').visible=p('N_Follow_00').visible=true;
  if(e.value===5)ready=true;
 }
 function drawBank(bank,textures,key,x=0,y=0){
  // CExScene's default 832x456 orthographic cell-animation canvas.
  const sx=canvas.width/832,sy=canvas.height/456;
  for(const o of bank.cells[key.cell]){
   ctx.setTransform(sx,0,0,sy,canvas.width/2,canvas.height/2);ctx.globalAlpha=key.alpha*o.alpha/65025;
   ctx.translate(x+key.x+o.x+o.w*o.scaleX/2,y+key.y+o.y+o.h*o.scaleY/2);ctx.rotate((key.angle+o.angle)*Math.PI/180);ctx.scale(o.scaleX*(o.flipX?-1:1),o.scaleY*(o.flipY?-1:1));
   ctx.drawImage(textures[bank.texture],o.sx,o.sy,o.w,o.h,-o.w/2,-o.h/2,o.w,o.h);
  }
 }
 function drawPrompt(){
  if(promptMode==='hidden'||frame-1<promptFrame)return;
  const keys=prompt.bank.animations[promptMode==='loop'?1:0],length=keys.reduce((n,k)=>n+k.frames,0);
  let at=promptMode==='pressed'?0:frame-1-promptFrame;if(promptMode==='loop')at%=length;else if(at>=length)return;
  for(const key of keys){if(at<key.frames){drawBank(prompt.bank,promptTextures,key,0,170);break;}at-=key.frames;}
 }
 function draw(seconds){
  const target=Math.floor(Math.max(0,seconds)*60);
  while(frame<=target){
   // Keep the original input-wait loop on the same frame as the displayed UI.
   if(frame>resolved&&!done)events.push(...step());
   while(cursor<events.length&&events[cursor].frame<=frame)apply(events[cursor++],frame);
   fade=fadeFrom+(fadeTarget-fadeFrom)*Math.min(1,fadeDuration?(frame-fadeFrame)/fadeDuration:1);
   if(screen){steps++;layout.update();}frame++;
  }
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(screen===1)layout.draw(ctx,canvas);else if(screen===2){drawBank(art.bank,textures,art.bank.animations[0][result.grade]);epilogue.draw(ctx,canvas);}else ctx.drawImage(freeze,0,0);
  if(screen)drawPrompt();
  if(fade>0){ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=fade;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalAlpha=1;}
 }
 return {begin,draw,input,layout,epilogue,get ready(){return ready;},get done(){return done;},get result(){return result;},get events(){return events;},get frame(){return frame;}};
}
