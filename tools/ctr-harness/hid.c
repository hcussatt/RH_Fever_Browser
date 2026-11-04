// hid:USER: the buttons. The game maps HID shared memory and reads the pad ring buffer there:
// +0x00 tick of the newest entry, +0x08 tick of the one before, +0x10 index of the newest entry,
// +0x28 eight entries of 0x10 bytes (held, newly pressed, newly released, circle pad x/y).
// The host sets pad_held (bit 0 = A, bit 1 = B); each vblank writes one new entry, as the HID module does.
static uint32_t hid_shm_handle,hid_shm,pad_held,pad_last;static uint64_t hid_tick;
// A press the game has not read yet stays held until its next input poll (0x120698), as a press on
// the console always spans a poll: the game reads only the newest state, so a tap that starts and
// ends between two polls (one game frame, ~17 ms) would be lost. press_heard is when the player
// heard the press, in output samples, so the press keeps its own age if the release comes first.
static uint32_t pad_unread;static uint64_t dsp_samples;static double press_heard;
static void hid_mapped(uint32_t h,uint32_t at){if(h&&h==hid_shm_handle)hid_shm=at;}
static int hid_ipc(uint32_t cmd,uint32_t*arg){
  if(cmd>>16!=0x0a)return 0; // GetIPCHandles: shared memory and five events
  if(!hid_shm_handle)hid_shm_handle=new_handle(H_SVC_OTHER,"hidmem");
  reply(cmd,7);wr32(0x1ff82088,0x14000000);wr32(0x1ff8208c,hid_shm_handle);
  for(int i=0;i<5;i++)wr32(0x1ff82090+4*i,new_handle(H_SVC_OTHER,"hidev"));return 1;}
static void hid_vblank(void){
  if(!hid_shm)return;
  // Native runs press A from the environment: PRESS=frame,frame,... holds it for 4 vblanks each.
  // PRESS=frame:len holds it len vblanks instead; PRESS=frame:len:mask holds those buttons (hex, 1 = A, 2 = B).
  {static uint32_t presses[4096],lens[4096],masks[4096];static int np=-1;if(np<0){np=0;char*e=getenv("PRESS");while(e&&*e&&np<4096){lens[np]=4;masks[np]=1;presses[np]=strtoul(e,&e,10);if(*e==':')lens[np]=strtoul(e+1,&e,10);if(*e==':')masks[np]=strtoul(e+1,&e,16);np++;if(*e==',')e++;}}
   if(np){pad_held=0;for(int k=0;k<np;k++)if(vblanks>=presses[k]&&vblanks<presses[k]+lens[k])pad_held|=masks[k];}}
  uint32_t index=(rd32(hid_shm+0x10)+1)%8,e=hid_shm+0x28+index*0x10;
  wr32(e,pad_held);wr32(e+4,pad_held&~pad_last);wr32(e+8,pad_last&~pad_held);wr32(e+12,0);
  wr64(hid_shm+8,rd64(hid_shm));hid_tick+=4468724;wr64(hid_shm,hid_tick);wr32(hid_shm+0x10,index);wr32(hid_shm+0x1c,pad_held);
  pad_last=pad_held;}
