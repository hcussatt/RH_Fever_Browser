// ARM11 state and helpers for the statically translated Megamix code (tools/arm_recompile.py).
// The includer supplies the memory accessors rd8/rd16/rd32/rd64 and wr8/wr16/wr32/wr64 (guest
// little-endian), call(address) (translated function or platform service; bit 0 marks Thumb),
// svc(number, address), tls(void) and panic(address, code).
#include <stdint.h>
#include <math.h>

static uint32_t r[16];             // r13 sp, r14 lr; r15 is never stored (reads are constants)
static uint32_t fn, fz, fc, fv;    // CPSR N, Z, C, V
static uint32_t fq, ge;            // CPSR Q (saturating ops) and GE bits (SIMD compares)
static union { float s[32]; double d[16]; uint32_t u[32]; uint64_t ud[16]; } vfp;
static uint32_t fpscr = 0x03C00000; // NZCV kept in the top bits; default NaN, flush to zero, nearest
static uint32_t exclusive = 0xffffffff;

static inline uint32_t rotr(uint32_t v, uint32_t n) { n &= 31; return n ? (v >> n) | (v << (32 - n)) : v; }

// Register-specified shifts: the amount is the bottom byte of the register, and the shifter's carry
// out keeps C when the amount is 0.
static inline uint32_t lsl_c(uint32_t v, uint32_t n, uint32_t *c) {
  n &= 255; if (!n) return v;
  if (n < 32) { *c = (v >> (32 - n)) & 1; return v << n; }
  *c = n == 32 ? v & 1 : 0; return 0;
}
static inline uint32_t lsr_c(uint32_t v, uint32_t n, uint32_t *c) {
  n &= 255; if (!n) return v;
  if (n < 32) { *c = (v >> (n - 1)) & 1; return v >> n; }
  *c = n == 32 ? v >> 31 : 0; return 0;
}
static inline uint32_t asr_c(uint32_t v, uint32_t n, uint32_t *c) {
  n &= 255; if (!n) return v;
  if (n < 32) { *c = (v >> (n - 1)) & 1; return (uint32_t)((int32_t)v >> n); }
  *c = v >> 31; return (uint32_t)((int32_t)v >> 31);
}
static inline uint32_t ror_c(uint32_t v, uint32_t n, uint32_t *c) {
  n &= 255; if (!n) return v;
  n &= 31; if (!n) { *c = v >> 31; return v; }
  *c = (v >> (n - 1)) & 1; return rotr(v, n);
}

// Flags of an addition a + b + carry_in, the result returned.
static inline uint32_t add_flags(uint32_t a, uint32_t b, uint32_t carry_in) {
  uint64_t u = (uint64_t)a + b + carry_in;
  uint32_t v = (uint32_t)u;
  fn = v >> 31; fz = v == 0; fc = (uint32_t)(u >> 32); fv = ((~(a ^ b) & (a ^ v)) >> 31) & 1;
  return v;
}
static inline void logic_flags(uint32_t v, uint32_t c) { fn = v >> 31; fz = v == 0; fc = c; }

// VFP compares set FPSCR's NZCV: equal 0110, less 1000, greater 0010, unordered 0011.
static inline void vfp_compare(double a, double b) {
  uint32_t f = a != a || b != b ? 0x3 : a == b ? 0x6 : a < b ? 0x8 : 0x2;
  fpscr = (fpscr & 0x0fffffff) | (f << 28);
}
static inline void vfp_status(void) { fn = fpscr >> 31; fz = (fpscr >> 30) & 1; fc = (fpscr >> 29) & 1; fv = (fpscr >> 28) & 1; }

// Float to integer, saturating like the VFP (NaN gives 0). round: 0 toward zero, 1 FPSCR (nearest).
static inline uint32_t vfp_to_s32(double x, int round) {
  if (x != x) return 0;
  if (round) x = nearbyint(x); else x = trunc(x);
  if (x >= 2147483647.0) return 0x7fffffff;
  if (x <= -2147483648.0) return 0x80000000;
  return (uint32_t)(int32_t)x;
}
static inline uint32_t vfp_to_u32(double x, int round) {
  if (x != x) return 0;
  if (round) x = nearbyint(x); else x = trunc(x);
  if (x >= 4294967295.0) return 0xffffffff;
  if (x <= 0) return 0;
  return (uint32_t)x;
}

static inline uint32_t signed_sat(int64_t v, int bits, uint32_t *q) {
  int64_t hi = ((int64_t)1 << (bits - 1)) - 1, lo = -((int64_t)1 << (bits - 1));
  if (v > hi) { *q = 1; return (uint32_t)hi; }
  if (v < lo) { *q = 1; return (uint32_t)lo; }
  return (uint32_t)v;
}
static inline uint32_t unsigned_sat(int64_t v, int bits, uint32_t *q) {
  int64_t hi = ((int64_t)1 << bits) - 1;
  if (v > hi) { *q = 1; return (uint32_t)hi; }
  if (v < 0) { *q = 1; return 0; }
  return (uint32_t)v;
}

// ARMv6 parallel add and subtract (sadd8, uqsub8, shadd16, ...). kind: 1 signed (sets GE),
// 2 signed saturating, 3 signed halving, 5 unsigned (sets GE), 6 unsigned saturating, 7 unsigned
// halving. op: 0 add16, 1 asx, 2 sax, 3 sub16, 4 add8, 7 sub8.
static inline uint32_t parallel(int kind, int op, uint32_t a, uint32_t b) {
  int sign = kind < 4, mode = kind & 3; // mode 1 plain, 2 saturating, 3 halving
  int lanes = op >= 4 ? 4 : 2, width = op >= 4 ? 8 : 16;
  uint32_t mask = (1u << width) - 1, out = 0, g = 0;
  for (int i = 0; i < lanes; i++) {
    int ia = i, ib = i, sub;
    if (op == 0 || op == 4) sub = 0;
    else if (op == 3 || op == 7) sub = 1;
    else if (op == 1) { ib = 1 - i; sub = i == 0; }  // asx: low = a.lo - b.hi, high = a.hi + b.lo
    else { ib = 1 - i; sub = i == 1; }               // sax: low = a.lo + b.hi, high = a.hi - b.lo
    int64_t x = (a >> (ia * width)) & mask, y = (b >> (ib * width)) & mask;
    if (sign) { if (x >> (width - 1)) x -= (int64_t)1 << width; if (y >> (width - 1)) y -= (int64_t)1 << width; }
    int64_t v = sub ? x - y : x + y;
    if (mode == 1) {
      int ok = sign ? v >= 0 : (sub ? v >= 0 : v >= ((int64_t)1 << width));
      if (ok) g |= (width == 8 ? 1u : 3u) << (i * (width / 8));
    } else if (mode == 2) {
      int64_t hi = sign ? ((int64_t)1 << (width - 1)) - 1 : ((int64_t)1 << width) - 1, lo = sign ? -((int64_t)1 << (width - 1)) : 0;
      v = v > hi ? hi : v < lo ? lo : v;
    } else v >>= 1;
    out |= ((uint32_t)v & mask) << (i * width);
  }
  if (mode == 1) ge = g;
  return out;
}
