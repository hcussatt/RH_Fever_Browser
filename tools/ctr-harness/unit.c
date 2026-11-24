// The translated game program (build/ctr/blanco.inc, made by gen.py from your own dump) as one unit.
#include <stdint.h>
uint32_t rd32(uint32_t),rd16(uint32_t),rd8(uint32_t);uint64_t rd64(uint32_t);
void wr32(uint32_t,uint32_t),wr16(uint32_t,uint32_t),wr8(uint32_t,uint32_t),wr64(uint32_t,uint64_t);
void call(uint32_t);void svc(uint32_t,uint32_t);uint32_t tls(void);void panic(uint32_t,int);
#include "../../adapters/ctr/arm.h"
#include "../../build/ctr/blanco.inc"
uint32_t *R=r;
int dispatch(uint32_t a){return dispatch_original(a);}
float *VFP=vfp.s;
int resume(uint32_t a){return resume_original(a);}
