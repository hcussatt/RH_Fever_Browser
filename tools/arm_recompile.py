#!/usr/bin/env python3
"""Function-level ARM-to-C translation for the Megamix (3DS) port.

The 3DS counterpart of tools/recompile.py: each original function becomes a C function over the
ARM state in adapters/ctr/arm.h. Megamix has no decomp and no symbols, so functions are found by
following control flow from known entry points (the minigame's scene and checker virtual tables,
named in its manifest): branches inside a function become gotos, BL and calls through registers
go through call(), and every other branch target found becomes a function of its own.
Instructions are decoded from their bits here, not parsed from disassembly; arm-none-eabi-objdump
only annotates the generated C. Anything not modelled fails the build.

Usage:
  arm_recompile.py                       translate the functions of $RHF_GAME's manifest
  arm_recompile.py --binary F --base A --entry A [--entry A...] --out F.inc   (tests)
"""
import argparse
import json
import os
import pathlib
import struct
import subprocess
import sys

COND = ['fz', '!fz', 'fc', '!fc', 'fn', '!fn', 'fv', '!fv', '(fc&&!fz)', '(!fc||fz)',
        '(fn==fv)', '(fn!=fv)', '(!fz&&fn==fv)', '(fz||fn!=fv)', None]
DP = ['and', 'eor', 'sub', 'rsb', 'add', 'adc', 'sbc', 'rsc', 'tst', 'teq', 'cmp', 'cmn', 'orr', 'mov', 'bic', 'mvn']


class Unsupported(ValueError):
    pass


# The ARM compiler's runtime helpers that are hand-written assembly the translator can't follow
# (they return into tables placed after the call). Each is replaced by C with the same result.
# Addresses are the USA program's.
RUNTIME = {
    # __aeabi_f2lz: float to int64, toward zero, saturating; NaN gives 0.
    0x272940: ('f2lz', '{union{uint32_t u;float f;}v={.u=r[0]};float f=v.f;int64_t x;'
                       'if(f!=f)x=0;else if(f>=9223372036854775808.0f)x=INT64_MAX;'
                       'else if(f<-9223372036854775808.0f)x=INT64_MIN;else x=(int64_t)f;'
                       'r[0]=(uint32_t)x;r[1]=(uint32_t)((uint64_t)x>>32);}'),
    # __aeabi_f2ulz: float to uint64, toward zero, saturating; NaN and negatives give 0.
    0x20dcac: ('f2ulz', '{union{uint32_t u;float f;}v={.u=r[0]};float f=v.f;uint64_t x;'
                        'if(!(f>0))x=0;else if(f>=18446744073709551616.0f)x=UINT64_MAX;else x=(uint64_t)f;'
                        'r[0]=(uint32_t)x;r[1]=(uint32_t)(x>>32);}'),
    # IEEE float remainder (ties to the even quotient), exact, so C's remainderf matches it.
    0x14fecc: ('frem', '{union{uint32_t u;float f;}a={.u=r[0]},b={.u=r[1]},v;v.f=remainderf(a.f,b.f);r[0]=v.u;}'),
}


def bits(w, hi, lo):
    return (w >> lo) & ((1 << (hi - lo + 1)) - 1)


def sx(v, n):
    return v - (1 << n) if v >> (n - 1) & 1 else v


class Memory:
    """Read-only view of the code and data segments, by guest address."""

    def __init__(self, segments):
        self.segments = segments   # [(address, bytes, read_only)]

    def word(self, address):
        for start, data, _ in self.segments:
            if start <= address and address + 4 <= start + len(data):
                return struct.unpack_from('<I', data, address - start)[0]
        raise Unsupported(f'{address:#x} is outside the program')

    def half(self, address):
        for start, data, _ in self.segments:
            if start <= address and address + 2 <= start + len(data):
                return struct.unpack_from('<H', data, address - start)[0]
        raise Unsupported(f'{address:#x} is outside the program')

    def constant(self, address):
        """A word the code can never change (text or rodata), or None."""
        for start, data, read_only in self.segments:
            if read_only and start <= address and address + 4 <= start + len(data):
                return struct.unpack_from('<I', data, address - start)[0]
        return None


class Insn:
    """One decoded instruction: its C, and how control leaves it."""

    def __init__(self, address, word):
        self.address, self.word = address, word
        self.c = ''
        self.flow = 'next'        # next, branch, call, return, tail, indirect, switch, stop
        self.target = None
        self.targets = []         # switch: case targets
        self.cond = None
        self.size = 4
        self.thumb = False


def reg(n, pc):
    return f'{pc+8:#x}u' if n == 15 else f'r[{n}]'


class Decoder:
    def __init__(self, memory):
        self.memory = memory

    def decode(self, address):
        if address & 1:
            return self.decode_thumb(address & ~1)
        w = self.memory.word(address)
        x = Insn(address, w)
        cond = w >> 28
        if cond == 15:
            self.unconditional(x, w)
            return x
        x.cond = COND[cond]
        kind = bits(w, 27, 25)
        if kind == 0:
            self.group0(x, w)
        elif kind == 1:
            if bits(w, 24, 23) == 2 and not bits(w, 20, 20):
                if w & 0x0fffff00 == 0x0320f000:
                    x.c = ';'   # nop, yield, wfe, wfi, sev hints
                elif bits(w, 21, 21):
                    self.msr(x, w, imm=True)
                else:
                    raise Unsupported(f'{address:#x}: movw/movt are not ARMv6 ({w:08x})')
            else:
                self.data_processing(x, w)
        elif kind == 2 or (kind == 3 and not w & 0x10):
            self.load_store(x, w)
        elif kind == 3:
            self.media(x, w)
        elif kind == 4:
            self.block(x, w)
        elif kind == 5:
            target = (address + 8 + (sx(bits(w, 23, 0), 24) << 2)) & 0xffffffff
            x.target = target
            x.flow = 'call' if bits(w, 24, 24) else 'branch'
        elif kind == 6:
            self.coprocessor_memory(x, w)
        elif bits(w, 24, 24):
            x.c = f'svc({bits(w, 23, 0):#x},{address:#x});'
        else:
            self.coprocessor(x, w)
        return x

    def unconditional(self, x, w):
        if bits(w, 27, 25) == 5:   # blx to Thumb
            x.target = ((x.address + 8 + (sx(bits(w, 23, 0), 24) << 2) + (bits(w, 24, 24) << 1)) | 1) & 0xffffffff
            x.flow = 'call'
        elif w & 0x0d70f000 == 0x0550f000 or w == 0xf57ff01f:
            x.c = ';'   # pld (a cache hint); clrex
            if w == 0xf57ff01f:
                x.c = 'exclusive=0xffffffff;'
        else:
            raise Unsupported(f'{x.address:#x}: unconditional {w:08x}')

    # Operand 2 of a data-processing instruction: (C expression of the value, of the shifter carry).
    def operand2(self, x, w):
        pc = x.address
        if bits(w, 25, 25):
            rot, imm = bits(w, 11, 8) * 2, bits(w, 7, 0)
            v = ((imm >> rot) | (imm << (32 - rot))) & 0xffffffff if rot else imm
            return f'{v:#x}u', (f'{v >> 31}' if rot else 'fc')
        rm, kind = bits(w, 3, 0), bits(w, 6, 5)
        m = reg(rm, pc)
        if bits(w, 4, 4):
            rs = bits(w, 11, 8)
            if 15 in (rm, rs):
                raise Unsupported(f'{pc:#x}: register shift with pc')
            fn = ['lsl_c', 'lsr_c', 'asr_c', 'ror_c'][kind]
            return f'{fn}({m},r[{rs}],&sc)', 'sc'
        n = bits(w, 11, 7)
        if kind == 0:
            return (m, 'fc') if n == 0 else (f'({m}<<{n})', f'(({m}>>{32-n})&1)')
        if kind == 1:
            return ('0u', f'({m}>>31)') if n == 0 else (f'({m}>>{n})', f'(({m}>>{n-1})&1)')
        if kind == 2:
            n = n or 32
            return f'(uint32_t)((int32_t){m}>>{min(n, 31)})', f'(({m}>>{n-1})&1)'
        if n == 0:
            return f'((fc<<31)|({m}>>1))', f'({m}&1)'
        return f'rotr({m},{n})', f'(({m}>>{n-1})&1)'

    def data_processing(self, x, w):
        op, s = bits(w, 24, 21), bits(w, 20, 20)
        rn, rd = bits(w, 19, 16), bits(w, 15, 12)
        b, carry = self.operand2(x, w)
        a = reg(rn, x.address)
        name = DP[op]
        if name in ('tst', 'teq', 'cmp', 'cmn') and not s:
            raise Unsupported(f'{x.address:#x}: {w:08x} in the data-processing space')
        if s and rd == 15:
            raise Unsupported(f'{x.address:#x}: flag-setting write to pc (exception return)')
        logic = {'and': f'{a}&b', 'eor': f'{a}^b', 'tst': f'{a}&b', 'teq': f'{a}^b', 'orr': f'{a}|b',
                 'mov': 'b', 'bic': f'{a}&~b', 'mvn': '~b'}
        arith = {'sub': (a, '~b', '1'), 'rsb': ('b', f'~{a}', '1'), 'add': (a, 'b', '0'), 'adc': (a, 'b', 'fc'),
                 'sbc': (a, '~b', 'fc'), 'rsc': ('b', f'~{a}', 'fc'), 'cmp': (a, '~b', '1'), 'cmn': (a, 'b', '0')}
        plain = {'sub': f'{a}-b', 'rsb': f'b-{a}', 'add': f'{a}+b', 'adc': f'{a}+b+fc', 'sbc': f'{a}-b-!fc',
                 'rsc': f'b-{a}-!fc'}
        head = '{uint32_t sc=fc;' if 'sc' in (b + carry) else '{'
        head += f'uint32_t b={b};'
        if name in logic:
            v = logic[name]
            body = f'uint32_t v={v};' + (f'logic_flags(v,{carry});' if s else '')
        else:
            p, q, c = arith[name]
            body = f'uint32_t v=add_flags({p},{q},{c});' if s else f'uint32_t v={plain[name]};'
        if name in ('tst', 'teq', 'cmp', 'cmn'):
            x.c = head + body + '(void)v;}'
            return
        if rd == 15:
            x.c = head + body + 'r[15]=v;}'
            self.write_pc(x, w, name, rn)
            return
        x.c = head + body + f'r[{rd}]=v;}}'

    def write_pc(self, x, w, name, rn):
        """mov pc, lr returns; add pc, pc, rX, lsl #2 is a jump table of branches."""
        if name == 'mov' and not bits(w, 25, 25) and bits(w, 11, 0) == 14:
            x.c, x.flow = '', 'return'
        elif name == 'add' and rn == 15 and not bits(w, 25, 25) and bits(w, 11, 4) == 0x10:
            index = bits(w, 3, 0)
            x.flow, x.c = 'switch', f'r[15]={x.address+8:#x}u+(r[{index}]<<2);'
            x.index = index
        else:
            x.c, x.flow = x.c.replace('r[15]=v;', 'r[15]=v;'), 'indirect'

    def group0(self, x, w):
        pc = x.address
        if bits(w, 7, 4) == 9 and bits(w, 24, 23) == 0:
            rd, rn, rs, rm = bits(w, 19, 16), bits(w, 15, 12), bits(w, 11, 8), bits(w, 3, 0)
            v = f'r[{rm}]*r[{rs}]' + (f'+r[{rn}]' if bits(w, 21, 21) else '')
            x.c = f'{{uint32_t v={v};r[{rd}]=v;' + ('fn=v>>31;fz=v==0;' if bits(w, 20, 20) else '') + '}'
            return
        if bits(w, 7, 4) == 9 and bits(w, 24, 23) == 1:
            hi, lo, rs, rm = bits(w, 19, 16), bits(w, 15, 12), bits(w, 11, 8), bits(w, 3, 0)
            t = 'int64_t)(int32_t' if bits(w, 22, 22) else 'uint64_t)(uint32_t'
            v = f'(uint64_t)(({t})r[{rm}]*({t})r[{rs}])'
            if bits(w, 21, 21):
                v += f'+(((uint64_t)r[{hi}]<<32)|r[{lo}])'
            x.c = f'{{uint64_t v={v};r[{lo}]=(uint32_t)v;r[{hi}]=(uint32_t)(v>>32);' + \
                ('fn=(uint32_t)(v>>63);fz=v==0;' if bits(w, 20, 20) else '') + '}'
            return
        if w & 0x0f900fff == 0x01900f9f:   # ldrex(b/h/d): one core runs the game, so a load that marks
            rt, rn, size = bits(w, 15, 12), bits(w, 19, 16), bits(w, 22, 21)
            load = {0: f'r[{rt}]=rd32(a);', 1: f'r[{rt}]=rd32(a);r[{rt+1}]=rd32(a+4);', 2: f'r[{rt}]=rd8(a);',
                    3: f'r[{rt}]=rd16(a);'}[size]
            x.c = f'{{uint32_t a=r[{rn}];{load}exclusive=a;}}'
            return
        if w & 0x0f900ff0 == 0x01800f90:   # strex(b/h/d) succeeds while the mark stands
            rd, rn, rt, size = bits(w, 15, 12), bits(w, 19, 16), bits(w, 3, 0), bits(w, 22, 21)
            store = {0: f'wr32(a,r[{rt}]);', 1: f'wr32(a,r[{rt}]);wr32(a+4,r[{rt+1}]);', 2: f'wr8(a,r[{rt}]);',
                     3: f'wr16(a,r[{rt}]);'}[size]
            x.c = f'{{uint32_t a=r[{rn}];if(exclusive==a){{{store}r[{rd}]=0;}}else r[{rd}]=1;exclusive=0xffffffff;}}'
            return
        if bits(w, 7, 7) and bits(w, 4, 4):
            self.extra_load_store(x, w)
            return
        if bits(w, 24, 23) == 2 and not bits(w, 20, 20):
            self.misc(x, w)
            return
        self.data_processing(x, w)

    def misc(self, x, w):
        op = bits(w, 7, 4)
        if w & 0x0ffffff0 == 0x012fff10:   # bx
            rm = bits(w, 3, 0)
            x.flow = 'return' if rm == 14 else 'tail'
            x.c = '' if rm == 14 else f'r[15]=r[{rm}];'
            return
        if w & 0x0ffffff0 == 0x012fff30:   # blx register
            x.c = f'r[15]=r[{bits(w, 3, 0)}];'
            x.flow = 'call'
            return
        if w & 0x0fff0ff0 == 0x016f0f10:   # clz
            rm = bits(w, 3, 0)
            x.c = f'r[{bits(w, 15, 12)}]=r[{rm}]?__builtin_clz(r[{rm}]):32;'
            return
        if op == 0 and not bits(w, 21, 21):   # mrs
            if bits(w, 22, 22):
                raise Unsupported(f'{x.address:#x}: mrs spsr')
            x.c = f'r[{bits(w, 15, 12)}]=(fn<<31)|(fz<<30)|(fc<<29)|(fv<<28)|(fq<<27)|(ge<<16)|0x10;'
            return
        if op == 0:
            self.msr(x, w, imm=False)
            return
        if op == 5:   # qadd, qsub, qdadd, qdsub
            rd, rn, rm = bits(w, 15, 12), bits(w, 19, 16), bits(w, 3, 0)
            k = bits(w, 22, 21)
            n = f'(int64_t)(int32_t)r[{rn}]'
            if k >= 2:
                n = f'(int64_t)(int32_t)signed_sat(2*{n},32,&fq)'
            v = f'(int64_t)(int32_t)r[{rm}]' + ('+' if k in (0, 2) else '-') + n
            x.c = f'r[{rd}]=signed_sat({v},32,&fq);'
            return
        if bits(w, 7, 7) and not bits(w, 4, 4):   # signed 16-bit multiplies
            self.halfword_multiply(x, w)
            return
        raise Unsupported(f'{x.address:#x}: misc {w:08x}')

    def msr(self, x, w, imm):
        if bits(w, 22, 22):
            raise Unsupported(f'{x.address:#x}: msr spsr')
        mask = bits(w, 19, 16)
        if mask & ~0x8 and mask != 0xc:
            raise Unsupported(f'{x.address:#x}: msr to control bits')
        if imm:
            rot, v = bits(w, 11, 8) * 2, bits(w, 7, 0)
            v = f'{((v >> rot) | (v << (32 - rot))) & 0xffffffff if rot else v:#x}u'
        else:
            v = f'r[{bits(w, 3, 0)}]'
        x.c = f'{{uint32_t v={v};fn=v>>31;fz=(v>>30)&1;fc=(v>>29)&1;fv=(v>>28)&1;fq=(v>>27)&1;' + \
            ('ge=(v>>16)&15;' if mask & 4 else '') + '}'

    def halfword_multiply(self, x, w):
        rd, rn, rs, rm = bits(w, 19, 16), bits(w, 15, 12), bits(w, 11, 8), bits(w, 3, 0)
        op, xb, yb = bits(w, 22, 21), bits(w, 5, 5), bits(w, 6, 6)
        half = lambda r_, top: f'(int32_t)(int16_t)(r[{r_}]>>{16 if top else 0})'
        if op == 0:   # smlaxy
            x.c = f'{{int64_t p=(int64_t){half(rm, xb)}*{half(rs, yb)};int64_t v=p+(int32_t)r[{rn}];' \
                  f'if(v!=(int32_t)v)fq=1;r[{rd}]=(uint32_t)v;}}'
        elif op == 1:   # smlawy / smulwy
            p = f'(uint32_t)(((int64_t)(int32_t)r[{rm}]*{half(rs, yb)})>>16)'
            if xb:
                x.c = f'r[{rd}]={p};'
            else:
                x.c = f'{{int64_t v=(int64_t)(int32_t){p}+(int32_t)r[{rn}];if(v!=(int32_t)v)fq=1;r[{rd}]=(uint32_t)v;}}'
        elif op == 2:   # smlalxy
            x.c = f'{{uint64_t v=(((uint64_t)r[{rd}]<<32)|r[{rn}])+(uint64_t)(int64_t)({half(rm, xb)}*{half(rs, yb)});' \
                  f'r[{rn}]=(uint32_t)v;r[{rd}]=(uint32_t)(v>>32);}}'
        else:   # smulxy
            x.c = f'r[{rd}]=(uint32_t)({half(rm, xb)}*{half(rs, yb)});'

    def address(self, x, w, offset):
        """Effective address and base write-back of a load or store: (address expr, base update or '')."""
        rn = bits(w, 19, 16)
        p, u, wb = bits(w, 24, 24), bits(w, 23, 23), bits(w, 21, 21)
        base = reg(rn, x.address)
        sign = '+' if u else '-'
        if p:
            ea = f'{base}{sign}{offset}'
            update = f'r[{rn}]=ea;' if wb else ''
        else:
            ea = base
            update = f'r[{rn}]={base}{sign}{offset};'
        if update and rn == 15:
            raise Unsupported(f'{x.address:#x}: write-back to pc')
        return ea, update

    def load_store(self, x, w):
        load, byte = bits(w, 20, 20), bits(w, 22, 22)
        rd, rn = bits(w, 15, 12), bits(w, 19, 16)
        if not bits(w, 24, 24) and bits(w, 21, 21):
            raise Unsupported(f'{x.address:#x}: ldrt/strt')
        if bits(w, 25, 25):
            m, carry = self.operand2(x, (w & ~(1 << 25)) & ~0x10)
            offset = f'({m})'
        else:
            offset = f'{bits(w, 11, 0)}u'
        ea, update = self.address(x, w, offset)
        if rn == 15 and not bits(w, 25, 25) and load and not byte:
            value = self.memory.constant(eval(ea.replace('u', '')))
            if value is not None:
                if rd == 15:   # ldr pc, =target: a long-branch veneer
                    if x.cond is not None:
                        raise Unsupported(f'{x.address:#x}: conditional veneer')
                    x.flow, x.target = 'veneer', value
                    return
                x.c = f'r[{rd}]={value:#x}u;'
                return
        if load and rd == 15 and rn == 15 and not byte and bits(w, 25, 25) and bits(w, 24, 23) == 3 \
                and not bits(w, 21, 21) and bits(w, 11, 4) == 0x10:
            # ldr pc, [pc, rX, lsl #2]: ARMCC's jump table of addresses right after the default branch.
            x.flow, x.index, x.table = 'switch', bits(w, 3, 0), x.address + 8
            x.c = f'r[15]=rd32({x.address+8:#x}u+(r[{bits(w, 3, 0)}]<<2));'
            return
        size = 'rd8' if byte else 'rd32'
        if load:
            if rd == 15:
                x.c = f'{{uint32_t ea={ea};uint32_t v={size}(ea);{update}r[15]=v;}}'
                x.flow = 'return' if rn == 13 and bits(w, 23, 23) and not bits(w, 24, 24) else 'indirect'
            elif rd == rn and update:
                x.c = f'{{uint32_t ea={ea};uint32_t v={size}(ea);{update}r[{rd}]=v;}}'
            else:
                x.c = f'{{uint32_t ea={ea};{update}r[{rd}]={size}(ea);}}'
        else:
            value = reg(rd, x.address)
            if rd == 15:
                value = f'{x.address+12:#x}u'   # ARM11 stores pc+8; kept as the architecture's value
                value = f'{x.address+8:#x}u'
            x.c = f'{{uint32_t ea={ea};{"wr8" if byte else "wr32"}(ea,{value});{update}}}'

    def extra_load_store(self, x, w):
        sh, load = bits(w, 6, 5), bits(w, 20, 20)
        rd, rn = bits(w, 15, 12), bits(w, 19, 16)
        if sh == 0:
            raise Unsupported(f'{x.address:#x}: swp or multiply form {w:08x}')
        if bits(w, 22, 22):
            offset = f'{(bits(w, 11, 8) << 4) | bits(w, 3, 0)}u'
        else:
            offset = reg(bits(w, 3, 0), x.address)
        if not bits(w, 24, 24) and bits(w, 21, 21):
            raise Unsupported(f'{x.address:#x}: unpredictable post-index write-back')
        ea, update = self.address(x, w, offset)
        if 15 in (rd,):
            raise Unsupported(f'{x.address:#x}: halfword transfer with pc')
        if load:
            op = {1: 'rd16', 2: '(uint32_t)(int8_t)rd8', 3: '(uint32_t)(int16_t)rd16'}[sh]
            if rd == rn and update:
                x.c = f'{{uint32_t ea={ea};uint32_t v={op}(ea);{update}r[{rd}]=v;}}'
            else:
                x.c = f'{{uint32_t ea={ea};{update}r[{rd}]={op}(ea);}}'
        elif sh == 1:
            x.c = f'{{uint32_t ea={ea};wr16(ea,r[{rd}]);{update}}}'
        elif sh == 2:   # ldrd
            if rd & 1:
                raise Unsupported(f'{x.address:#x}: ldrd with an odd register')
            x.c = f'{{uint32_t ea={ea};uint32_t a=rd32(ea),b=rd32(ea+4);{update}r[{rd}]=a;r[{rd+1}]=b;}}'
        else:   # strd
            if rd & 1:
                raise Unsupported(f'{x.address:#x}: strd with an odd register')
            x.c = f'{{uint32_t ea={ea};wr32(ea,r[{rd}]);wr32(ea+4,r[{rd+1}]);{update}}}'

    def block(self, x, w):
        p, u, s, wb, load = (bits(w, i, i) for i in (24, 23, 22, 21, 20))
        rn, regs = bits(w, 19, 16), [i for i in range(16) if w >> i & 1]
        if s:
            raise Unsupported(f'{x.address:#x}: ldm/stm with user registers')
        if not regs or rn == 15:
            raise Unsupported(f'{x.address:#x}: ldm/stm {w:08x}')
        n = len(regs) * 4
        start = {(0, 1): '0', (1, 1): '4', (0, 0): f'-{n-4}', (1, 0): f'-{n}'}[(p, u)]
        end = f'+{n}' if u else f'-{n}'
        parts = [f'{{uint32_t ea=r[{rn}]+({start});']
        for i, rr in enumerate(regs):
            if load:
                parts.append(f'uint32_t v{rr}=rd32(ea+{i*4});')
            else:
                value = f'{x.address+8:#x}u' if rr == 15 else f'r[{rr}]'
                parts.append(f'wr32(ea+{i*4},{value});')
        if wb and not (load and rn in regs):
            parts.append(f'r[{rn}]+={end[0]}{n};' if end[0] == '+' else f'r[{rn}]-={n};')
        if load:
            parts.extend(f'r[{rr}]=v{rr};' for rr in regs)
        parts.append('}')
        x.c = ''.join(parts)
        if load and 15 in regs:
            x.flow = 'return' if rn == 13 else 'indirect'

    def media(self, x, w):
        op1, op2 = bits(w, 24, 20), bits(w, 7, 5)
        rd, rn, rm = bits(w, 15, 12), bits(w, 19, 16), bits(w, 3, 0)
        if bits(w, 24, 23) == 1 and op2 == 3 and bits(w, 9, 8) == 0:   # sxtb, sxth, uxtb, uxth (+add)
            u, size = bits(w, 22, 22), bits(w, 21, 20)
            rot = bits(w, 11, 10) * 8
            v = f'rotr(r[{rm}],{rot})' if rot else f'r[{rm}]'
            ext = {(0, 2): '(uint32_t)(int32_t)(int8_t)', (0, 3): '(uint32_t)(int32_t)(int16_t)',
                   (1, 2): '(uint32_t)(uint8_t)', (1, 3): '(uint32_t)(uint16_t)'}.get((u, size))
            if ext is None:
                raise Unsupported(f'{x.address:#x}: packed extend {w:08x}')
            add = '' if rn == 15 else f'r[{rn}]+'
            x.c = f'r[{rd}]={add}{ext}({v});'
            return
        if bits(w, 27, 23) == 0xC and bits(w, 22, 20) in (1, 2, 3, 5, 6, 7) and bits(w, 11, 8) == 15 \
                and op2 in (0, 1, 2, 3, 4, 7):   # parallel add/subtract
            x.c = f'r[{rd}]=parallel({bits(w, 22, 20)},{op2},r[{rn}],r[{rm}]);'
            return
        if bits(w, 27, 20) == 0x68 and bits(w, 5, 4) == 1:   # pkhbt, pkhtb
            sh = bits(w, 11, 7)
            if bits(w, 6, 6):
                m = f'(uint32_t)((int32_t)r[{rm}]>>{min(sh or 32, 31)})'
                x.c = f'r[{rd}]=(r[{rn}]&0xffff0000u)|({m}&0xffffu);'
            else:
                x.c = f'r[{rd}]=(r[{rn}]&0xffffu)|((r[{rm}]<<{sh})&0xffff0000u);'
            return
        if w & 0x0ff00ff0 == 0x06800fb0:   # sel: bytes from rn where GE is set, else rm
            x.c = f'{{uint32_t m=(ge&1?0xffu:0)|(ge&2?0xff00u:0)|(ge&4?0xff0000u:0)|(ge&8?0xff000000u:0);' \
                  f'r[{rd}]=(r[{rn}]&m)|(r[{rm}]&~m);}}'
            return
        if w & 0x0fff0ff0 == 0x06bf0f30:
            x.c = f'r[{rd}]=__builtin_bswap32(r[{rm}]);'
            return
        if w & 0x0fff0ff0 == 0x06bf0fb0:
            x.c = f'r[{rd}]=((r[{rm}]&0x00ff00ffu)<<8)|((r[{rm}]>>8)&0x00ff00ffu);'
            return
        if w & 0x0fff0ff0 == 0x06ff0fb0:
            x.c = f'r[{rd}]=(uint32_t)(int32_t)(int16_t)((r[{rm}]<<8)|((r[{rm}]>>8)&0xff));'
            return
        if bits(w, 27, 21) in (0x35, 0x37) and not bits(w, 5, 5):   # ssat, usat
            sat = bits(w, 20, 16)
            sh = bits(w, 11, 7)
            v = f'(int64_t)(int32_t)r[{rm}]' + (f'>>{sh or 32 if sh else 0}' if bits(w, 6, 6) else (f'<<{sh}' if sh else ''))
            if bits(w, 6, 6):
                v = f'((int64_t)(int32_t)r[{rm}]>>{min(sh or 32, 31)})'
            fn_ = 'unsigned_sat' if bits(w, 22, 22) else 'signed_sat'
            width = sat if bits(w, 22, 22) else sat + 1
            x.c = f'r[{rd}]={fn_}({v},{width},&fq);'
            return
        raise Unsupported(f'{x.address:#x}: media {w:08x}')

    # VFP (cp10 single, cp11 double) and the CP15 thread pointer.
    def coprocessor_memory(self, x, w):
        cp = bits(w, 11, 8)
        if cp not in (10, 11):
            raise Unsupported(f'{x.address:#x}: coprocessor {cp} transfer')
        p, u, d, wb, load = (bits(w, i, i) for i in (24, 23, 22, 21, 20))
        rn, vd, imm = bits(w, 19, 16), bits(w, 15, 12), bits(w, 7, 0)
        double = cp == 11
        if bits(w, 24, 21) == 2:   # vmov between two core registers and two singles or one double
            rt, rt2, vm, m = bits(w, 15, 12), bits(w, 19, 16), bits(w, 3, 0), bits(w, 5, 5)
            if double:
                x.c = f'{{uint64_t v=vfp.ud[{vm}];r[{rt}]=(uint32_t)v;r[{rt2}]=(uint32_t)(v>>32);}}' if load else \
                    f'vfp.ud[{vm}]=((uint64_t)r[{rt2}]<<32)|r[{rt}];'
            else:
                s = vm << 1 | m
                x.c = f'r[{rt}]=vfp.u[{s}];r[{rt2}]=vfp.u[{s+1}];' if load else f'vfp.u[{s}]=r[{rt}];vfp.u[{s+1}]=r[{rt2}];'
            return
        first = vd if double else (vd << 1 | d)
        if double and d:
            raise Unsupported(f'{x.address:#x}: d16-d31 (VFPv3)')
        base = reg(rn, x.address)
        if p and not wb:   # vldr / vstr
            ea = f'{base}{"+" if u else "-"}{imm*4}u'
            if double:
                x.c = f'vfp.ud[{first}]=rd64({ea});' if load else f'wr64({ea},vfp.ud[{first}]);'
            else:
                x.c = f'vfp.u[{first}]=rd32({ea});' if load else f'wr32({ea},vfp.u[{first}]);'
            return
        count = imm // 2 if double else imm
        if (p, u) not in ((0, 1), (1, 0)) or rn == 15 or not count:
            raise Unsupported(f'{x.address:#x}: vldm/vstm {w:08x}')
        size = imm * 4
        parts = [f'{{uint32_t ea=r[{rn}]' + ('' if u else f'-{size}u') + ';']
        for i in range(count):
            if double:
                parts.append(f'vfp.ud[{first+i}]=rd64(ea+{i*8});' if load else f'wr64(ea+{i*8},vfp.ud[{first+i}]);')
            else:
                parts.append(f'vfp.u[{first+i}]=rd32(ea+{i*4});' if load else f'wr32(ea+{i*4},vfp.u[{first+i}]);')
        if wb:
            parts.append(f'r[{rn}]{"+" if u else "-"}={size}u;')
        parts.append('}')
        x.c = ''.join(parts)

    def coprocessor(self, x, w):
        cp = bits(w, 11, 8)
        if cp == 15:
            if w & 0x0fff0fff == 0x0e1d0f70:   # mrc p15, 0, rX, c13, c0, 3: the thread pointer
                x.c = f'r[{bits(w, 15, 12)}]=tls();'
                return
            if w & 0x0f100f10 == 0x0e000f10 and bits(w, 3, 0) in (10, 5) and bits(w, 19, 16) == 7:
                x.c = ';'   # mcr p15 c7 barriers (data memory/synchronization barrier)
                return
            raise Unsupported(f'{x.address:#x}: cp15 {w:08x}')
        if cp not in (10, 11):
            raise Unsupported(f'{x.address:#x}: coprocessor {cp}')
        double = cp == 11
        if bits(w, 4, 4):
            self.vfp_transfer(x, w, double)
        else:
            self.vfp_data(x, w, double)

    def vfp_transfer(self, x, w, double):
        load, rt = bits(w, 20, 20), bits(w, 15, 12)
        op = bits(w, 23, 21)
        if op == 7:   # vmrs / vmsr
            if bits(w, 19, 16) != 1:
                raise Unsupported(f'{x.address:#x}: vmrs/vmsr system register {bits(w, 19, 16)}')
            if load:
                x.c = 'vfp_status();' if rt == 15 else f'r[{rt}]=fpscr;'
            else:
                x.c = f'fpscr=r[{rt}];'
            return
        n = bits(w, 19, 16)
        if not double and op == 0:
            s = n << 1 | bits(w, 7, 7)
            x.c = f'r[{rt}]=vfp.u[{s}];' if load else f'vfp.u[{s}]=r[{rt}];'
            return
        if double and op in (0, 1):
            half = n * 2 + op
            x.c = f'r[{rt}]=vfp.u[{half}];' if load else f'vfp.u[{half}]=r[{rt}];'
            return
        raise Unsupported(f'{x.address:#x}: vfp transfer {w:08x}')

    def vfp_data(self, x, w, double):
        p, q, r_, s = bits(w, 23, 23), bits(w, 21, 21), bits(w, 20, 20), bits(w, 6, 6)
        vd, vn, vm = bits(w, 15, 12), bits(w, 19, 16), bits(w, 3, 0)
        D, N, M = bits(w, 22, 22), bits(w, 7, 7), bits(w, 5, 5)
        op_ = p << 3 | q << 2 | r_ << 1 | s
        ext_ = vn << 1 | N
        # Which operands are doubles: conversions mix sizes (to or from a single or an integer).
        single_d = op_ == 15 and ext_ in (15, 24, 25, 26, 27)
        single_m = op_ == 15 and ext_ in (16, 17)
        if double and ((D and not single_d) or (M and not single_m) or (N and op_ != 15)):
            raise Unsupported(f'{x.address:#x}: d16-d31 (VFPv3)')
        if bits(w, 9, 9) != 1 or bits(w, 4, 4):
            raise Unsupported(f'{x.address:#x}: vfp {w:08x}')
        if double:
            fd, fn_, fm = f'vfp.d[{vd}]', f'vfp.d[{vn}]', f'vfp.d[{vm}]'
            if single_m:
                fm = f'vfp.s[{vm << 1 | M}]'
            cast = ''
        else:
            fd, fn_, fm = f'vfp.s[{vd << 1 | D}]', f'vfp.s[{vn << 1 | N}]', f'vfp.s[{vm << 1 | M}]'
            cast = '(float)'
        op = p << 3 | q << 2 | r_ << 1 | s
        products = {0: f'{fd}+{cast}({fn_}*{fm})', 1: f'{fd}-{cast}({fn_}*{fm})',
                    2: f'-{fd}+{cast}({fn_}*{fm})', 3: f'-{fd}-{cast}({fn_}*{fm})',
                    4: f'{fn_}*{fm}', 5: f'-({fn_}*{fm})', 6: f'{fn_}+{fm}', 7: f'{fn_}-{fm}', 8: f'{fn_}/{fm}'}
        if op in products:
            x.c = f'{fd}={cast}({products[op]});'
            return
        if op != 15:
            raise Unsupported(f'{x.address:#x}: vfp op {op}')
        ext = vn << 1 | N
        sd = f'vfp.u[{vd << 1 | D}]'
        sm = f'vfp.u[{vm << 1 | M}]'
        if ext == 0:
            x.c = f'{fd}={fm};'
        elif ext == 1:
            x.c = f'{fd}={"fabs" if double else "fabsf"}({fm});'
        elif ext == 2:
            x.c = f'{fd}=-{fm};'
        elif ext == 3:
            x.c = f'{fd}={"sqrt" if double else "sqrtf"}({fm});'
        elif ext in (8, 9):
            x.c = f'vfp_compare({fd},{fm});'
        elif ext in (10, 11):
            x.c = f'vfp_compare({fd},0.0);'
        elif ext == 15:   # vcvt between precisions: the destination is the other size
            if double:
                x.c = f'vfp.s[{vd << 1 | D}]=(float)vfp.d[{vm}];'
            else:
                x.c = f'vfp.d[{vd}]=(double)vfp.s[{vm << 1 | M}];'
        elif ext in (16, 17):
            src = f'(int32_t){sm}' if ext == 17 else sm
            x.c = f'{fd}={cast}({src});'
        elif ext in (24, 25, 26, 27):
            fn2 = 'vfp_to_u32' if ext < 26 else 'vfp_to_s32'
            x.c = f'{sd}={fn2}({fm},{0 if ext & 1 else 1});'
        else:
            raise Unsupported(f'{x.address:#x}: vfp extension {ext}')

    # Thumb (ARMv6: 16-bit instructions plus the BL/BLX pair). Outside IT blocks (there are none in
    # ARMv6) every low-register data operation sets the flags.
    def decode_thumb(self, address):
        h = self.memory.half(address)
        x = Insn(address, h)
        x.thumb = True
        x.size = 2
        pc = address + 4
        lo = lambda n: f'r[{n}]'
        top5, top6 = h >> 11, h >> 10
        if top5 in (0, 1, 2):   # lsl, lsr, asr by an immediate
            rd, rm, n = h & 7, (h >> 3) & 7, (h >> 6) & 31
            m = f'r[{rm}]'
            if top5 == 0:
                v, c = (m, 'fc') if n == 0 else (f'({m}<<{n})', f'(({m}>>{32-n})&1)')
            elif top5 == 1:
                v, c = ('0u', f'({m}>>31)') if n == 0 else (f'({m}>>{n})', f'(({m}>>{n-1})&1)')
            else:
                n = n or 32
                v, c = f'(uint32_t)((int32_t){m}>>{min(n, 31)})', f'(({m}>>{n-1})&1)'
            x.c = f'{{uint32_t c={c},v={v};logic_flags(v,c);r[{rd}]=v;}}'
        elif top5 == 3:   # add/sub register or 3-bit immediate
            rd, rn, val = h & 7, (h >> 3) & 7, (h >> 6) & 7
            b = f'{val}u' if h & 0x400 else f'r[{val}]'
            x.c = f'r[{rd}]=add_flags(r[{rn}],~({b}),1);' if h & 0x200 else f'r[{rd}]=add_flags(r[{rn}],{b},0);'
        elif top5 in (4, 5, 6, 7):   # mov, cmp, add, sub with an 8-bit immediate
            rd, imm = (h >> 8) & 7, h & 0xff
            x.c = {4: f'r[{rd}]={imm}u;fn=0;fz={int(imm == 0)};',
                   5: f'add_flags(r[{rd}],~{imm}u,1);',
                   6: f'r[{rd}]=add_flags(r[{rd}],{imm}u,0);',
                   7: f'r[{rd}]=add_flags(r[{rd}],~{imm}u,1);'}[top5]
        elif top6 == 0x10:   # data processing between low registers
            op, rm, rd = (h >> 6) & 15, (h >> 3) & 7, h & 7
            d, m = f'r[{rd}]', f'r[{rm}]'
            x.c = {0: f'{{uint32_t v={d}&{m};logic_flags(v,fc);{d}=v;}}',
                   1: f'{{uint32_t v={d}^{m};logic_flags(v,fc);{d}=v;}}',
                   2: f'{{uint32_t c=fc,v=lsl_c({d},{m},&c);logic_flags(v,c);{d}=v;}}',
                   3: f'{{uint32_t c=fc,v=lsr_c({d},{m},&c);logic_flags(v,c);{d}=v;}}',
                   4: f'{{uint32_t c=fc,v=asr_c({d},{m},&c);logic_flags(v,c);{d}=v;}}',
                   5: f'{d}=add_flags({d},{m},fc);',
                   6: f'{d}=add_flags({d},~{m},fc);',
                   7: f'{{uint32_t c=fc,v=ror_c({d},{m},&c);logic_flags(v,c);{d}=v;}}',
                   8: f'logic_flags({d}&{m},fc);',
                   9: f'{d}=add_flags(0,~{m},1);',
                   10: f'add_flags({d},~{m},1);',
                   11: f'add_flags({d},{m},0);',
                   12: f'{{uint32_t v={d}|{m};logic_flags(v,fc);{d}=v;}}',
                   13: f'{{uint32_t v={d}*{m};fn=v>>31;fz=v==0;{d}=v;}}',
                   14: f'{{uint32_t v={d}&~{m};logic_flags(v,fc);{d}=v;}}',
                   15: f'{{uint32_t v=~{m};logic_flags(v,fc);{d}=v;}}'}[op]
        elif top6 == 0x11:   # high registers: add, cmp, mov, bx, blx
            op = (h >> 8) & 3
            rm = (h >> 3) & 15
            rd = (h & 7) | ((h >> 4) & 8)
            m = f'{pc:#x}u' if rm == 15 else f'r[{rm}]'
            if op == 3:
                if h & 0x80:
                    x.c, x.flow = f'r[15]={m};', 'call'
                else:
                    x.flow = 'return' if rm == 14 else 'tail'
                    x.c = '' if rm == 14 else f'r[15]={m};'
            elif op == 1:
                x.c = f'add_flags(r[{rd}],~{m},1);'
            elif rd == 15:
                if op == 2 and rm == 14:
                    x.c, x.flow = '', 'return'
                else:
                    x.c, x.flow = f'r[15]=({pc:#x}u+{m})|1;' if op == 0 else f'r[15]={m}|1;', 'indirect'
                    if op == 0:
                        raise Unsupported(f'{address:#x}: add pc, register (Thumb jump table)')
            else:
                d = f'r[{rd}]'
                x.c = f'{d}={d}+{m};' if op == 0 else f'{d}={m};'
        elif top5 == 9:   # ldr literal
            a = ((pc & ~3) + (h & 0xff) * 4)
            v = self.memory.constant(a)
            x.c = f'r[{(h >> 8) & 7}]=' + (f'{v:#x}u;' if v is not None else f'rd32({a:#x}u);')
        elif h >> 12 == 5:   # register offset loads and stores
            op, rm, rn, rt = (h >> 9) & 7, (h >> 6) & 7, (h >> 3) & 7, h & 7
            ea = f'r[{rn}]+r[{rm}]'
            x.c = {0: f'wr32({ea},r[{rt}]);', 1: f'wr16({ea},r[{rt}]);', 2: f'wr8({ea},r[{rt}]);',
                   3: f'r[{rt}]=(uint32_t)(int8_t)rd8({ea});', 4: f'r[{rt}]=rd32({ea});',
                   5: f'r[{rt}]=rd16({ea});', 6: f'r[{rt}]=rd8({ea});',
                   7: f'r[{rt}]=(uint32_t)(int16_t)rd16({ea});'}[op]
        elif h >> 13 == 3:   # word/byte with a 5-bit immediate
            byte, load, imm, rn, rt = (h >> 12) & 1, (h >> 11) & 1, (h >> 6) & 31, (h >> 3) & 7, h & 7
            ea = f'r[{rn}]+{imm if byte else imm * 4}u'
            x.c = (f'r[{rt}]={"rd8" if byte else "rd32"}({ea});' if load else f'{"wr8" if byte else "wr32"}({ea},r[{rt}]);')
        elif h >> 12 == 8:   # halfword with a 5-bit immediate
            load, imm, rn, rt = (h >> 11) & 1, (h >> 6) & 31, (h >> 3) & 7, h & 7
            ea = f'r[{rn}]+{imm * 2}u'
            x.c = f'r[{rt}]=rd16({ea});' if load else f'wr16({ea},r[{rt}]);'
        elif h >> 12 == 9:   # sp-relative
            load, rt, imm = (h >> 11) & 1, (h >> 8) & 7, (h & 0xff) * 4
            x.c = f'r[{rt}]=rd32(r[13]+{imm}u);' if load else f'wr32(r[13]+{imm}u,r[{rt}]);'
        elif h >> 12 == 10:   # add rd, pc/sp, imm
            rd, imm = (h >> 8) & 7, (h & 0xff) * 4
            x.c = f'r[{rd}]=r[13]+{imm}u;' if h & 0x800 else f'r[{rd}]={(pc & ~3) + imm:#x}u;'
        elif h >> 12 == 11:
            self.thumb_misc(x, h)
        elif h >> 12 == 12:   # stmia / ldmia rn!
            load, rn = (h >> 11) & 1, (h >> 8) & 7
            regs = [i for i in range(8) if h >> i & 1]
            parts = [f'{{uint32_t ea=r[{rn}];']
            for i, rr in enumerate(regs):
                parts.append(f'uint32_t v{rr}=rd32(ea+{i*4});' if load else f'wr32(ea+{i*4},r[{rr}]);')
            if not (load and rn in regs):
                parts.append(f'r[{rn}]=ea+{len(regs) * 4}u;')
            if load:
                parts.extend(f'r[{rr}]=v{rr};' for rr in regs)
            x.c = ''.join(parts) + '}'
        elif h >> 12 == 13:
            cond = (h >> 8) & 15
            if cond == 15:
                x.c = f'svc({h & 0xff:#x},{address:#x});'
            elif cond == 14:
                raise Unsupported(f'{address:#x}: Thumb undefined {h:04x}')
            else:
                x.cond, x.flow = COND[cond], 'branch'
                x.target = pc + (sx(h & 0xff, 8) << 1)
        elif top5 == 0x1c:   # b
            x.flow, x.target = 'branch', pc + (sx(h & 0x7ff, 11) << 1)
        elif top5 == 0x1e:   # bl / blx: a pair of halves
            low = self.memory.half(address + 2)
            offset = sx(((h & 0x7ff) << 12) | ((low & 0x7ff) << 1), 23)
            x.size, x.flow = 4, 'call'
            if low >> 11 == 0x1f:
                x.target = (pc + offset) | 1
            elif low >> 11 == 0x1d:
                x.target = (pc + offset) & ~3   # blx to ARM
            else:
                raise Unsupported(f'{address:#x}: Thumb bl pair {h:04x} {low:04x}')
        else:
            raise Unsupported(f'{address:#x}: Thumb {h:04x}')
        return x

    def thumb_misc(self, x, h):
        op = (h >> 8) & 15
        if op == 0:   # add/sub sp, imm7
            imm = (h & 0x7f) * 4
            x.c = f'r[13]-={imm}u;' if h & 0x80 else f'r[13]+={imm}u;'
        elif op == 2:   # sxth, sxtb, uxth, uxtb
            rm, rd = (h >> 3) & 7, h & 7
            x.c = f'r[{rd}]=' + ['(uint32_t)(int32_t)(int16_t)', '(uint32_t)(int32_t)(int8_t)',
                                 '(uint32_t)(uint16_t)', '(uint32_t)(uint8_t)'][(h >> 6) & 3] + f'(r[{rm}]);'
        elif op in (4, 5):   # push {..., lr}
            regs = [i for i in range(8) if h >> i & 1] + ([14] if h & 0x100 else [])
            n = len(regs) * 4
            x.c = f'{{uint32_t ea=r[13]-{n}u;' + ''.join(f'wr32(ea+{i*4},r[{rr}]);' for i, rr in enumerate(regs)) + 'r[13]=ea;}'
        elif op in (12, 13):   # pop {..., pc}
            regs = [i for i in range(8) if h >> i & 1]
            pc_ = bool(h & 0x100)
            n = (len(regs) + pc_) * 4
            x.c = '{uint32_t ea=r[13];' + ''.join(f'r[{rr}]=rd32(ea+{i*4});' for i, rr in enumerate(regs)) + \
                (f'r[15]=rd32(ea+{len(regs)*4});' if pc_ else '') + f'r[13]=ea+{n}u;}}'
            if pc_:
                x.flow = 'return'
        elif op == 10 and ((h >> 6) & 3) != 2:   # rev, rev16, revsh
            rm, rd, k = (h >> 3) & 7, h & 7, (h >> 6) & 3
            x.c = {0: f'r[{rd}]=__builtin_bswap32(r[{rm}]);',
                   1: f'r[{rd}]=((r[{rm}]&0x00ff00ffu)<<8)|((r[{rm}]>>8)&0x00ff00ffu);',
                   3: f'r[{rd}]=(uint32_t)(int32_t)(int16_t)((r[{rm}]<<8)|((r[{rm}]>>8)&0xff));'}[k]
        elif h == 0xbf00 or h & 0xff0f == 0xbf00:
            x.c = ';'   # nop and hints
        else:
            raise Unsupported(f'{x.address:#x}: Thumb misc {h:04x}')



def find_functions(decoder, entries, stop=()):
    """Follow control flow from each entry. Returns {entry: {address: Insn}} and the targets of
    calls found (functions not translated, for the dispatcher to report)."""
    functions, pending, external = {}, list(entries), set()
    stop, callers = set(stop) | set(RUNTIME), {}
    while pending:
        entry = pending.pop()
        try:
            found = follow(decoder, entry, functions, pending, entries, stop, external, callers)
        except Unsupported as e:
            chain, at = [], entry
            while at in callers and len(chain) < 12:
                chain.append(f'{at:#x}')
                at = callers[at]
            chain.append(f'{at:#x}')
            raise Unsupported(f'{e} (called from {" <- ".join(chain)})') from None
        if found is not None:
            functions[entry] = found
    return functions, external


def follow(decoder, entry, functions, pending, entries, stop, external, callers):
    """One function's body: {address: Insn}, keyed by even addresses. Odd entries are Thumb."""
    def queue(target):
        callers.setdefault(target, entry)
        pending.append(target)
    if entry in functions or entry in stop:
        return None
    thumb = entry & 1
    mode = lambda a: a | thumb   # a branch keeps the instruction set; its function key carries it
    body, work = {}, [entry & ~1]
    while work:
        pc = work.pop()
        while pc not in body:
            x = decoder.decode(pc | thumb)
            body[pc] = x
            if x.flow == 'branch':
                key = mode(x.target)
                if key in functions or key in entries or key in stop:
                    x.flow, x.target = 'tailcall', key
                    if key not in functions and key not in stop:
                        queue(key)
                else:
                    work.append(x.target)
            elif x.flow == 'call' and x.target is not None:
                if x.target not in stop:
                    queue(x.target)
                if not x.target & 1 and decoder.memory.word(x.target) & 0xffff0fff == 0xe49e0004:
                    # The ARM compiler's float helpers read an argument word placed right after
                    # the call (ldr rX, [lr], #4) and return past it.
                    x.inline = True
                    pc += 4
            elif x.flow == 'veneer':
                x.flow = 'tailcall'
                if x.target not in stop:
                    queue(x.target)
            elif x.flow == 'tail' and not thumb and x.word == 0xe12fff1c and body.get(pc - 4) is not None \
                    and body[pc - 4].word == 0xe28fc001:
                # ARM-to-Thumb veneer: add ip, pc, #1; bx ip.
                x.flow, x.target, x.c = 'tailcall', (pc + 4) | 1, ''
                queue(x.target)
            elif x.flow == 'switch':
                # add pc, pc, rX, lsl #2 after cmp rX, #n and a conditional bound: the table is
                # the branch after it (the default) and n branches after that. ldr pc, [pc, rX,
                # lsl #2] reads n addresses from there instead.
                count = switch_cases(body, pc, x.index)
                if getattr(x, 'table', None):
                    x.targets = sorted({decoder.memory.word(x.table + 4 * i) for i in range(count)})
                else:
                    x.targets = [pc + 8 + 4 * i for i in range(count)]
                work.extend(x.targets)
                work.append(pc + 4)
            target = code_pointer(decoder.memory, body, pc, x)
            if target is not None and target not in stop:
                queue(target)
            if x.flow in ('return', 'tail', 'indirect', 'switch', 'branch', 'tailcall') and x.cond is None:
                break
            pc += x.size
    return body


def code_pointer(memory, body, pc, x):
    """A function address built position-independently: ldr rX, =offset then add rX, pc (Thumb) or
    add rX, pc, rX (ARM), as the C library does for callbacks. The function is translated too."""
    if x.thumb:
        if x.word & 0xff78 != 0x4478:
            return None
        rd = (x.word & 7) | (x.word >> 4 & 8)
        loads = ((at, body.get(at)) for at in range(pc - 2, pc - 18, -2))
        literal = lambda at, y: y.thumb and y.word >> 8 == 0x48 | rd and ((at + 4) & ~3) + (y.word & 0xff) * 4
    else:
        if x.word & 0x0fff0ff0 != 0x008f0000 or bits(x.word, 15, 12) != bits(x.word, 3, 0) or x.cond:
            return None
        rd = bits(x.word, 15, 12)
        loads = ((at, body.get(at)) for at in range(pc - 4, pc - 36, -4))
        literal = lambda at, y: not y.thumb and y.word & 0x0fff0000 == 0x059f0000 and bits(y.word, 15, 12) == rd \
            and at + 8 + (y.word & 0xfff)
    for at, y in loads:
        if y is None:
            return None
        address = literal(at, y)
        if address:
            target = (memory.word(address) + pc + (4 if x.thumb else 8)) & 0xffffffff
            start, data, _ = memory.segments[0]
            ok = start <= target < start + len(data) and (target & 1 or not x.thumb and not target & 3)
            return target if ok else None
    return None


def switch_cases(body, pc, index):
    """The table's size: the bound of the cmp rX, #n that set the flags the jump tests (the jump is
    conditional on rX being below n, unsigned). The compiler can schedule other work in between."""
    for back in range(1, 33):
        prior = body.get(pc - 4 * back)
        if prior is None or prior.thumb:
            break
        w = prior.word
        if w & 0x0ff00000 == 0x03500000 and bits(w, 19, 16) == index:
            rot, imm = bits(w, 11, 8) * 2, bits(w, 7, 0)
            n = ((imm >> rot) | (imm << (32 - rot))) & 0xffffffff if rot else imm
            return n + 1 if body[pc].cond == '(!fc||fz)' else n   # ls: up to n; cc: below n
        sets_flags = (bits(w, 27, 26) == 0 and bits(w, 20, 20) and not (bits(w, 25, 25) == 0 and bits(w, 7, 4) == 9)) \
            or w & 0x0fffffff == 0x0ef1fa10 or prior.flow != 'next'
        writes_index = bits(w, 15, 12) == index and (
            (bits(w, 27, 26) == 0 and not 8 <= bits(w, 24, 21) <= 11) or (bits(w, 27, 26) == 1 and bits(w, 20, 20)))
        if sets_flags or writes_index:
            break
    raise Unsupported(f'{pc:#x}: jump table without a bound check')


def generate(entry, body, functions):
    thumb = entry & 1
    lines = [f'static void p_{entry:x}(void) {{', 'uint32_t lr0=r[14];']   # bx to it is a return
    if min(body) != entry & ~1:
        lines.append(f'goto L_{entry & ~1:x};')   # shared blocks below the entry are laid out first
    targets = {x.target for x in body.values() if x.flow == 'branch'} | {t for x in body.values() for t in x.targets} | \
        {pc + 8 for pc, x in body.items() if getattr(x, 'inline', False)}
    for pc in sorted(body):
        x = body[pc]
        after = pc + x.size
        back = f'{after | thumb:#x}u'   # return address: the next instruction, in this instruction set
        flow = ''
        if x.flow == 'branch':
            flow = f'goto L_{x.target:x};'
        elif x.flow == 'tailcall':
            flow = f'call({x.target:#x}u);return;'
        elif x.flow == 'call':
            if 'r[15]' in x.c:
                flow = f'{{uint32_t t={x.c.split("=", 1)[1].rstrip(";")};r[14]={back};call(t);}}'
            else:
                flow = f'r[14]={back};call({x.target:#x}u);'
            if getattr(x, 'inline', False):
                flow += f'goto L_{pc+8:x};'
        elif x.flow == 'return':
            flow = 'return;'
        elif x.flow in ('tail', 'indirect'):
            flow = 'if(r[15]!=lr0)call(r[15]);return;'
        elif x.flow == 'switch':
            flow = 'switch(r[15]){' + ''.join(f'case {t:#x}u:goto L_{t:x};' for t in x.targets) + f'default:panic({pc:#x}u,1);return;}}'
        code = flow if x.flow == 'call' and 'r[15]' in x.c else x.c + flow
        if x.cond:
            code = f'if({x.cond}){{{code}}}'
        label = f'L_{pc:x}: ' if pc in targets or pc == entry & ~1 else ''
        lines.append(f'{label}{code}')
        ends = x.flow in ('return', 'tail', 'indirect', 'branch', 'tailcall', 'switch') and not x.cond
        if not getattr(x, 'inline', False) and after not in body and not ends:
            lines.append(f'call({after | thumb:#x}u);return;')   # flows into the next function
    lines.append('}')
    return '\n'.join(lines)


def write(functions, external, out):
    text = ['/* Generated by tools/arm_recompile.py from the user\'s own Megamix dump. Do not commit. */']
    text.extend(f'static void p_{a:x}(void);' for a in sorted(functions))
    text.extend(generate(a, functions[a], functions) for a in sorted(functions))
    text.extend(f'static void p_{a:x}(void) /* {name} */ {body}' for a, (name, body) in sorted(RUNTIME.items()))
    text.append('static int dispatch_original(uint32_t address) {switch(address){')
    text.extend(f'case {a:#x}u: p_{a:x}(); return 1;' for a in sorted(set(functions) | set(RUNTIME)))
    text.append('default:return 0;}}')
    pathlib.Path(out).write_text('\n'.join(text) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary')
    parser.add_argument('--base', type=lambda s: int(s, 0))
    parser.add_argument('--entry', type=lambda s: int(s, 0), action='append', default=[])
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.binary:
        memory = Memory([(args.base, pathlib.Path(args.binary).read_bytes(), True)])
        entries, out = args.entry, args.out
    else:
        sys.path.insert(0, str(pathlib.Path(__file__).parent))
        from paths import CTR, BUILD, game, manifest, require
        name = game()
        info = json.loads(require(CTR/'code.json').read_text())
        memory = Memory([(info[s]['address'], (CTR/f'code-{s}.bin').read_bytes(), s != 'data')
                         for s in ('text', 'rodata', 'data')])
        profile = manifest(name)['ctr']
        entries = [int(a, 0) for a in profile['functions']]
        out = BUILD/name/'original-functions.inc'
        out.parent.mkdir(parents=True, exist_ok=True)
    functions, external = find_functions(Decoder(memory), entries)
    write(functions, external, out)
    print(f'Translated {len(functions)} functions, {sum(len(b) for b in functions.values())} instructions; '
          f'{sum(a & 1 for a in functions)} of them Thumb')


if __name__ == '__main__':
    main()
