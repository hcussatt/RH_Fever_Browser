#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <stdint.h>
// Probe harness: flat 3DS memory regions, heap, and a trace of what the translated code calls.
static uint32_t stack_[4096];static int sp_;
static void dump(void){for(int i=0;i<sp_;i++)fprintf(stderr," %x",stack_[i]);fprintf(stderr,"\n");}
static uint8_t *code; // 0x100000..0x700000
static uint8_t *heapm; // 0x08000000..+64MB
static uint8_t *stackm; // 0x0ff00000..0x10000000
static uint8_t *dspm;static uint8_t *tlsm;static uint8_t *shm,*linm,*vram; // shared memory blocks 0x10000000..+1MB
   // 0x1ff82000..+0x1000
static uint8_t *p(uint32_t a,uint32_t n){
  if(a>=0x100000&&a+n<=0x700000)return code+a-0x100000;
  if(a>=0x08000000&&a+n<=0x0c000000)return heapm+a-0x08000000;
  if(a>=0x0fc00000&&a+n<=0x10000000)return stackm+a-0x0fc00000;
  if(a>=0x10000000&&a+n<=0x10100000)return shm+a-0x10000000;
  if(a>=0x14000000&&a+n<=0x17000000)return linm+a-0x14000000;
  if(a>=0x1f000000&&a+n<=0x1f600000)return vram+a-0x1f000000;
  if(a>=0x1ff00000&&a+n<=0x1ff80000)return dspm+a-0x1ff00000;
  if(a>=0x1ff80000&&a+n<=0x1ff83000)return tlsm+a-0x1ff80000;
  fprintf(stderr,"bad access %08x, stack:",a);dump();exit(2);}
__attribute__((noinline)) void watch_here(void*h){__asm__ volatile("");}
uint32_t rd32(uint32_t a){uint32_t v;memcpy(&v,p(a,4),4);return v;}
uint64_t rd64(uint32_t a){uint64_t v;memcpy(&v,p(a,8),8);return v;}
uint32_t rd16(uint32_t a){uint16_t v;memcpy(&v,p(a,2),2);return v;}
uint32_t rd8(uint32_t a){return *p(a,1);}
void wr32(uint32_t a,uint32_t v){memcpy(p(a,4),&v,4);}
void wr64(uint32_t a,uint64_t v){memcpy(p(a,8),&v,8);}
void wr16(uint32_t a,uint32_t v){uint16_t x=v;memcpy(p(a,2),&x,2);}
void wr8(uint32_t a,uint32_t v){*p(a,1)=v;}
static uint32_t lastcall;
void panic(uint32_t a,int c){fprintf(stderr,"panic %x %d, stack:",a,c);dump();exit(1);}
void svc(uint32_t n,uint32_t a);
uint32_t tls(void){return 0x1ff82000;}
void call(uint32_t a);
static uint32_t count_hits[16],count_addr[16];static uint8_t cover[0x14d000];
extern uint32_t *R;int dispatch(uint32_t);
#define r R
#define dispatch_original dispatch
static uint32_t heap_top=0x0a000000,linear_top; // probe-only allocations above the game heap
uint32_t main_calls;static int depth;static uint32_t vblanks;
// Threads run cooperatively on the main thread, one step at each main-thread sleep or wait. A thread
// that would block jumps back here; next time the innermost function it was in is called again with
// the same registers (waits re-check their condition), then each caller carries on after its call
// (resume_original) until the thread's entry function returns.
#define THREAD_END 0xfffffff0u
static struct{uint32_t run,obj,stack,state,resume_pc,regs[16];union{float s[32];}v;uint32_t why,addr,value,handle;}workers[32];
enum{W_NEXT=1,W_ADDRESS,W_HANDLE};static uint32_t signaled_addr[64],signaled_handle[64];static int nsig_addr,nsig_handle;static int worker_count,in_worker,cur_worker;static jmp_buf worker_exit;
static uint32_t frames[2048][16];static int frame_count;   // registers at each call inside the running thread
extern uint32_t *R;extern float *VFP;int resume(uint32_t);
static int dsp_is_event(uint32_t);static void dsp_frame(void);
static uint32_t wakes[32];
static int run_workers(void){int woke=0,seen_addr=nsig_addr,seen_handle=nsig_handle;
  for(int i=0;i<worker_count;i++){
    if(workers[i].state==2)continue;
    uint32_t saved[16];memcpy(saved,r,64);float savedv[32];memcpy(savedv,VFP,128);int saved_sp=sp_,saved_depth=depth;
    cur_worker=i;frame_count=0;
    if(!setjmp(worker_exit)){
      in_worker=1;
      if(workers[i].state==0){workers[i].state=1;r[0]=workers[i].obj;r[13]=workers[i].stack;r[14]=THREAD_END;call(workers[i].run);}
      else{ // woken: the wait returns
        int wake=workers[i].why==W_NEXT;
        if(workers[i].why==W_ADDRESS){if((int32_t)rd32(workers[i].addr)>=(int32_t)workers[i].value)wake=1;for(int k=0;k<nsig_addr;k++)if(signaled_addr[k]==workers[i].addr)wake=1;}
        int spurious=0;if(workers[i].why==W_HANDLE&&getenv("HWAKE")&&!dsp_is_event(workers[i].handle))wake=spurious=1;if(workers[i].why==W_HANDLE)for(int k=0;k<nsig_handle;k++)if(signaled_handle[k]==workers[i].handle)wake=1,spurious=0;
        if(!wake){in_worker=0;memcpy(r,saved,64);memcpy(VFP,savedv,128);continue;}
        if(!spurious&&workers[i].why!=W_NEXT)woke++;if(!spurious){wakes[i]++;if(getenv("WAKELOG")&&workers[i].why!=W_NEXT&&i!=4&&i!=9)fprintf(stderr,"wake %d (%x) at %x frame %u\n",i,workers[i].run,workers[i].resume_pc,vblanks);}memcpy(r,workers[i].regs,64);memcpy(VFP,workers[i].v.s,128);r[0]=0;r[15]=workers[i].resume_pc;}
      uint32_t pc=r[15];
      while(pc!=THREAD_END){if(!resume(pc)){fprintf(stderr,"thread %d cannot carry on at %x\n",i,pc);exit(8);}pc=r[15];}
      workers[i].state=2;fprintf(stderr,"thread %d (%x) ended\n",i,workers[i].run);
    }
    in_worker=0;sp_=saved_sp;depth=saved_depth;memcpy(r,saved,64);memcpy(VFP,savedv,128);}
  // signals raised before this round were seen by every thread; ones raised during it wait for the next
  memmove(signaled_addr,signaled_addr+seen_addr,(nsig_addr-seen_addr)*4);nsig_addr-=seen_addr;
  memmove(signaled_handle,signaled_handle+seen_handle,(nsig_handle-seen_handle)*4);nsig_handle-=seen_handle;return woke;}
static uint32_t svc_at; // the system call being made (bit 0: Thumb)
// The running thread waits: keep its registers as they are at the system call and carry on right after it later.
static void block_on(uint32_t why,uint32_t a,uint32_t v){workers[cur_worker].why=why;workers[cur_worker].addr=a;workers[cur_worker].value=v;workers[cur_worker].handle=a;
  workers[cur_worker].resume_pc=svc_at&1?((svc_at&~1u)+2)|1:svc_at+4;
  if(getenv("TLOG"))fprintf(stderr,"thread %d blocks at %x\n",cur_worker,svc_at);
  memcpy(workers[cur_worker].regs,r,64);memcpy(workers[cur_worker].v.s,VFP,128);longjmp(worker_exit,1);}
static uint32_t jobs[64];static int job_count;
static void run_jobs(void){while(job_count){uint32_t slot=jobs[0];memmove(jobs,jobs+1,--job_count*4);uint32_t saved[16];memcpy(saved,r,64);r[0]=slot;call(0x120b00);memcpy(r,saved,64);}}
static uint32_t next_handle=0x100,svc_count[256];

// Services: handles name what they talk to. 1 srv:, then one per service or open file.
enum{H_SRV=1,H_FS,H_SVC_OTHER,H_FILE_ROM,H_FILE_OTHER};
static uint32_t handle_kind[4096];static char handle_name[4096][9];
static uint32_t new_handle(uint32_t kind,const char*name){uint32_t h=next_handle++;handle_kind[h&4095]=kind;if(name)snprintf(handle_name[h&4095],9,"%s",name);return h;}
static void reply(uint32_t cmd,int words){wr32(0x1ff82080,(cmd&0xffff0000)|(words+1)<<6);wr32(0x1ff82084,0);}
// The RomFS as the program reads it (level 3): the header and tables from romfs-meta.bin, file
// data from the files extract-3ds.py wrote under build/ctr/romfs/ (romfs-index.txt: offset size path).
static uint8_t*romfs_meta;static long romfs_meta_size,romfs_size;
static struct{uint64_t at,size;char path[96];int warned;}rfiles[1200];static int rfile_count;
static void rom_open(void){
  FILE*f=fopen("build/ctr/romfs-meta.bin","rb");
  if(f){fseek(f,0,2);romfs_meta_size=ftell(f);fseek(f,0,0);romfs_meta=malloc(romfs_meta_size);fread(romfs_meta,1,romfs_meta_size,f);fclose(f);}
  f=fopen("build/ctr/romfs-index.txt","r");
  if(f){unsigned long long at,size;char path[96];while(rfile_count<1200&&fscanf(f,"%llx %llx %95[^\n]",&at,&size,path)==3){rfiles[rfile_count].at=at;rfiles[rfile_count].size=size;strcpy(rfiles[rfile_count].path,path);rfile_count++;if(at+size>romfs_size)romfs_size=at+size;}fclose(f);}
  if(!romfs_meta)fprintf(stderr,"no romfs-meta.bin\n");}
static void rom_read(uint64_t off,uint32_t size,uint32_t ptr){
  if(!romfs_meta&&!rfile_count)rom_open();
  if(getenv("ROMLOG"))fprintf(stderr,"romfs read %llx size %x\n",(unsigned long long)off,size);
  uint8_t*d=size?p(ptr,size):0;if(size)memset(d,0,size);
  while(size){
    if(off<romfs_meta_size){uint32_t n=romfs_meta_size-off<size?romfs_meta_size-off:size;memcpy(d,romfs_meta+off,n);off+=n;d+=n;size-=n;continue;}
    int i;for(i=0;i<rfile_count;i++)if(off>=rfiles[i].at&&off<rfiles[i].at+rfiles[i].size)break;
    if(i==rfile_count){fprintf(stderr,"romfs read outside any file: %llx\n",(unsigned long long)off);return;}
    uint32_t n=rfiles[i].at+rfiles[i].size-off<size?rfiles[i].at+rfiles[i].size-off:size;
    char path[160];snprintf(path,160,"build/ctr/romfs/%s",rfiles[i].path);if(getenv("ROMLOG"))fprintf(stderr,"  file %s +%llx frame %u\n",rfiles[i].path,(unsigned long long)(off-rfiles[i].at),vblanks);
    FILE*f=fopen(path,"rb");
    if(f){fseek(f,off-rfiles[i].at,0);fread(d,1,n,f);fclose(f);}
    else if(!rfiles[i].warned++)fprintf(stderr,"romfs file not extracted: %s\n",rfiles[i].path);
    off+=n;d+=n;size-=n;}}

// Save data: an in-memory archive, empty at boot (a fresh save), kept for the run.
static struct{char name[64];uint8_t*data;uint32_t size;}saves[32];static int save_count;
static uint32_t file_of[4096]; // file handle -> save index + 1
static void path_of(uint32_t type,uint32_t size,uint32_t ptr,char*out){int n=0;
  if(type==4){for(uint32_t i=0;i+1<size&&n<63;i+=2){uint32_t c=rd16(ptr+i);if(!c)break;out[n++]=c<128?c:'?';}}
  else if(type==3){for(uint32_t i=0;i<size&&n<63;i++){uint32_t c=rd8(ptr+i);if(!c)break;out[n++]=c;}}
  else n=snprintf(out,64,"binary%u",size);out[n]=0;}
static int find_save(const char*name){for(int i=0;i<save_count;i++)if(!strcmp(saves[i].name,name))return i;return -1;}
#include "gsp.c"
#include "dsp.c"
static void ipc(uint32_t h){
  uint32_t cmd=rd32(0x1ff82080),id=cmd>>16,*a=0,kind=handle_kind[h&4095];
  uint32_t arg[16];for(int i=0;i<16;i++)arg[i]=rd32(0x1ff82084+4*i);
  if(getenv("IPC"))fprintf(stderr,"ipc %s(%x) cmd %08x args %x %x %x %x %x %x\n",kind==H_SRV?"srv":handle_name[h&4095],h,cmd,arg[0],arg[1],arg[2],arg[3],arg[4],arg[5]);
  if(kind==H_SRV&&id==5){char n[9]={0};memcpy(n,p(0x1ff82084,8),8);uint32_t k=!strcmp(n,"fs:USER")?H_FS:H_SVC_OTHER;if(getenv("SRVSTACK")&&strstr(n,getenv("SRVSTACK"))){fprintf(stderr,"get %s stack:",n);dump();}reply(cmd,2);wr32(0x1ff8208c,new_handle(k,n));return;}
  if(!strcmp(handle_name[h&4095],"dsp::DSP")){dsp_ipc(cmd,arg);return;}
  if(!strcmp(handle_name[h&4095],"gsp::Gpu")&&getenv("GSP")&&gsp_ipc(cmd,arg))return;
  if(!strncmp(handle_name[h&4095],"APT:",4)){
    if(id==0x0d||id==0x0e){reply(cmd,4);wr32(0x1ff82088,0x101);wr32(0x1ff8208c,1);wr32(0x1ff82090,0);return;} // Receive/GlanceParameter: Wakeup from the home menu
    if(id==0x01){reply(cmd,4);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);wr32(0x1ff82094,new_handle(H_SVC_OTHER,"aptlock"));return;}
    if(id==0x02){reply(cmd,4);wr32(0x1ff8208c,new_handle(H_SVC_OTHER,"aptev"));wr32(0x1ff82090,new_handle(H_SVC_OTHER,"aptev"));return;}
    reply(cmd,3);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);return;}
  if(!strcmp(handle_name[h&4095],"cfg:u")){
    if(id==0x02){reply(cmd,2);wr32(0x1ff82088,1);return;} // GetRegion: USA
    if(id==0x01){uint32_t size=arg[0],blk=arg[1],ptr=arg[3];if(size<=64)memset(p(ptr,size),0,size);
      if(blk==0xa0002)wr8(ptr,1);           // language: English
      if(blk==0x70001)wr8(ptr,1);           // sound output: stereo
      if(blk==0xb0000&&size>=4)wr8(ptr+3,49); // country: United States
      reply(cmd,1);return;}
    reply(cmd,3);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);return;}
  if(kind==H_FS){
    if(id==0x80c){reply(cmd,3);wr32(0x1ff82088,0x1000+arg[0]);wr32(0x1ff8208c,0);return;} // OpenArchive: the handle is the archive id
    if(id==0x803){uint32_t archive=arg[1];reply(cmd,3);wr32(0x1ff8208c,new_handle(archive==3?H_FILE_ROM:H_FILE_OTHER,archive==3?"romfs":"file"));return;}
    if(id==0x802){char n[64];path_of(arg[3],arg[4],arg[8],n);int i=find_save(n);
      if(i<0&&(arg[5]&4)){i=save_count++;strcpy(saves[i].name,n);saves[i].data=0;saves[i].size=0;}
      if(getenv("IPC"))fprintf(stderr,"  open save file %s -> %d\n",n,i);
      if(i<0){reply(cmd,1);wr32(0x1ff82084,0xc8804478);return;} // not found
      uint32_t fh=new_handle(H_FILE_OTHER,"save");file_of[fh&4095]=i+1;reply(cmd,3);wr32(0x1ff8208c,fh);return;}
    if(id==0x808){char n[64];path_of(arg[3],arg[4],arg[9],n);int i=find_save(n);
      if(i<0){i=save_count++;strcpy(saves[i].name,n);}uint32_t size=arg[6];saves[i].data=realloc(saves[i].data,size?size:1);memset(saves[i].data,0,size);saves[i].size=size;
      if(getenv("IPC"))fprintf(stderr,"  create save file %s size %x\n",n,size);reply(cmd,1);return;}
    if(id==0x804){char n[64];path_of(arg[3],arg[4],arg[6],n);int i=find_save(n);if(i>=0)saves[i].name[0]=0;reply(cmd,1);return;} // DeleteFile
    if(id==0x817){reply(cmd,2);wr32(0x1ff82088,0);return;} // IsSdmcDetected: no
    reply(cmd,3);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);return;}
  if(kind==H_FILE_ROM){
    if(id==0x802){uint64_t off=arg[0]|(uint64_t)arg[1]<<32;rom_read(off,arg[2],arg[4]);reply(cmd,2);wr32(0x1ff82088,arg[2]);return;}
    if(id==0x804){if(!romfs_meta&&!rfile_count)rom_open();reply(cmd,3);wr32(0x1ff82088,(uint32_t)romfs_size);wr32(0x1ff8208c,0);return;}
    reply(cmd,1);return;}
  if(file_of[h&4095]){int i=file_of[h&4095]-1;
    if(id==0x802){uint32_t off=arg[0],size=arg[2];uint32_t n=off<saves[i].size?(saves[i].size-off<size?saves[i].size-off:size):0;if(n)memcpy(p(arg[4],n),saves[i].data+off,n);reply(cmd,2);wr32(0x1ff82088,n);return;}
    if(id==0x803){uint32_t off=arg[0],size=arg[2];if(off+size>saves[i].size){saves[i].data=realloc(saves[i].data,off+size);memset(saves[i].data+saves[i].size,0,off+size-saves[i].size);saves[i].size=off+size;}if(size)memcpy(saves[i].data+off,p(arg[5],size),size);reply(cmd,2);wr32(0x1ff82088,size);return;}
    if(id==0x804){reply(cmd,3);wr32(0x1ff82088,saves[i].size);wr32(0x1ff8208c,0);return;}
    if(id==0x805){uint32_t size=arg[0];saves[i].data=realloc(saves[i].data,size?size:1);if(size>saves[i].size)memset(saves[i].data+saves[i].size,0,size-saves[i].size);saves[i].size=size;reply(cmd,1);return;}
    reply(cmd,1);return;}
  reply(cmd,3);wr32(0x1ff82088,0);wr32(0x1ff8208c,0);}
void svc(uint32_t n,uint32_t a){
  svc_at=a;
  svc_count[n&255]++;
  if(getenv("SVC"))fprintf(stderr,"svc %x at %x\n",n,a);
  switch(n){
  case 0x1f: if(getenv("SVC"))fprintf(stderr,"MapMemoryBlock handle %x at %x\n",r[0],r[1]);gsp_mapped(r[0],r[1]);r[0]=0;return;
  case 0x22: if(r[2]==0){if(nsig_addr<64)signaled_addr[nsig_addr++]=r[1];r[0]=0;return;} // ArbitrateAddress signal
    if(in_worker)block_on(W_ADDRESS,r[1],r[3]);r[0]=0;return; // a waiting thread blocks
  case 0x18: if(nsig_handle<64)signaled_handle[nsig_handle++]=r[0];r[0]=0;return; // SignalEvent
  case 0x24: if(in_worker)block_on((int32_t)r[3]>=0?W_NEXT:W_HANDLE,r[0],0);r[0]=0;return;
  case 0x25: if(in_worker)block_on(W_NEXT,0,0);r[0]=0;return; // waits: a worker blocks; the main thread never does
  case 0x0a: if(in_worker)block_on(W_NEXT,0,0);run_jobs();run_workers();r[0]=0;return; // SleepThread: other threads get their turn
  case 0x01: {uint32_t op=r[0]&0xff,size=r[3]; // ControlMemory: heap at 0x08000000, linear heap at 0x14000000
    if(op==3){if(r[0]&0x10000){r[1]=0x14000000+linear_top;linear_top+=size;}else{r[1]=r[1]?r[1]:0x08000000;}r[0]=0;fprintf(stderr,"ControlMemory op=%x at %x size %x\n",r[0],r[1],size);return;}
    r[0]=0;return;}
  case 0x08: fprintf(stderr,"CreateThread entry %x arg %x stacktop %x prio %x core %x, stack:",r[1],r[2],r[3],r[0],r[4]);dump();r[1]=next_handle++;r[0]=0;return;
  case 0x13: case 0x17: case 0x1a: case 0x21: r[1]=next_handle++;r[0]=0;return;
  case 0x2d: r[1]=new_handle(H_SRV,"srv:");r[0]=0;return; // create mutex/event/timer/arbiter, connect port, create thread
  case 0x32: {ipc(r[0]);r[0]=0;return;} // SendSyncRequest
  case 0x14: case 0x19: case 0x23: case 0x0b: case 0x0c: case 0x28: case 0x29: case 0x35: case 0x3c: r[0]=0;return;
  }
  if(svc_count[n&255]==1){fprintf(stderr,"unmodelled svc %x at %x, stack:",n,a);dump();}
  r[0]=0;r[1]=0;r[2]=0;}
static uint32_t prof[0x300000];static int prof_on;
void call(uint32_t a){
  {static uint32_t ca[16];static int cn=-1;if(cn<0){cn=0;char*e=getenv("COUNT");while(e&&*e&&cn<16){ca[cn++]=strtoul(e,&e,16);if(*e==',')e++;}}
   for(int k=0;k<cn;k++)if(a==ca[k]){count_hits[k]++;count_addr[k]=a;if(getenv("COUNTLOG")){fprintf(stderr,"hit %x worker %d frame %u r0 %x r1 %x lr %x\n",a,in_worker?cur_worker:-1,vblanks,r[0],r[1],r[14]);}}}
  if(a>=0x100000&&a<0x39a000)cover[(a-0x100000)>>1]=1;
  lastcall=a;if(!in_worker)main_calls++;if(prof_on&&a>=0x100000&&a<0x700000)prof[(a-0x100000)>>1]++;
  {static uint32_t qw=1;if(qw==1)qw=getenv("R0WATCH")?strtoul(getenv("R0WATCH"),0,16):0;if(qw&&r[0]==qw){fprintf(stderr,"r0=%x at call %x, stack:",qw,a);dump();}}
  if(getenv("WATCH")&&a==strtoul(getenv("WATCH"),0,16))fprintf(stderr,"call %x r0=%x r1=%x r2=%x r3=%x lr=%x\n",a,r[0],r[1],r[2],r[3],r[14]);
  {static uint32_t hot,hits;if(a==hot){if(++hits==100000){fprintf(stderr,"spinning on %x, stack:",a);dump();exit(5);}}else{hot=a;hits=0;}}
  {static int tr=-1,tf,td;if(tr<0){tr=!!getenv("TRACE");tf=getenv("TFRAME")?atoi(getenv("TFRAME")):-1;td=getenv("TDEPTH")?atoi(getenv("TDEPTH")):999;}if(tr&&(tf<0||vblanks==tf)&&depth<=td&&!in_worker)fprintf(stderr,"%*s%x\n",depth,"",a);}
  if(a==0x28b4ec&&r[2]==0x120b00){ // the file loader's one-shot worker thread runs to completion at once
    jobs[job_count++]=rd32(r[3]);r[0]=0;return;}
  if(0&&a==0x1027a8){wr32(0x54d400,0x282200);wr32(0x54d404,0x26ccdc);return;} // graphics init skipped; keep its GPU allocator callbacks
  if(!in_worker&&(a==0x2856c8||a==0x266a0c)){run_jobs();if(!run_workers())dsp_frame();return;} // nobody could run: time passes (one audio frame) // the main thread waiting: let the others run, then it checks again
  if(a==0x2471dc&&getenv("GAME")&&!in_worker&&rd32(rd32(r[0]+4)+4)==3){static int started;int start_at=getenv("START")?atoi(getenv("START")):60;
    if(!started&&vblanks>=start_at){started=1;uint32_t g=strtoul(getenv("GAME"),0,0),saved[16];memcpy(saved,r,64);
      // the game's own minigame start (as the menu does at 0x163014): tickflow, game scene 72, game index
      r[0]=g;call(0x258df4);uint32_t tf=r[0];fprintf(stderr,"start game %u tickflow %x\n",g,tf);if(getenv("WATCH"))watch_here(p(strtoul(getenv("WATCH"),0,16),1));{uint32_t sv=rd32(0x54d350),slot=rd32(sv+rd32(0x38b7f4));fprintf(stderr,"save %x slot %d byte %x\n",sv,slot,rd8(sv+slot*0x2c9*8+0x2d01));wr8(sv+slot*0x2c9*8+0x2d01,0);}
      r[0]=rd32(0x54ef2c);r[1]=tf;r[2]=13;VFP[0]=0;call(0x284760);
      r[0]=0x48;call(0x258dcc);
      wr8(rd32(0x54ef10)+0x34,g);r[0]=rd32(0x54ef10);call(0x258dc0);r[0]=rd32(0x54ef10);call(0x258da0);r[0]=rd32(0x54ef10);call(0x258d94);
      wr8(rd32(0x54ef2c)+0xa45,1); // as the scene base does when a scene ends with a game queued
      memcpy(r,saved,64);}}
  if(a==0x25c3a0&&getenv("TF")&&r[1]==0x52){static int once;if(!once++){uint32_t F=rd32(0x54ef2c),w=rd32(F+0x104);fprintf(stderr,"op52 weak %x:",w);if(w)for(int i=0;i<4;i++)fprintf(stderr," %x",rd32(w+4*i));fprintf(stderr,"\n");if(w&&rd32(w+4)){uint32_t o=rd32(w+4),v=rd32(o);fprintf(stderr,"snd obj %x 9c %x 169 %x vt %x:",o,rd8(o+0x9c),rd8(o+0x169),v);watch_here(p(o+0x169,1));for(int i=0;i<12;i++)fprintf(stderr," %x",rd32(v+4*i));fprintf(stderr,"\n");}}}
  if(a==0x25c3a0&&getenv("TF"))fprintf(stderr,"tf op %x arg0 %x at %x frame %u\n",r[1],r[2],r[3]-4,vblanks);
  if(a==0x10f970){wr32(0x54dd74,0x10080000);r[0]=0;return;} // APT GetSharedFont + map: the stand-in font
  if(a==0x124ff4&&getenv("GSP")&&getenv("GSPWAIT")&&!in_worker){run_jobs();if(!run_workers())dsp_frame();return;} // waiting for a GPU interrupt: others run, or time passes
  if(a==0x124ff4&&getenv("FRAMES")&&!in_worker){static uint32_t n;int every=getenv("EVERY")?atoi(getenv("EVERY")):60;if(n++%every==0){static uint8_t rgb[400*240*3];if(pica_top_rgb(rgb)){char f[256];snprintf(f,256,"%s/f%05u.ppm",getenv("FRAMES"),n/every);FILE*o=fopen(f,"wb");if(o){fprintf(o,"P6 400 240 255\n");fwrite(rgb,1,sizeof rgb,o);fclose(o);}}}}
  if(a==0x124ff4){wr8(0x5abed0+17,0);wr32(0x5abed0+0x154,rd32(0x5abed0+0x154)+1);wr32(0x5abed0+0x158,rd32(0x5abed0+0x158)+1);vblanks++;{static double acc;for(acc+=32728.0/160/59.83;acc>=1;acc--){dsp_frame();if(getenv("INTERLEAVE")&&!in_worker)run_workers();}}{static uint32_t last;extern uint32_t main_calls;if(getenv("FSTAT"))if(rd32(0x54eee4)&&rd32(rd32(0x54eee4)+4)){uint32_t S=rd32(rd32(0x54eee4)+4),A=rd32(0x54eef0);fprintf(stderr,"frame %u main calls %u scene %x state %d snd %d vt %x\n",vblanks,main_calls-last,rd32(rd32(0x54eee4)+12),rd32(rd32(S+4)+4),A?rd8(rd32(A+0x48)+0x51):-1,rd32(rd32(0x54eee4)+20)?rd32(rd32(rd32(0x54eee4)+20)):0);}last=main_calls;}if(!in_worker){run_jobs();run_workers();}return;} // waiting for the GPU interrupt: every GPU job is done at once
  if(a==0x28b4ec){if(getenv("WORKERS")&&strstr(getenv("WORKERS"),"all")&&r[2]!=0x113980&&(r[2]!=0x1192fc||strstr(getenv("WORKERS"),"tramp"))&&(r[2]!=0x1255e4||strstr(getenv("WORKERS"),"apt"))&&(r[2]!=0x138798||strstr(getenv("WORKERS"),"gsp"))&&!(r[2]==0x1192fc&&rd32(r[3])==0x11a828)){workers[worker_count].run=r[2];workers[worker_count].obj=rd32(r[3]);workers[worker_count].stack=0x0ff80000-worker_count*0x10000;worker_count++;fprintf(stderr,"worker %x arg %x\n",r[2],rd32(r[3]));r[0]=0;return;}
  if(r[2]==0x113980){uint32_t o=rd32(r[3]);workers[worker_count].run=rd32(rd32(o)+8);workers[worker_count].obj=o;workers[worker_count].stack=0x0ff80000-worker_count*0x10000;worker_count++;fprintf(stderr,"worker %x on %x\n",rd32(rd32(o)+8),o);r[0]=0;return;}fprintf(stderr,"thread %x not started (arg %x)\n",r[2],rd32(r[3]));r[0]=0;return;} // other threads: their work is replaced at function level
  if(a==0x28c108){uint32_t n=(r[0]+31)&~31;r[0]=heap_top;memset(p(heap_top,n),0,n);heap_top+=n;return;} // operator new
  {static uint32_t noops[256];static int nn=-1;if(nn<0){nn=0;FILE*f=fopen("tools/ctr-harness/noops.txt","r");if(f){unsigned x;while(fscanf(f,"%x",&x)==1)noops[nn++]=x;fclose(f);}}
   for(int i=0;i<nn;i++)if(a==noops[i]){r[0]=0;return;}}
  if(0&&a==0x27ccb4){uint32_t al=r[2]<8?8:r[2];heap_top=(heap_top+al-1)&~(al-1);uint32_t n=(r[0]+7)&~7;r[0]=heap_top;memset(p(heap_top,n),0,n);heap_top+=n;return;} // heap alloc(size, heap, align, flags)
  if(a==0x136748||a==0x269cb4)return; // light mutex lock/unlock slow paths: one thread
  if(sp_<0||sp_>=4096){fprintf(stderr,"call stack out of range %d at %x\n",sp_,a);exit(7);}
  if(in_worker){if(frame_count>=2048){fprintf(stderr,"thread too deep\n");exit(10);}memcpy(frames[frame_count],r,64);frames[frame_count][15]=a;frame_count++;}
  depth++;stack_[sp_++]=a;
  if(!dispatch_original(a)){fprintf(stderr,"missing %x, stack:",a);dump();exit(4);}
  depth--;sp_--;if(in_worker&&frame_count)frame_count--;
}
static void load(const char*f,uint32_t at){FILE*fp=fopen(f,"rb");fseek(fp,0,2);long n=ftell(fp);fseek(fp,0,0);fread(code+at-0x100000,1,n,fp);fclose(fp);}
#include <signal.h>
#include <unistd.h>
static void on_prof(int s){prof_on=1;}
static void on_alarm(int s){if(getenv("PROF")&&!prof_on){prof_on=1;alarm(atoi(getenv("PROF")));return;}if(prof_on){for(int k=0;k<40;k++){uint32_t b=0,bi=0;for(uint32_t i=0;i<0x300000;i++)if(prof[i]>b){b=prof[i];bi=i;}if(!b)break;fprintf(stderr,"prof %x %u\n",0x100000+bi*2,b);prof[bi]=0;}}for(int i=0;i<worker_count;i++)fprintf(stderr,"worker %d wakes %u run %x state %d why %d addr %x (now %x) value %x pc %x lr %x\n",i,wakes[i],workers[i].run,workers[i].state,workers[i].why,workers[i].addr,workers[i].why==W_ADDRESS?rd32(workers[i].addr):0,workers[i].value,workers[i].regs[15],workers[i].regs[14]);{uint32_t M=rd32(0x54eee4),V=rd32(M);fprintf(stderr,"manager %x vt %x:",M,V);for(int i=0;i<12;i++)fprintf(stderr," %x",rd32(V+4*i));fprintf(stderr,"\n fields:");for(int i=0;i<16;i++)fprintf(stderr," %x",rd32(M+4*i));fprintf(stderr,"\n");}fprintf(stderr,"vblanks %u scene id %d factory %x\n",vblanks,rd32(0x54c408),rd32(rd32(0x54eee4)+16));for(int k=0;k<16;k++)if(count_addr[k])fprintf(stderr,"count %x: %u\n",count_addr[k],count_hits[k]);fprintf(stderr,"pica %.1fs transfer %.1fs fill %.1fs draws %u tris %u px %llu box %llu total %.1fs\n",pica_clock/(double)CLOCKS_PER_SEC,xfer_clock/(double)CLOCKS_PER_SEC,fill_clock/(double)CLOCKS_PER_SEC,pica_draws,pica_tris,(unsigned long long)pica_px,(unsigned long long)pica_box,clock()/(double)CLOCKS_PER_SEC);if(getenv("COVER")){FILE*c=fopen(getenv("COVER"),"w");for(int i=0;i<0x14d000;i++)if(cover[i])fprintf(c,"%x\n",0x100000+i*2);fclose(c);}fprintf(stderr,"timeout, last call %x, stack:",lastcall);dump();if(getenv("PEEK")){uint32_t a=strtoul(getenv("PEEK"),0,16);fprintf(stderr,"peek %x:",a);for(int i=0;i<16;i++)fprintf(stderr," %08x",rd32(a+4*i));fprintf(stderr,"\n");}{uint32_t L=rd32(0x54eedc);fprintf(stderr,"loader %x:",L);for(int i=0;i<16;i++)fprintf(stderr," %x",rd32(L+4*i));fprintf(stderr,"\n");uint32_t G=rd32(0x54eec0),gs=rd32(G+12);fprintf(stderr,"group mgr %x:",G);for(int i=0;i<8;i++)fprintf(stderr," %x",rd32(G+4*i));fprintf(stderr,"\n");for(int i=0;i<6;i++){fprintf(stderr,"group %d:",i);for(int j=0;j<0x6c;j+=4)fprintf(stderr," %x",rd32(gs+i*0x6c+j));fprintf(stderr,"\n");}uint32_t sl=rd32(L+24);for(int i=0;i<0x80;i++){uint32_t e=sl+i*0x128;if(rd8(e+0x120)&&rd8(e+0x120)!=7){fprintf(stderr,"lslot %d state %d:",i,rd8(e+0x120));for(int j=0;j<0x128;j+=4)fprintf(stderr," %x",rd32(e+j));fprintf(stderr,"\n");}}{uint32_t A=rd32(0x54eef0),E=rd32(A+0x48);for(int i=0;i<8;i++)fprintf(stderr,"res %d state %d slot %x %x %x\n",i,rd8(E+i*84+0x51),rd32(E+i*84+0x44),rd32(E+i*84+0x48),rd32(E+i*84+0x4c));}for(int i=0x1d;i<0x1d;i++){uint32_t e=sl+i*0x128;fprintf(stderr,"raw:");for(int j=0;j<0x128;j+=4)fprintf(stderr," %x",rd32(e+j));fprintf(stderr,"\n");fprintf(stderr,"slot %d state %d name %.40s +100:",i,rd8(e+0x120),(char*)p(e,40));for(int j=0x100;j<0x128;j+=4)fprintf(stderr," %x",rd32(e+j));fprintf(stderr,"\n");}}_exit(6);}

// The system shared font is not part of the game. A tiny stand-in CFNT (one blank 8x8 glyph that every
// character falls back to) lets the game's text code run; text draws as blanks.
static void make_font(uint32_t base){
  uint32_t f=base+0x80,o=0;
  #define W8(x,v) wr8(f+(x),v)
  #define W16(x,v) (wr8(f+(x),(v)&255),wr8(f+(x)+1,((v)>>8)&255))
  #define W32(x,v) wr32(f+(x),v)
  W32(0,0x544e4643);W16(4,0xfeff);W16(6,0x14);W32(8,0x03000000);W16(16,4);
  o=0x14; // FINF
  W32(o,0x464e4946);W32(o+4,0x20);W8(o+8,1);W8(o+9,10);W16(o+10,0);W8(o+12,0);W8(o+13,8);W8(o+14,8);W8(o+15,1);
  W32(o+16,0x34+8);W32(o+20,0x60+8);W32(o+24,0x74+8);W8(o+28,8);W8(o+29,8);W8(o+30,7);
  o=0x34; // TGLP
  W32(o,0x504c4754);W32(o+4,0x2c);W8(o+8,8);W8(o+9,8);W8(o+10,7);W8(o+11,8);W32(o+12,512);W16(o+16,1);W16(o+18,11);
  W16(o+20,4);W16(o+22,4);W16(o+24,32);W16(o+26,32);W32(o+28,0x100);
  o=0x60; // CWDH
  W32(o,0x48445743);W32(o+4,0x14);W16(o+8,0);W16(o+10,0);W32(o+12,0);W8(o+16,0);W8(o+17,8);W8(o+18,8);
  o=0x74; // CMAP: scan, no entries
  W32(o,0x50414d43);W32(o+4,0x18);W16(o+8,0);W16(o+10,0xffff);W16(o+12,2);W16(o+14,0);W32(o+16,0);W16(o+20,0);
  W32(12,0x300);
  wr32(base,2);wr32(base+4,1);wr32(base+8,0x300);}
int main(int argc,char**argv){
  signal(SIGALRM,on_alarm);alarm(getenv("SECS")?atoi(getenv("SECS")):30);
  code=calloc(1,0x600000);heapm=calloc(1,0x4000000);stackm=calloc(1,0x400000);tlsm=calloc(1,0x3000);shm=calloc(1,0x100000);linm=calloc(1,0x3000000);vram=calloc(1,0x600000);dspm=calloc(1,0x80000);wr32(0x1ff80040,0x04000000); // APPMEMALLOC: 64 MB
 
  load("build/ctr/code-text.bin",0x100000);
  load("build/ctr/code-rodata.bin",0x39a000);
  load("build/ctr/code-data.bin",0x521000);
  r[13]=0x10000000;r[14]=0;
  make_font(0x10080000);
  if(argc>1)call(strtoul(argv[1],0,0));else call(0x1dc08c);
  printf("scene at %x vtable %x\n",r[0],rd32(r[0]));
}
