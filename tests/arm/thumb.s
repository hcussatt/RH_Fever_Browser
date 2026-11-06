.syntax unified
.arm
_start:                 @ ARM entry: r0 = n; calls a Thumb routine that returns sum of i*3 for i<n, plus extras
  push {r4, lr}
  blx tsum
  add r0, r0, #1
  pop {r4, pc}
.thumb
.thumb_func
tsum:
  push {r4, r5, lr}
  movs r1, #0           @ i
  movs r2, #0           @ acc
1:
  cmp r1, r0
  bge 2f
  lsls r3, r1, #1
  adds r3, r3, r1       @ i*3
  adds r2, r2, r3
  adds r1, #1
  b 1b
2:
  ldr r4, =0x1000
  str r2, [r4, #4]
  ldrh r5, [r4, #4]
  uxtb r3, r5
  rev r5, r5
  adds r2, r2, r3
  mvns r3, r3
  bics r2, r3           @ r2 &= ~~r3 -> r2 & r3
  bl helper
  movs r0, r2
  pop {r4, r5, pc}
.thumb_func
helper:
  adds r2, #7
  bx lr
.ltorg
