// The browser host's side of the harness (tools/ctr-harness/web/). Natively these do nothing.
// Each vblank of the game's main thread hands the page the top screen and the audio mixed since the
// last one, then waits (the wasm stack is suspended, JSPI) until the page wants the next frame.
// The page answers with the buttons held (bit 0 = A) and, above them in tenths of a millisecond,
// how long ago as heard the latest change of buttons happened (see input_age_ms in run.c).
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
static int16_t web_audio[16384*2];static uint32_t web_audio_n;
#define WEB_AUDIO(l,r) do{if(web_audio_n<16384){web_audio[2*web_audio_n]=(l);web_audio[2*web_audio_n+1]=(r);web_audio_n++;}}while(0)
EM_ASYNC_JS(int, host_vblank, (int rgb, int drawn, int audio, int samples, int cmd, int ncmd, int vtx, int tick), {return await Module.hostVblank(rgb, drawn, audio, samples, cmd, ncmd, vtx, tick);});
// With GL=1 the page draws from the GPU commands instead (picagl.c), and no picture is passed.
// The song clock in thousandths of a tick (the game's timing block, +0x110), for tests.
static int song_tick_milli(void){uint32_t F=rd32(0x54ef2c),t;float f;if(!F)return 0;t=rd32(F+0x110);memcpy(&f,&t,4);return f==f&&f>0&&f<2e6?(int)(f*1000):0;}
// How late the player hears the game (ms x 10): audio queued, speaker latency, the player's delay.
EM_JS(int, host_latency, (), {return Module.hostLatency();});
static void WEB_VBLANK(void){static uint8_t rgb[400*240*3];int drawn=pica_gl>0?0:pica_top_rgb(rgb);
  int r=host_vblank((int)rgb,drawn,(int)web_audio,web_audio_n,(int)gl_cmd,pica_gl>0?gl_ncmd:0,(int)gl_vtx,song_tick_milli());
  pad_held=r&255;input_age_ms=(r>>8)/10.0f;latency_ms=host_latency()/10.0f;if(pad_held!=pad_last)hid_vblank(); /* the next game frame reads the change */
  web_audio_n=0;if(pica_gl>0)gl_reset();}
EM_JS(void, WEB_JUDGE, (float ms, int kind), {Module.onJudge?.(ms, kind);});
#else
#define WEB_JUDGE(ms,kind) ((void)0)
#define WEB_AUDIO(l,r) ((void)0)
#define WEB_VBLANK() ((void)0)
#endif
