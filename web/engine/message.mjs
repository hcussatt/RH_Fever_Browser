// The chart's message panes: text boxes a chart shows, hides and fills (TickFlow 0x40 and 0x41,
// ExFlow 0x124, CTickFlow's lbl_803D5D38), and the layouts that give them their text boxes: the
// shared speech balloon (CBalloonLayout, message.brlyt), a game's own (Hole in One's
// CMyLayout, baseball.brlyt) and the scene's lyric lines (CLyricLayout, lyrics.brlyt). The platform backend reports them as message events (15, see
// adapters/wii/platform.c); this draws them with layout.mjs.
import {createLayout} from './layout.mjs';
import {assetResponse} from './assets.mjs';
const VISIBLE=0,TEXT=1,STRING=2,REGISTER=3,LAYOUT=4,CLEAR=5,TAIL=6,BOX_X=7,BOX_Y=8,BOX_W=9,BOX_H=10,TAIL_X=11,TAIL_Y=12,OVERLAY_Y=13,OVERLAY_H=14,FRAME=15,TAIL_FLIP=16,TEXT_Y=17;
const LAYOUTS={1:'balloon',2:'golf',3:'lyric'};
// Wide screen: the balloon's x is narrowed like CBalloonLayout::getScaledX.
const WIDE=608/832;
export async function createMessages(g){
 const file=await (await assetResponse(new URL('assets/message-layouts.json',g.base))).json();
 // Each layout's animations bind to the whole layout, in the order its setup creates them
 // (Hole in One's CMyLayout: frame change 00, then 01). The game plays them through FRAME events.
 const layouts={},events={};
 for(const [name,data] of Object.entries(file.layouts)){
  const spec={animations:Object.keys(data.animations??{}).sort().map(n=>[data.panes[0].name,n])};
  layouts[name]=await createLayout(g,{spec,data:{...data,font:data.font??file.font,messages:file.messages},fontFile:data.fontFile??'message-font.png',events:events[name]=[]});
 }
 const alive=new Set(),panes=new Map(); // pane index -> {layout, text, container}
 const pane=(layout,name)=>layout.panes[layout.byName[name]];
 // What a layout's setup (_10) does to its panes: CBalloonLayout::fn_800399E4 hides the balloon
 // and the overlay strip, puts both 100 up and sizes the balloon 400 by 160.
 function setup(name){
  // Every scene builds the lyric layout; only a game that registers its lines extracts it.
  const l=layouts[name];if(!l){if(name==='lyric')return;throw new Error(`No message layout ${name}`);}
  l.reset();alive.add(name);
  // CLyricLayout::_10 (fn_80090408) hides both lines, centres them vertically and puts the top
  // line at -136 and the bottom one at -174. Its song title card is the game layout's (layout.mjs).
  if(name==='lyric'){
   pane(l,'N_titleAll_00').visible=false;
   for(const [n,y] of [['T_lyrics_Top_00',-136],['T_lyrics_Down_00',-174]]){const p=pane(l,n);p.visible=false;p.textPosition=p.textPosition%3+3;p.translate[1]=y;}
   return;
  }
  if(name!=='balloon')return;
  for(const n of ['W_message_00','T_message_00','P_triangle_00','P_triangle_01','P_message_01','T_message_01'])pane(l,n).visible=false;
  for(const n of ['T_message_00','T_message_01']){const p=pane(l,n);p.textPosition-=p.textPosition%3;} // SetTextPositionH(LEFT)
  pane(l,'N_message_00').translate=[0,100];pane(l,'N_message_01').translate[1]=100;
  pane(l,'W_message_00').size=[400,160];pane(l,'T_message_00').size=[340,160];
 }
 // CTickFlow::fn_801DEF58: the text box (and the container shown with it) a pane uses.
 function register(index,target){
  if(!target){panes.delete(index);return;}
  const box=target===0x10||target===0x11?['balloon','T_message_00',target===0x10?'W_message_00':null]:target===0x12?['balloon','T_message_01','P_message_01']:
   target>=0x20&&target<0x24?['golf',`T_message_0${target-0x20}`,`N_message_0${target-0x20}`]:
   target===0x30||target===0x31?['lyric',target===0x30?'T_lyrics_Top_00':'T_lyrics_Down_00',null]:null;
  if(box?.[0]==='lyric'&&!layouts.lyric)throw new Error('Lyric line registered without the lyric layout (wii.messageLayout)');
  if(!box)throw new Error(`Unknown message pane text box ${target}`);
  panes.set(index,{layout:box[0],text:box[1],container:box[2]});
 }
 const f32=u=>new Float32Array(new Uint32Array([u]).buffer)[0];
 const text=id=>(file.messages[id]??'').replace(/\{[0-9a-f]*\}/g,'');
 function string(address){let s='';for(let a=address;g.u16(a);a+=2)s+=String.fromCharCode(g.u16(a));return s;}
 function apply({frame,field,pane:index,value}){
  if(field===LAYOUT)return setup(LAYOUTS[value]);
  if(field===CLEAR){alive.clear();panes.clear();return;}
  if(field===REGISTER)return register(index,value);
  if(field===FRAME){if(!alive.has('golf'))throw new Error('Screen frame animation without its layout');events.golf.push({frame,action:6<<8|value>>2,value:value&3});return;}
  const balloon=layouts.balloon,v=f32(value);
  // CBalloonLayout::fn_8003A1D0 and fn_8003A418 place the balloon and the overlay strip,
  // fn_80039F30 its tail.
  if(field===BOX_X)pane(balloon,'N_message_00').translate[0]=v*WIDE;
  else if(field===BOX_Y)pane(balloon,'N_message_00').translate[1]=-v;
  else if(field===BOX_W){pane(balloon,'W_message_00').size[0]=v;pane(balloon,'T_message_00').size[0]=v-60;}
  else if(field===BOX_H){pane(balloon,'W_message_00').size[1]=v;pane(balloon,'T_message_00').size[1]=v;}
  else if(field===TAIL){const p=pane(balloon,'P_triangle_00');p.visible=!!(value&1);p.scale=[1,value&2?-1:1];}
  else if(field===TAIL_X)pane(balloon,'P_triangle_00').translate[0]=v;
  else if(field===TAIL_Y)pane(balloon,'P_triangle_00').translate[1]=-v;
  else if(field===TAIL_FLIP)pane(balloon,'P_triangle_00').scale=[1,value?-1:1];
  else if(field===OVERLAY_Y)pane(balloon,'N_message_01').translate[1]=-v;
  else if(field===OVERLAY_H)pane(balloon,'P_message_01').size[1]=v;
  // CLyricLayout::fn_800907D0 and fn_80090854 move a registered line to y (and z 0).
  else if(field===TEXT_Y){const target=panes.get(index);if(target)pane(layouts[target.layout],target.text).translate[1]=v;}
  else{
   // A pane without a text box is left alone (the original would follow a stale pointer).
   const target=panes.get(index);if(!target||!alive.has(target.layout))return;
   const l=layouts[target.layout];
   if(field===VISIBLE){pane(l,target.text).visible=!!value;if(target.container)pane(l,target.container).visible=!!value;}
   else if(field===TEXT)pane(l,target.text).text=text(value);
   else if(field===STRING)pane(l,target.text).text=string(value);
  }
 }
 // Events up to the frame the game has run, then every layout the scene has built, in order.
 function draw(ctx,canvas){
  const events=g.messageEvents;
  while(events.length&&events[0].frame<g.steps)apply(events.shift());
  for(const name of alive)layouts[name].draw(ctx,canvas);
 }
 return {draw,layouts,panes};
}
