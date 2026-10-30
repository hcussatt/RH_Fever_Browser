#include "pica.c"
#include <time.h>
static clock_t pica_clock,xfer_clock,fill_clock;
// gsp::Gpu: the GPU service. The game's GPU work is not drawn here (the renderer draws from the game's
// own state), but its timing is kept: every GX command the game queues completes at once and raises the
// interrupt real hardware would, and vblanks arrive 60 times a second.
// Shared memory (per registered thread t): interrupt queue at t*0x40, GX command queue at 0x800+t*0x200.
static uint32_t gsp_event, gsp_shm_handle, gsp_shm;static int gsp_log=-1;
static void gsp_mapped(uint32_t h,uint32_t at){if(h&&h==gsp_shm_handle)gsp_shm=at;}
static void gsp_interrupt(int id){ // push one interrupt into thread 0's queue and signal its event
  if(!gsp_shm||!gsp_event)return;
  uint32_t q=gsp_shm;uint8_t first=rd8(q),count=rd8(q+1);
  if(count>=0x34){wr8(q+2,1);return;}
  wr8(q+0xc+(first+count)%0x34,id);wr8(q+1,count+1);wr8(q+3,0);
  if(nsig_handle<64)signaled_handle[nsig_handle++]=gsp_event;}
static void gsp_commands(void){ // TriggerCmdReqQueue: run the queued GX commands
  uint32_t q=gsp_shm+0x800;
  for(int guard=0;guard<15&&rd8(q+1);guard++){
    uint8_t index=rd8(q),count=rd8(q+1);uint32_t c=q+0x20+index*0x20;uint8_t id=rd8(c);
    if(gsp_log>0)fprintf(stderr,"gx command %d\n",id);
    switch(id){
    case 1:{clock_t t0=clock();pica_list(rd32(c+4),rd32(c+8));pica_clock+=clock()-t0;}gsp_interrupt(5);break; // process command list -> P3D
    case 2:{clock_t t0=clock();gx_fill(rd32(c+4),rd32(c+8),rd32(c+12),rd32(c+28)&0xffff);fill_clock+=clock()-t0;}if(0)gx_fill(rd32(c+4),rd32(c+8),rd32(c+12),rd32(c+28)&0xffff);gx_fill(rd32(c+16),rd32(c+20),rd32(c+24),rd32(c+28)>>16);
      gsp_interrupt(0);if(rd32(c+16))gsp_interrupt(1);break; // memory fill -> PSC0 (and PSC1 for a second buffer)
    case 3:{clock_t t0=clock();gx_transfer(rd32(c+4),rd32(c+8),rd32(c+12),rd32(c+16),rd32(c+20));xfer_clock+=clock()-t0;}if(0)gx_transfer(rd32(c+4),rd32(c+8),rd32(c+12),rd32(c+16),rd32(c+20));gsp_interrupt(4);break; // display transfer -> PPF
    case 4: gx_texcopy(rd32(c+4),rd32(c+8),rd32(c+12),rd32(c+16),rd32(c+20));gsp_interrupt(4);break; // texture copy -> PPF
    case 0: gx_dma(rd32(c+4),rd32(c+8),rd32(c+12));gsp_interrupt(6);break; // DMA
    default: break;}
    wr8(q,(index+1)%15);wr8(q+1,count-1);}}
static int gsp_ipc(uint32_t cmd,uint32_t*arg){
  uint32_t id=cmd>>16;if(gsp_log<0)gsp_log=!!getenv("GSPLOG");
  if(id==0x13){gsp_event=arg[2];if(!gsp_shm_handle)gsp_shm_handle=new_handle(H_SVC_OTHER,"gspmem");
    reply(cmd,4);wr32(0x1ff82084,0x2a07);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);wr32(0x1ff82090,gsp_shm_handle);return 1;}
  if(id==0x0c){gsp_commands();reply(cmd,1);return 1;}
  return 0;}
static void gsp_vblank(void){gsp_interrupt(2);gsp_interrupt(3);}
