// dsp::DSP service and a high-level stand-in for the DSP's audio firmware.
// The application and the DSP share two copies of the audio structures in DSP RAM (0x1ff50000 and
// 0x1ff70000); each audio frame (160 samples at 32728 Hz) the application fills one copy, raises the
// DSP semaphore, and the DSP reads it and writes its status back.
#include <dirent.h>
static int dsp_log=-1;
static uint8_t dsp_pipe[8][64];static uint32_t dsp_pipe_len[8];
static uint32_t dsp_event, dsp_sem_mask, dsp_irq_event, dsp_frames, dsp_irq_binary;
// The DSP's AAC decoder: the game sends one ADTS frame at a time (pipe 3). The stand-in decodes each music
// file once, whole, and answers a request with the PCM of the frame whose bytes it was sent.
static struct{uint64_t hash;uint32_t file,index;}aac_frames[1<<16];static int aac_frame_count;
static struct{int16_t*pcm;uint32_t samples,channels;}aac_files[8];static int aac_file_count;
static uint64_t fnv(const uint8_t*d,uint32_t n){uint64_t h=1469598103934665603ull;for(uint32_t i=0;i<n;i++){h^=d[i];h*=1099511628211ull;}return h;}
static void aac_load(const char*path){
  FILE*f=fopen(path,"rb");if(!f)return;fseek(f,0,2);long n=ftell(f);fseek(f,0,0);uint8_t*d=malloc(n);fread(d,1,n,f);fclose(f);
  int file=aac_file_count++;uint32_t index=0;
  for(long at=0;at+7<=n;){if(d[at]!=0xff||(d[at+1]&0xf0)!=0xf0)break;uint32_t len=((d[at+3]&3)<<11)|(d[at+4]<<3)|(d[at+5]>>5);
    if(!len||at+len>n)break;aac_frames[aac_frame_count].hash=fnv(d+at,len);aac_frames[aac_frame_count].file=file;aac_frames[aac_frame_count++].index=index++;at+=len;}
  free(d);
#ifdef __EMSCRIPTEN__ // the page decoded the file already (path + ".pcm", 16-bit stereo)
  char pcm_path[512];snprintf(pcm_path,512,"%s.pcm",path);FILE*p=fopen(pcm_path,"rb");if(!p)return;
#else
  char cmd[512];snprintf(cmd,512,"ffmpeg -v quiet -i '%s' -f s16le -ac 2 -",path);FILE*p=popen(cmd,"r");
#endif
  size_t cap=1<<20,got=0;int16_t*pcm=malloc(cap*2);size_t k;while((k=fread(pcm+got,2,cap-got,p))>0){got+=k;if(got==cap){cap*=2;pcm=realloc(pcm,cap*2);}}
#ifdef __EMSCRIPTEN__
  fclose(p);
#else
  pclose(p);
#endif
  aac_files[file].pcm=pcm;aac_files[file].samples=got/2;aac_files[file].channels=2;
  if(dsp_log>0)fprintf(stderr,"aac %s: %u frames, %u samples\n",path,index,(unsigned)(got/2));}
static void aac_load_all(void){static int done;if(done++)return;
  const char*dir="build/ctr/romfs/sound/aac/";char path[512];
  DIR*l=opendir(dir);struct dirent*e;
  while(l&&(e=readdir(l)))if(strlen(e->d_name)>4&&!strcmp(e->d_name+strlen(e->d_name)-4,".aac")){snprintf(path,512,"%s%s",dir,e->d_name);aac_load(path);}if(l)closedir(l);}
static void dsp_binary(uint32_t ptr,uint32_t size){ // a request on pipe 3: answer on pipe 3 and raise its interrupt
  uint32_t codec=rd16(ptr),cmd=rd16(ptr+2);uint8_t out[32]={0};out[0]=codec;out[2]=cmd;
  if(codec==1&&cmd==1){ // decode one frame
    uint32_t src=rd32(ptr+8),n=rd32(ptr+12),dst0=rd32(ptr+16),dst1=rd32(ptr+20);
    aac_load_all();uint64_t h=fnv(p(src,n),n);int i;for(i=0;i<aac_frame_count;i++)if(aac_frames[i].hash==h)break;
    uint32_t samples=1024;if(dsp_log>0&&i<aac_frame_count)fprintf(stderr,"aac decode file %u frame %u\n",aac_frames[i].file,aac_frames[i].index);
    if(i<aac_frame_count){int16_t*pcm=aac_files[aac_frames[i].file].pcm;uint32_t total=aac_files[aac_frames[i].file].samples,at=aac_frames[i].index*1024;
      for(uint32_t s=0;s<samples;s++){int16_t l=at+s<total?pcm[2*(at+s)]:0,r=at+s<total?pcm[2*(at+s)+1]:0;
        if(dst0)wr16(dst0+2*s,l);if(dst1)wr16(dst1+2*s,r);}}
    else if(dsp_log>0)fprintf(stderr,"aac frame not found (src %x size %x)\n",src,n);
    uint32_t v[6]={2,2,n,0,0,samples}; // 32000 Hz, stereo, bytes used, -, -, samples per channel
    memcpy(out+8,v,24);}
  memcpy(dsp_pipe[3],out,32);dsp_pipe_len[3]=32;
  if(dsp_irq_binary&&nsig_handle<64)signaled_handle[nsig_handle++]=dsp_irq_binary;}
// Region 0 word addresses (DSP RAM 0x1ff40000 + 2*address); region 1 is 0x10000 words further on.
// frame counter, source configurations, source statuses, ADPCM coefficients, DSP configuration, DSP status,
// final samples, intermediate mix samples, compressor table, debug, unknown x5.
static const uint16_t dsp_addr[15]={0x8000,0x8100,0x8a00,0x8b00,0x8d00,0x8e00,0x8f00,0x9200,0x9c00,0x9e00,0xa000,0xa200,0xa400,0xa600,0xa800};

static void dsp_reply(uint32_t cmd,int words){reply(cmd,words);for(int i=0;i<words;i++)wr32(0x1ff82084+4*i,0);}

static void dsp_ipc(uint32_t cmd,uint32_t*arg){
  uint32_t id=cmd>>16;
  if(dsp_log<0)dsp_log=getenv("DSPLOG")?atoi(getenv("DSPLOG")):0;
  if(dsp_log)fprintf(stderr,"dsp cmd %x args %x %x %x %x %x\n",id,arg[0],arg[1],arg[2],arg[3],arg[4]);
  switch(id){
  case 0x11: // LoadComponent(size, program mask, data mask, buffer): the firmware is "loaded"
    dsp_reply(cmd,2);wr32(0x1ff82088,1);return;
  case 0x15: if(arg[1]==2)dsp_irq_event=arg[3];if(arg[1]==3)dsp_irq_binary=arg[3];dsp_reply(cmd,1);return; // RegisterInterruptEvents(interrupt, channel, event)
  case 0x16: // GetSemaphoreEventHandle
    if(!dsp_event)dsp_event=new_handle(H_SVC_OTHER,"dspev");
    dsp_reply(cmd,3);wr32(0x1ff8208c,dsp_event);return;
  case 0x17: dsp_sem_mask=arg[0];dsp_reply(cmd,1);return; // SetSemaphoreMask
  case 0x0c: dsp_reply(cmd,2);wr32(0x1ff82088,0x1ff40000+(arg[0]<<1));return; // ConvertProcessAddressFromDspDram
  case 0x0d:{ // WriteProcessPipe(channel, size, static buffer)
    uint32_t ch=arg[0],size=arg[1],ptr=arg[3];
    if(dsp_log){fprintf(stderr,"  [f%u] pipe %u write:",dsp_frames,ch);for(uint32_t i=0;i<size&&i<32;i++)fprintf(stderr," %02x",rd8(ptr+i));fprintf(stderr,"\n");}
    if(ch==2&&size>=4&&rd32(ptr)==0){ // audio pipe, state "initialize": answer with where the structures are
      uint8_t*q=dsp_pipe[2];q[0]=15;q[1]=0;
      for(int i=0;i<15;i++){uint16_t w=dsp_addr[i];q[2+2*i]=w&255;q[3+2*i]=w>>8;}
      dsp_pipe_len[2]=32;}
    if(ch==3&&size>=32){if(dsp_log>0){fprintf(stderr,"  pipe 3 stack:");dump();}dsp_binary(ptr,size);}
    dsp_reply(cmd,1);return;}
  case 0x10:{ // ReadPipeIfPossible(channel, peer, size) -> size read, data in static buffer 0
    uint32_t ch=arg[0]&7,want=arg[2]&0xffff,n=dsp_pipe_len[ch]<want?dsp_pipe_len[ch]:want,dst=rd32(0x1ff82184);
    for(uint32_t i=0;i<n;i++)wr8(dst+i,dsp_pipe[ch][i]);
    memmove(dsp_pipe[ch],dsp_pipe[ch]+n,dsp_pipe_len[ch]-n);dsp_pipe_len[ch]-=n;
    reply(cmd,4);wr32(0x1ff82080,(cmd&0xffff0000)|(2<<6)|2);wr32(0x1ff82084,0);wr32(0x1ff82088,n);
    wr32(0x1ff8208c,(n<<14)|2);wr32(0x1ff82090,dst);return;}
  default: dsp_reply(cmd,1);return;
  }
}

static int dsp_is_event(uint32_t h){return h&&(h==dsp_event||h==dsp_irq_event||h==dsp_irq_binary);}
static uint32_t dsp_region(void){ // the copy the application wrote last (the larger frame counter, with wraparound)
  uint16_t a=rd16(0x1ff50000),b=rd16(0x1ff70000);
  if(a==0xffff&&b!=0xfffe)return 0x1ff70000;
  if(b==0xffff&&a!=0xfffe)return 0x1ff50000;
  return a>b?0x1ff50000:0x1ff70000;}
// The DSP's 24 voices ("sources"). Each audio frame the DSP reads the configuration the application wrote,
// plays 160 output samples from each voice's buffers, and writes back where each voice is (status), which the
// application uses to refill its buffers. Gains feed three quad mixes; mix 0 is the main output.
static uint32_t rd32d(uint32_t a){return (rd16(a)<<16)|rd16(a+2);} // DSP 32-bit words: high half first
static void wr32d(uint32_t a,uint32_t v){wr16(a,v>>16);wr16(a+2,v&0xffff);}
typedef struct{uint32_t addr,length,id,from_queue,play_position,format,stereo,looping,adpcm_dirty,ps,yn1,yn2;}dsp_buffer;
static struct{int enabled,format,stereo,interp,update;uint32_t sync;float rate,gain[3][4];
  dsp_buffer queue[16];int queued;
  int playing;dsp_buffer cur;double pos;int16_t*pcm;uint32_t pcm_len; // the current buffer, decoded
  uint32_t current_id,last_id;int16_t yn1,yn2;int16_t coef[16];float last[2];}dsp_src[24];
static float dsp_master=1,dsp_aux[2]={1,1};
static FILE*dsp_wav;static uint32_t dsp_wav_samples;
static uint32_t dsp_virt(uint32_t pa){pa&=~3u;if(pa>=0x20000000&&pa<0x28000000)return pa-0x20000000+0x14000000;return pa;} // linear heap
static void dsp_decode(int i){ // turn the current buffer into 16-bit PCM
  typeof(dsp_src[0])*s=&dsp_src[i];dsp_buffer*b=&s->cur;uint32_t ch=b->stereo?2:1,n=b->length,at=dsp_virt(b->addr);
  free(s->pcm);s->pcm=calloc(n*2+2,2);s->pcm_len=n;
  if(b->adpcm_dirty){s->yn1=b->yn1;s->yn2=b->yn2;}
  if(dsp_log>1&&b->format==2){int bad=0;for(uint32_t f=0;f<(n+13)/14&&f<4000;f++){uint8_t h=rd8(at+f*8);if((h&15)>12||(h>>4)>7)bad++;}fprintf(stderr,"adpcm src %d addr %x (%x) len %u first %02x %02x bad headers %d coef %d %d %d %d\n",i,b->addr,at,n,rd8(at),rd8(at+8),bad,s->coef[0],s->coef[1],s->coef[2],s->coef[3]);}
  for(uint32_t k=0;k<n;k++){int16_t l=0,r=0;
    if(b->format==1){l=rd16(at+k*2*ch);r=ch==2?rd16(at+k*2*ch+2):l;}
    else if(b->format==0){l=(int8_t)rd8(at+k*ch)<<8;r=ch==2?(int8_t)rd8(at+k*ch+1)<<8:l;}
    else{ // DSP-ADPCM: 8-byte frames, a header byte then 14 four-bit samples
      uint32_t f=at+(k/14)*8;uint8_t h=rd8(f);int scale=1<<(h&15),pred=(h>>4)&7,j=k%14;
      int nib=rd8(f+1+j/2);nib=j&1?nib&15:nib>>4;if(nib>=8)nib-=16;
      int v=((nib*scale)<<11)+1024+s->coef[pred*2]*s->yn1+s->coef[pred*2+1]*s->yn2;v>>=11;
      if(v>32767)v=32767;if(v<-32768)v=-32768;s->yn2=s->yn1;s->yn1=v;l=r=v;}
    s->pcm[2*k]=l;s->pcm[2*k+1]=r;}}
static int dsp_dequeue(int i){
  typeof(dsp_src[0])*s=&dsp_src[i];if(!s->queued)return 0;
  int best=0;for(int k=1;k<s->queued;k++)if(s->queue[k].id<s->queue[best].id)best=k; // lowest buffer id first
  dsp_buffer b=s->queue[best];s->queue[best]=s->queue[--s->queued];
  if(dsp_log>0)fprintf(stderr,"[f%u] dsp src %d play id %u addr %x len %u fmt %u st %u loop %u queue %d\n",dsp_frames,i,b.id,b.addr,b.length,b.format,b.stereo,b.looping,b.from_queue);
  s->cur=b;s->playing=1;dsp_decode(i);s->pos=b.play_position;
  s->current_id=b.id;s->last_id=0;s->update=b.from_queue;
  if(b.looping&&s->queued<16){b.play_position=0;b.from_queue=0;s->queue[s->queued++]=b;}
  return 1;}
static void dsp_source(int i,uint32_t cfg,uint32_t coef,int32_t mix[3][160][4]){
  typeof(dsp_src[0])*s=&dsp_src[i];uint32_t d=rd32(cfg);
  if(d){
    if(d&(1u<<29)){free(s->pcm);memset(s,0,sizeof*s);s->rate=1;}
    if(d&(1u<<4))s->queued=0;
    if(d&(1u<<16))s->enabled=rd8(cfg+160)!=0;
    if(d&(1u<<28))s->sync=rd16(cfg+162);
    if(d&(1u<<18)){float f;uint32_t v=rd32(cfg+52);memcpy(&f,&v,4);s->rate=f>0?f:1;}
    if(d&(1u<<2))for(int k=0;k<16;k++)s->coef[k]=rd16(coef+2*k);
    for(int m=0;m<3;m++)if(d&(1u<<(25+m)))for(int k=0;k<4;k++){uint32_t v=rd32(cfg+4+16*m+4*k);memcpy(&s->gain[m][k],&v,4);}if(dsp_log>0&&(d&(7u<<25)))fprintf(stderr,"[f%u] src %d gain %.3f %.3f %.3f %.3f | %.3f %.3f %.3f %.3f | %.3f %.3f %.3f %.3f rate %.4f\n",dsp_frames,i,s->gain[0][0],s->gain[0][1],s->gain[0][2],s->gain[0][3],s->gain[1][0],s->gain[1][1],s->gain[1][2],s->gain[1][3],s->gain[2][0],s->gain[2][1],s->gain[2][2],s->gain[2][3],s->rate);
    if(d&(1u<<17))s->interp=rd8(cfg+56);
    uint32_t f1=rd16(cfg+180);
    if(d&((1u<<0)|(1u<<30)))s->format=(f1>>2)&3;
    if(d&((1u<<1)|(1u<<30)))s->stereo=(f1&3)==2;
    uint32_t pp=d&(1u<<21)?rd32d(cfg+164):0;
    if(d&(1u<<30)&&(int32_t)rd32d(cfg+176)>=0&&s->queued<16){uint32_t f2=rd16(cfg+188);
      s->queue[s->queued++]=(dsp_buffer){rd32d(cfg+172),rd32d(cfg+176),rd16(cfg+190),0,pp,s->format,s->stereo,(f2>>1)&1,f2&1,rd16(cfg+182),rd16(cfg+184),rd16(cfg+186)};}
    if(d&(1u<<19)){uint32_t dirty=rd16(cfg+74);
      for(int k=0;k<4;k++)if(dirty&(1<<k)&&s->queued<16){uint32_t b=cfg+76+20*k;
        if((int32_t)rd32d(b+4)>=0)s->queue[s->queued++]=(dsp_buffer){rd32d(b),rd32d(b+4),rd16(b+16),1,0,s->format,s->stereo,rd8(b+15),rd8(b+14),rd16(b+8),rd16(b+10),rd16(b+12)};}
      wr16(cfg+74,0);}
    wr32(cfg,0);}
  if(s->enabled){
    float out[160][2]={{0}};
    if(!s->playing||s->pos>=s->pcm_len){s->playing=0;
      if(!dsp_dequeue(i)){s->enabled=0;s->update=1;s->last_id=s->current_id;s->current_id=0;}}
    else for(int k=0;k<160;){
      if(s->pos>=s->pcm_len){s->playing=0;if(!dsp_dequeue(i))break;continue;}
      uint32_t at=(uint32_t)s->pos;double t=s->pos-at;
      for(int c=0;c<2;c++){float a=s->pcm[2*at+c],b=at+1<s->pcm_len?s->pcm[2*at+2+c]:a;out[k][c]=s->interp==2?a:a+(b-a)*t;}
      s->pos+=s->rate;k++;}
    {static int64_t solo=-2;if(solo==-2){solo=getenv("DSPSOLO")?strtoll(getenv("DSPSOLO"),0,16):-1;}if(solo!=-1&&!(solo>>i&1))return;}
    for(int m=0;m<3;m++)for(int k=0;k<160;k++){mix[m][k][0]+=s->gain[m][0]*out[k][0];mix[m][k][1]+=s->gain[m][1]*out[k][1];
      mix[m][k][2]+=s->gain[m][2]*out[k][0];mix[m][k][3]+=s->gain[m][3]*out[k][1];}}}
// One audio frame: read what the application set, write back the status, raise the interrupts.
static void dsp_frame(void){
  if(!dsp_event)return;
  uint32_t reg=dsp_region(),wreg=reg==0x1ff50000?0x1ff70000:0x1ff50000;dsp_frames++;
  if(dsp_log>0&&dsp_frames<6){fprintf(stderr,"dsp frame %u region %x counters %x %x\n",dsp_frames,reg,rd16(0x1ff50000),rd16(0x1ff70000));}
  static int32_t mix[3][160][4];memset(mix,0,sizeof mix);
  {uint32_t c=reg+0x1a00,d=rd32(c);float f;if(d&(1u<<16)){uint32_t v=rd32(c+4);memcpy(&f,&v,4);dsp_master=f;if(dsp_log>0)fprintf(stderr,"master %f\n",f);}
    for(int k=0;k<2;k++)if(d&(1u<<(24+k))){uint32_t v=rd32(c+8+4*k);memcpy(&f,&v,4);dsp_aux[k]=f;}
    if(d)wr32(c,0);}
  for(int i=0;i<24;i++){
    dsp_source(i,reg+0x200+i*192,reg+0x1600+i*32,mix);
    uint32_t st=wreg+0x1400+i*12;typeof(dsp_src[0])*s=&dsp_src[i];
    wr8(st,s->enabled);wr8(st+1,s->update);s->update=0;wr16(st+2,s->sync);wr32d(st+4,(uint32_t)s->pos);wr16(st+8,s->current_id);wr16(st+10,s->last_id);}
  for(int k=0;k<160;k++){int32_t o[2];
    for(int c=0;c<2;c++){float v=dsp_master*(mix[0][k][c]+mix[0][k][c+2])+dsp_aux[0]*(mix[1][k][c]+mix[1][k][c+2])+dsp_aux[1]*(mix[2][k][c]+mix[2][k][c+2]);
      o[c]=v>32767?32767:v<-32768?-32768:(int32_t)v;wr16(wreg+0x1e00+4*k+2*c,o[c]);}
    if(dsp_wav){int16_t w[2]={o[0],o[1]};fwrite(w,2,2,dsp_wav);dsp_wav_samples++;}
    WEB_AUDIO(o[0],o[1]);}
  {static int once;if(!once++&&getenv("DSPWAV"))dsp_wav=fopen(getenv("DSPWAV"),"wb");}
  {static double acc;if(getenv("GSP")&&(acc+=160*59.83/32728.0)>=1){acc-=1;gsp_vblank();vblanks++;}}
  if(nsig_handle<62){signaled_handle[nsig_handle++]=dsp_event;if(dsp_irq_event)signaled_handle[nsig_handle++]=dsp_irq_event;}}
