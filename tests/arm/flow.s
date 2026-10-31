.arm
.global _start
_start:            @ 0x100000: sum(r0)=1..r0 with a loop, call square, compare, switch
  push {r4, lr}
  mov r4, r0
  mov r1, #0
1: adds r1, r1, r0
  subs r0, r0, #1
  bne 1b
  mov r0, r1
  bl square
  ldr r2, =0x12345678
  add r0, r0, r2
  cmp r4, #2
  addls pc, pc, r4, lsl #2
  b def
  b c0
  b c1
  b c2
c0: add r0, r0, #100
  pop {r4, pc}
c1: add r0, r0, #200
  pop {r4, pc}
c2: add r0, r0, #300
  pop {r4, pc}
def: mvn r0, #0
  pop {r4, pc}
square:
  mul r0, r0, r0
  movs r1, r0, lsr #1
  addcs r0, r0, #1
  umull r2, r3, r0, r0
  vmov s0, r0
  vcvt.f32.s32 s0, s0
  vadd.f32 s0, s0, s0
  vcvt.f64.f32 d1, s0
  vcmp.f64 d1, d1
  vmrs APSR_nzcv, fpscr
  addeq r0, r0, r3, lsl #4
  vcvt.s32.f64 s4, d1
  vmov r1, s4
  sub r0, r0, r1
  sxth r1, r0, ror #8
  uxtab r0, r0, r1
  clz r1, r0
  bx lr
.ltorg
