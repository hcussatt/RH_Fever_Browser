// The browser host's side of the harness (tools/ctr-harness/web/). Natively these do nothing.
// Each vblank of the game's main thread hands the page the top screen and the audio mixed since the
// last one, then waits (the wasm stack is suspended, JSPI) until the page wants the next frame.
// The page answers with the buttons held (bit 0 = A).
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
static int16_t web_audio[16384*2];static uint32_t web_audio_n;
#define WEB_AUDIO(l,r) do{if(web_audio_n<16384){web_audio[2*web_audio_n]=(l);web_audio[2*web_audio_n+1]=(r);web_audio_n++;}}while(0)
EM_ASYNC_JS(int, host_vblank, (int rgb, int drawn, int audio, int samples), {return await Module.hostVblank(rgb, drawn, audio, samples);});
static int pica_top_rgb(uint8_t*rgb);static uint32_t pad_held;
static void WEB_VBLANK(void){static uint8_t rgb[400*240*3];int drawn=pica_top_rgb(rgb);
  pad_held=host_vblank((int)rgb,drawn,(int)web_audio,web_audio_n);web_audio_n=0;}
#else
#define WEB_AUDIO(l,r) ((void)0)
#define WEB_VBLANK() ((void)0)
#endif
