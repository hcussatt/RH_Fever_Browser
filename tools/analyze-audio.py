#!/usr/bin/env python3
"""Offline analysis of captured WebAudio and paired native/worklet telemetry."""
import json
import pathlib
import re
import sys
import wave

import numpy as np

telemetry_path, wav_path, output_prefix = map(pathlib.Path, sys.argv[1:4])
data = json.loads(telemetry_path.read_text())
samples = data['samples']
first, last = samples[0], samples[-1]
def field(row, name):
    return int(re.search(r'\b' + name + r':(\d+)', row['native'])[1])
wall_seconds = (last['wall'] - first['wall']) / 1000
emulated_seconds = (last['ticks'] - first['ticks']) / first['ticksPerSecond']
audio_seconds = last['audioTime'] - first['audioTime']
# Use the AI block, not the most recent output-pull 'audio:frames' value.
ai_frames = lambda row: int(re.search(r'ai:buf:\d+ frames:(\d+)', row['native'])[1])
source_rate = (ai_frames(last) - ai_frames(first)) / emulated_seconds
native_ms = np.array([field(s, 'dma_buffer_frames') / source_rate * 1000 for s in samples])
ring_ms = np.array([s['workletRing']['fillFrames'] / 48 for s in samples])
def distribution(values):
    return dict(zip(('min', 'median', 'p95', 'max'), map(float, np.percentile(values, [0, 50, 95, 100]))))
report = {
    'durationSeconds': wall_seconds,
    'aggregateEmulationSpeedPercent': emulated_seconds / wall_seconds * 100,
    'audioClockVsWallDriftMs': (audio_seconds - wall_seconds) * 1000,
    'emulatedClockVsAudioEndpointDifferenceMs': (emulated_seconds - audio_seconds) * 1000,
    'estimatedNativeInputRateHz': source_rate,
    'nativeUnderrunGranules': field(last, 'dma_underrun_granules') - field(first, 'dma_underrun_granules'),
    'nativeQueueResets': field(last, 'dma_queue_resets') - field(first, 'dma_queue_resets'),
    'workletUnderrunRenderQuanta': last['workletRing']['underrunEvents'] - first['workletRing']['underrunEvents'],
    'workletUnderrunFrames': last['workletRing']['underrunFrames'] - first['workletRing']['underrunFrames'],
    'nativeQueuedMs': distribution(native_ms),
    'workletQueuedMs': distribution(ring_ms),
    'reportedBaseLatencyMs': data['context']['baseLatency'] * 1000,
    'reportedOutputLatencyMs': data['context']['outputLatency'] * 1000,
    'sampledQueuePlusReportedOutputEstimateMs': distribution(native_ms + ring_ms + 1000 * (data['context']['baseLatency'] + data['context']['outputLatency'])),
    'limitations': [
        'Queue snapshots are sampled, not continuous; native frames are reported at the last granule dequeue.',
        'Latency estimate omits partial native granules, resampler delay, input polling, and hardware measurement; it is not measured click-to-sound.',
        'Endpoint emulated-clock difference is affected by polled core-tick staleness and scheduling; it does not establish musical phase error.',
        'Capture is after WebAudio gain, before OS/device output. No reference recording or listening test; THD, SNR, and exact original fidelity cannot be inferred.',
    ],
}
with wave.open(str(wav_path)) as wav:
    rate, channels = wav.getframerate(), wav.getnchannels()
    pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').reshape(-1, channels)
    signal = pcm.astype(np.float64) / 32768
peak = float(np.abs(signal).max())
zero = np.all(signal == 0, axis=1)
edges = np.diff(np.r_[False, zero, False].astype(np.int8))
starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
silences = [{'startSeconds': int(a)/rate, 'durationMs': int(b-a)/rate*1000} for a,b in zip(starts,ends) if b-a >= rate*.005]
rms = np.sqrt(np.mean(signal**2, axis=0))
report['capture'] = {
    'seconds': len(signal) / rate, 'sampleRate': rate, 'channels': channels,
    'peakDbFS': float(20*np.log10(peak)) if peak else None,
    'samplesAtPositive16BitRail': int(np.sum(pcm == 32767)),
    'samplesAtNegative16BitRail': int(np.sum(pcm == -32768)),
    'floatSamplesAtOrBeyondUnity': data.get('capture', {}).get('clipped'),
    'rmsDbFSPerChannel': (20*np.log10(np.maximum(rms, 1e-12))).tolist(),
    'dcOffsetPerChannel': np.mean(signal, axis=0).tolist(),
    'stereoCorrelation': float(np.corrcoef(signal.T)[0,1]),
    'exactSilencesAtLeast5ms': silences,
    'note': 'Authored silence can occur; zero runs alone do not prove a dropout. No clipping does not rule out other distortion.',
}
output_prefix.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig, axes = plt.subplots(3, 1, figsize=(10, 8), constrained_layout=True)
time = np.array([s['wall'] - first['wall'] for s in samples]) / 1000
axes[0].plot(time, native_ms, label='Native DMA queue')
axes[0].plot(time, ring_ms, label='Worklet queue')
axes[0].set(ylabel='Queued audio (ms)', title=data['label'])
axes[0].legend()
for name, label in [('dma_underrun_granules', 'Native underrun granules'), ('dma_queue_resets', 'Native queue resets')]:
    axes[1].step(time, [field(s,name)-field(first,name) for s in samples], label=label)
axes[1].step(time, [s['workletRing']['underrunEvents']-first['workletRing']['underrunEvents'] for s in samples], label='Worklet underrun quanta')
axes[1].set(ylabel='New events', xlabel='Telemetry elapsed (s)')
axes[1].legend()
block = rate // 100
trimmed = signal[:len(signal)//block*block].reshape(-1, block, channels)
envelope = np.sqrt(np.mean(trimmed**2, axis=(1,2)))
axes[2].plot(np.arange(len(envelope)) / 100, 20*np.log10(np.maximum(envelope,1e-6)), linewidth=.7)
axes[2].set(ylabel='10 ms RMS (dBFS)', xlabel='Capture elapsed (s)', title='Captured WebAudio output; not device loopback')
fig.savefig(output_prefix.with_suffix('.png'), dpi=160)
print(json.dumps(report, indent=2))
