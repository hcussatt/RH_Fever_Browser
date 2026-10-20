"""Local RWAR/RWAV extraction using the recovered NW4R layouts."""
import hashlib
import os
import pathlib
import struct
import subprocess
import tempfile
import wave
import numpy as np

DSP_VERSION=1 # change when decode_dsp's output changes, to retire cached results
u16=lambda b,o=0:struct.unpack_from('>H',b,o)[0]
u32=lambda b,o=0:struct.unpack_from('>I',b,o)[0]

def wave_files(data):
    assert data[:4]==b'RWAR'
    table,block=u32(data,16),u32(data,24)
    for i in range(u32(data,table+8)):
        entry=table+12+i*12
        offset=block+u32(data,entry+4)
        length=u32(data,entry+8)
        result=data[offset:offset+length]
        assert result[:4]==b'RWAV'
        yield result

def decode_dsp(raw, coefs, yn1, yn2, length):
    """Nintendo DSP rounding and saturated history, also used by the browser bridge.

    Local builds set RHF_DSP_CACHE to a folder that keeps each decoded result, keyed by
    every input, because many games decode the same samples (the results music)."""
    cache=os.environ.get('RHF_DSP_CACHE')
    if cache:
        key=hashlib.sha1(bytes(raw)+repr((DSP_VERSION,tuple(coefs),yn1,yn2,length)).encode()).hexdigest()
        path=pathlib.Path(cache)/f'{key}.npy'
        if path.exists():return np.load(path)
    assert len(raw)%8==0
    out=[];append=out.append
    for frame in range(0,len(raw),8):
        ps=raw[frame]; scale=1<<(ps&15);pred=ps>>4
        assert pred<8
        c0,c1=coefs[pred*2:pred*2+2]
        for b in raw[frame+1:frame+8]:
            for nibble in (b>>4,b&15):
                if nibble>=8:nibble-=16
                value=(c0*yn1+c1*yn2+(nibble*scale<<11)+1024)>>11
                if value>32767:value=32767
                elif value<-32768:value=-32768
                append(value);yn2=yn1;yn1=value
    result=np.array(out[:length],dtype=np.int16)
    if cache:
        path.parent.mkdir(parents=True,exist_ok=True)
        partial=path.with_suffix(f'.{os.getpid()}.tmp')
        with partial.open('wb') as f:np.save(f,result)
        partial.replace(path)
    return result

def decode_wave(data, verify=False):
    assert data[:4]==b'RWAV'
    info=u32(data,16)+8
    fmt,loop,channels,rate_high=struct.unpack_from('4B',data,info)
    rate=(rate_high<<16)+u16(data,info+4)
    start,end=u32(data,info+8),u32(data,info+12)
    if fmt==2:
        address_to_sample=lambda x:(x//16)*14+max(0,(x%16)-2)
        # loopEnd is the address of the final inclusive DSP nibble.
        length=address_to_sample(end)+1
        loop_start=address_to_sample(start)
    else:
        length=end+1;loop_start=start
    result=np.empty((length,channels),dtype=np.int16)
    checks=[]
    for ch in range(channels):
        channel=info+u32(data,info+u32(data,info+16)+ch*4)
        assert data[info+6]==0
        origin=info+u32(data,info+20)+8 # skip the embedded RWAV DATA block header
        audio=origin+u32(data,channel)
        if fmt==2:
            params=info+u32(data,channel+4)
            coefs=struct.unpack_from('>16h',data,params)
            yn1,yn2=struct.unpack_from('>2h',data,params+36)
            raw=data[audio:audio+((length+13)//14)*8]
            decoded=decode_dsp(raw,coefs,yn1,yn2,length)
            result[:,ch]=decoded
            if verify:
                # Independent FFmpeg ADPCM_THP decoder via a GENH wrapper.
                # Header layout: FFmpeg libavformat/genh.c.
                header=bytearray(128);header[:4]=b'GENH'
                struct.pack_into('<14I',header,4,1,8,rate,0xffffffff,length,12,128,128,64,0,0,0,0,0)
                header[64:96]=data[params:params+32]
                with tempfile.TemporaryDirectory(prefix='rhf-dsp-') as tmp:
                    p=pathlib.Path(tmp)/'test.genh';p.write_bytes(header+raw)
                    ref=subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-f','s16le','-acodec','pcm_s16le','-'])
                ref=np.frombuffer(ref,dtype='<i2')[:length]
                assert len(ref)==len(decoded)
                # FFmpeg truncates the predictor sum; Nintendo's recovered
                # DecodeDspAdpcm rounds it. Verify the external decoder using
                # its own rounding convention rather than silently changing
                # the game's decoder to obtain a false "exact" match.
                h1,h2=struct.unpack_from('>2h',data,params+36)
                truncated=[]
                for frame in range(0,len(raw),8):
                    ps=raw[frame];scale=1<<(ps&15);c0,c1=coefs[(ps>>4)*2:(ps>>4)*2+2]
                    for j in range(14):
                        n=(raw[frame+1+j//2]>>(4 if j%2==0 else 0))&15
                        if n>=8:n-=16
                        v=max(-32768,min(32767,((c0*h1+c1*h2)>>11)+n*scale))
                        truncated.append(v);h2,h1=h1,v
                ffmpeg_error=np.abs(ref.astype(np.int32)-np.array(truncated[:length],dtype=np.int32))
                assert not np.any(ffmpeg_error), 'FFmpeg format/decoder cross-check failed'
                error=np.abs(ref.astype(np.int32)-decoded.astype(np.int32))
                checks.append({'channel':ch,'samplesCompared':length,'ffmpegTruncatingDecoderDifferentSamples':int(np.count_nonzero(ffmpeg_error)),'nintendoRoundingVsFfmpegDifferentSamples':int(np.count_nonzero(error)),'nintendoRoundingVsFfmpegMaxDifference':int(error.max(initial=0))})
        elif fmt==1:
            result[:,ch]=np.frombuffer(data,dtype='>i2',count=length,offset=audio)
        elif fmt==0:
            result[:,ch]=np.frombuffer(data,dtype='i1',count=length,offset=audio).astype(np.int16)<<8
        else:
            raise ValueError('Unsupported format '+str(fmt))
    return result,{'rate':rate,'channels':channels,'samples':length,'loop':bool(loop),'loopStart':loop_start,'format':fmt,'independentDecoderChecks':checks}

def write_wav(path,pcm,rate):
    with wave.open(str(path),'wb') as w:
        w.setnchannels(pcm.shape[1]);w.setsampwidth(2);w.setframerate(rate)
        w.writeframes(pcm.astype('<i2').tobytes())
