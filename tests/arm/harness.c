// Test harness for tools/arm_recompile.py: flat guest memory and the services arm.h expects.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static uint8_t mem[0x200000];
static uint32_t rd32(uint32_t a){uint32_t v;memcpy(&v,mem+a,4);return v;}
static uint64_t rd64(uint32_t a){uint64_t v;memcpy(&v,mem+a,8);return v;}
static uint32_t rd16(uint32_t a){uint16_t v;memcpy(&v,mem+a,2);return v;}
static uint32_t rd8(uint32_t a){return mem[a];}
static void wr32(uint32_t a,uint32_t v){memcpy(mem+a,&v,4);}
static void wr64(uint32_t a,uint64_t v){memcpy(mem+a,&v,8);}
static void wr16(uint32_t a,uint32_t v){uint16_t x=v;memcpy(mem+a,&x,2);}
static void wr8(uint32_t a,uint32_t v){mem[a]=v;}
static void panic(uint32_t a,int c){printf("panic %x %d\n",a,c);exit(1);}
static void svc(uint32_t n,uint32_t a){panic(a,2);}
static uint32_t tls(void){return 0;}
static void call(uint32_t a);
#include ARM_H
#include TRANSLATED
static void call(uint32_t a){if(!dispatch_original(a))panic(a,3);}
// Each test case: run the translated function at 0x100000 and print the registers it checks.
int main(int argc, char **argv) {
  if (!strcmp(argv[1], "flow")) {
    int ns[] = {1, 2, 3, 5};
    for (int i = 0; i < 4; i++) {
      r[13] = 0x1f0000; r[14] = 0xdead; r[0] = ns[i];
      call(0x100000);
      printf("%08x %08x %x\n", r[0], r[1], r[13]);
    }
  } else if (!strcmp(argv[1], "thumb")) {
    for (int n = 4; n <= 5; n++) {
      r[13] = 0x1f0000; r[14] = 0xdead; r[0] = n;
      call(0x100000);
      printf("%u %x\n", r[0], r[13]);
    }
  } else {
    uint8_t init[] = {0x44,0x33,0x22,0x11,0xef,0xbe,0x80,0,1,2,3,4,5,6,7,8};
    memcpy(mem + 0x1000, init, 16);
    r[13] = 0x1f0000; r[4] = 0x44; r[0] = 0x1000; vfp.d[8] = 7.5;
    call(0x100000);
    printf("%x %x %x %x %x %x %x %g\n", r[0], r[1], r[2], r[3], r[4], r[12], r[13], vfp.d[8]);
    for (int i = 0; i < 40; i++) printf("%02x", mem[0x1000 + i]);
    puts("");
  }
}
