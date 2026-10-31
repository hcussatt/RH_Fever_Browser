.arm
_start:            @ r0 = buffer pointer
  push {r4-r7, lr}
  vpush {d8-d9}
  ldr r1, [r0]            @ 0x11223344
  ldrh r2, [r0, #4]       @ 0xbeef
  ldrsh r3, [r0, #4]
  ldrsb r4, [r0, #6]!     @ writeback r0 += 6
  sub r0, r0, #6
  ldrd r6, r7, [r0, #8]
  str r6, [r0, #16]
  strh r2, [r0, #20]
  strb r1, [r0, #22]
  add r5, r0, #24
  stmia r5!, {r1-r4}
  ldmdb r5, {r1, r2}      @ r1 = word at +32? (r5 = r0+40) -> +32,+36
  ldr r12, [r0, r1, lsl #0]  
  mov r12, #3
  ldr r12, [r0, -r12, lsl #2]!   @ unusual: pre-index negative reg
  vldr d8, [r0, #8]
  vmov r6, r7, d8
  mrs r4, cpsr
  cmp r1, r2
  movlt r4, #1
  movge r4, #2
  rsbs r3, r3, #0
  adc r4, r4, r3, asr #31
  vpop {d8-d9}
  pop {r4-r7, pc}
