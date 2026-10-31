// hid:USER: the buttons. The game maps HID shared memory and reads the pad ring buffer there:
// +0x00 tick of the newest entry, +0x08 tick of the one before, +0x10 index of the newest entry,
// +0x28 eight entries of 0x10 bytes (held, newly pressed, newly released, circle pad x/y).
// The host sets pad_held (bit 0 = A); each vblank writes one new entry, as the HID module does.
static uint32_t hid_shm_handle,hid_shm,pad_held,pad_last;static uint64_t hid_tick;
static void hid_mapped(uint32_t h,uint32_t at){if(h&&h==hid_shm_handle)hid_shm=at;}
static int hid_ipc(uint32_t cmd,uint32_t*arg){
  if(cmd>>16!=0x0a)return 0; // GetIPCHandles: shared memory and five events
  if(!hid_shm_handle)hid_shm_handle=new_handle(H_SVC_OTHER,"hidmem");
  reply(cmd,7);wr32(0x1ff82088,0x14000000);wr32(0x1ff8208c,hid_shm_handle);
  for(int i=0;i<5;i++)wr32(0x1ff82090+4*i,new_handle(H_SVC_OTHER,"hidev"));return 1;}
static void hid_vblank(void){
  if(!hid_shm)return;
  // Native runs press A from the environment: PRESS=frame,frame,... holds it for 4 vblanks each.
  {static uint32_t presses[256];static int np=-1;if(np<0){np=0;char*e=getenv("PRESS");while(e&&*e&&np<256){presses[np++]=strtoul(e,&e,10);if(*e==',')e++;}}
   if(np){pad_held=0;for(int k=0;k<np;k++)if(vblanks>=presses[k]&&vblanks<presses[k]+4)pad_held|=1;}}
  uint32_t index=(rd32(hid_shm+0x10)+1)%8,e=hid_shm+0x28+index*0x10;
  wr32(e,pad_held);wr32(e+4,pad_held&~pad_last);wr32(e+8,pad_last&~pad_held);wr32(e+12,0);
  wr64(hid_shm+8,rd64(hid_shm));hid_tick+=4468724;wr64(hid_shm,hid_tick);wr32(hid_shm+0x10,index);wr32(hid_shm+0x1c,pad_held);
  pad_last=pad_held;}
