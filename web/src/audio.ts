// 程序化音频：环境低鸣、脚步、闷响、故障声、语音朗读
export interface SpeechEvents { onStart?: () => void; onEnd?: (complete: boolean) => void }
interface SpeechRecord { text: string; requested_at: number; started_at: number | null; finished_at: number | null; complete: boolean | null }
export class Audio {
  ctx?: AudioContext; master?: GainNode; volume = 0.8;
  private noiseBuf?: AudioBuffer;
  private speechEnabled = true;
  private speechAbort?: AbortController;
  private speechSources = new Set<AudioBufferSourceNode>();
  private speechSequence = 0;
  private speechNextTime = 0;
  private speechPulse?: ReturnType<typeof setInterval>;
  private speechTimeout?: ReturnType<typeof setTimeout>;
  private speechPending = false;
  private speechEvents?: SpeechEvents;
  private speechRecords: SpeechRecord[] = [];
  private currentSpeech?: SpeechRecord;
  get speechBusy() { return this.speechPending || this.speechSources.size > 0; }
  get speechState() { return { busy: this.speechBusy, recent: this.speechRecords.slice(-6).map(r => ({ ...r })) }; }
  onSpeakPulse: () => void = () => {};
  onSpeechError: (message: string) => void = () => {};
  /** 云端语音未配置时置为 false：台词不再请求 /api/tts，改播一段轻柔的合成低吟并保持同样的节奏。 */
  voiceAvailable = true;
  private murmurNodes: OscillatorNode[] = [];
  get speak() { return this.speechEnabled; }
  set speak(value: boolean) { this.speechEnabled = value; if (!value) this.stopSpeech(); }
  warmup() { if (this.speak) void fetch('/api/tts/warmup', { method: 'POST' }).catch(() => {}); }
  start() {
    if (this.ctx) return;
    const ctx = new AudioContext(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = b * 3; }
    this.noiseBuf = buf;
    // 空调与电流低鸣
    const hum = ctx.createGain(); hum.gain.value = 0.035; hum.connect(this.master);
    for (const f of [55, 110.4, 165.2]) { const o = ctx.createOscillator(); o.frequency.value = f; o.type = 'sine'; const g = ctx.createGain(); g.gain.value = f === 55 ? 0.6 : 0.25; o.connect(g).connect(hum); o.start(); }
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 520; const ng = ctx.createGain(); ng.gain.value = 0.05; n.connect(bp).connect(ng).connect(this.master); n.start();
  }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
  private env(g: GainNode, a: number, peak: number, dec: number) { const t = this.ctx!.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  private noise(freq: number, type: BiquadFilterType, peak: number, dec: number, q = 1) {
    if (!this.ctx || !this.noiseBuf) return; const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = this.ctx.createGain(); this.env(g, 0.005, peak, dec); s.connect(f).connect(g).connect(this.master!); s.start(); s.stop(this.ctx.currentTime + dec + 0.1);
  }
  step(soft = false) { this.noise(soft ? 500 : 800, 'lowpass', soft ? 0.12 : 0.22, 0.09); }
  thud(dist = 6) { if (!this.ctx) return; const k = Math.max(0.15, Math.min(1, 6 / dist)); const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(70, this.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(32, this.ctx.currentTime + 0.7); const g = this.ctx.createGain(); this.env(g, 0.01, 0.5 * k, 0.8); o.connect(g).connect(this.master!); o.start(); o.stop(this.ctx.currentTime + 1); this.noise(180, 'lowpass', 0.35 * k, 0.6); }
  door() { this.noise(300, 'bandpass', 0.3, 0.9, 0.7); }
  chime() { if (!this.ctx) return; for (const [f, d] of [[880, 0], [1320, 0.08]]) { const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = this.ctx.createGain(); const t = this.ctx.currentTime + d; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); o.connect(g).connect(this.master!); o.start(t); o.stop(t + 1.3); } }
  glitch() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.3);
    const g = this.ctx.createGain(); this.env(g, 0.003, 0.12, 0.32); o.connect(g).connect(this.master!); o.start(); o.stop(t + 0.4);
    this.noise(3000, 'highpass', 0.25, 0.3);
  }
  shimmer() { if (!this.ctx) return; for (let i = 0; i < 6; i++) { const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 440 * Math.pow(1.5, i % 4) * (1 + i * 0.002); const g = this.ctx.createGain(); const t = this.ctx.currentTime + i * 0.12; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6); o.connect(g).connect(this.master!); o.start(t); o.stop(t + 2.8); } }
  footstepsAt(dist: number) { let i = 0; const go = () => { if (i++ > 5) return; this.noise(600, 'lowpass', 0.25 * Math.max(0.15, Math.min(1, 5 / dist)), 0.1); setTimeout(go, 480); }; go(); }

  private loops: Record<string, { g: GainNode; src?: AudioScheduledSourceNode }> = {};
  loop(name: string, kind: 'wind' | 'water' | 'alarm' | 'fire' | 'hum', vol: number) {
    if (!this.ctx || !this.noiseBuf) return;
    let L = this.loops[name];
    if (!L) {
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.master!);
      if (kind === 'alarm') { const o = this.ctx.createOscillator(); o.type = 'square'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 1.6; const lg = this.ctx.createGain(); lg.gain.value = 220; lfo.connect(lg).connect(o.frequency); o.frequency.value = 760; const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; o.connect(f).connect(g); o.start(); lfo.start(); L = { g, src: o }; }
      else { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const f = this.ctx.createBiquadFilter(); f.type = kind === 'wind' ? 'bandpass' : kind === 'fire' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'wind' ? 420 : kind === 'water' ? 900 : kind === 'fire' ? 1400 : 200; f.Q.value = kind === 'wind' ? 0.6 : 0.8; if (kind === 'wind') { const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13; const lg = this.ctx.createGain(); lg.gain.value = 180; lfo.connect(lg).connect(f.frequency); lfo.start(); } s.connect(f).connect(g); s.start(); L = { g, src: s }; }
      this.loops[name] = L;
    }
    L.g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.25);
  }
  rumble() { this.noise(90, 'lowpass', 0.45, 1.4); if (!this.ctx) return; const o = this.ctx.createOscillator(); o.frequency.value = 38; const g = this.ctx.createGain(); this.env2(g, 0.2, 0.25, 1.2); o.connect(g).connect(this.master!); o.start(); o.stop(this.ctx.currentTime + 1.6); }
  crash() { this.thud(3); this.noise(1200, 'bandpass', 0.35, 0.5, 0.5); setTimeout(() => this.noise(2400, 'highpass', 0.18, 0.4), 90); }
  ding() { if (!this.ctx) return; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1046; const g = this.ctx.createGain(); this.env2(g, 0.005, 0.15, 1.6); o.connect(g).connect(this.master!); o.start(); o.stop(this.ctx.currentTime + 1.8); }
  ring() { if (!this.ctx) return; for (let i = 0; i < 2; i++) { const t = this.ctx.currentTime + i * 0.5; const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 440; const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 480; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.connect(g); o2.connect(g); g.connect(this.master!); o.start(t); o2.start(t); o.stop(t + 0.45); o2.stop(t + 0.45); } }
  cough() { this.noise(700, 'bandpass', 0.3, 0.18, 1.2); setTimeout(() => this.noise(600, 'bandpass', 0.25, 0.2, 1.2), 220); }
  type() { this.noise(3000, 'highpass', 0.06, 0.03); }
  splash() { this.noise(800, 'lowpass', 0.4, 0.7); }
  laugh() { if (!this.ctx) return; for (let i = 0; i < 4; i++) { const t = this.ctx.currentTime + i * 0.16; const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(320 - i * 20, t); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); o.connect(f).connect(g).connect(this.master!); o.start(t); o.stop(t + 0.15); } }
  private env2(g: GainNode, a: number, peak: number, dec: number) { const t = this.ctx!.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  stopSpeech() {
    this.speechSequence++;
    this.speechAbort?.abort();
    this.speechAbort = undefined;
    for (const source of this.speechSources) source.stop();
    this.speechSources.clear();
    for (const node of this.murmurNodes) { try { node.stop(); } catch { /* already ended */ } }
    this.murmurNodes = [];
    this.speechPending = false;
    clearTimeout(this.speechTimeout); this.speechTimeout = undefined;
    const events = this.speechEvents; this.speechEvents = undefined; events?.onEnd?.(false);
    clearInterval(this.speechPulse); this.speechPulse = undefined;
    this.speechNextTime = 0;
    this.recordSpeechEnd(false);
  }
  private recordSpeechEnd(complete: boolean) {
    if (this.currentSpeech) { this.currentSpeech.finished_at = Date.now(); this.currentSpeech.complete = complete; this.currentSpeech = undefined; }
  }
  private finishSpeech() {
    if (this.speechBusy) return;
    this.recordSpeechEnd(true);
    const events = this.speechEvents; this.speechEvents = undefined; events?.onEnd?.(true);
  }
  async playClip(url: string) {
    if (!this.speak || !url || !this.ctx || !this.master) return;
    this.stopSpeech();
    const sequence = this.speechSequence, ctx = this.ctx;
    this.speechPending = true;
    const controller = new AbortController(); this.speechAbort = controller;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Clip unavailable');
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (controller.signal.aborted || sequence !== this.speechSequence) return;
      const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(this.master);
      source.onended = () => { this.speechSources.delete(source); source.disconnect(); this.finishSpeech(); };
      this.speechSources.add(source); source.start();
    } catch {
      if (!controller.signal.aborted && sequence === this.speechSequence) this.onSpeechError('配音暂时无法播放，字幕仍可阅读。');
    } finally { if (sequence === this.speechSequence) { this.speechPending = false; this.finishSpeech(); } }
  }
  /** 没有云端语音时的替代：随逐字出现的字幕发出很轻的音高起伏，停留时间按正常语速计算。 */
  private murmur(text: string, whisper: boolean, record: SpeechRecord, sequence: number, events?: SpeechEvents) {
    const ctx = this.ctx!, scale = [0, 2, 4, 7, 9, 12]; let at = ctx.currentTime + 0.04, spoken = 0;
    for (const ch of text) {
      if (/[\s，。！？、…—,.!?：；「」“”（）]/.test(ch)) { at += 0.11; continue; }
      if (spoken++ % 2 === 0) {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
        osc.type = 'triangle'; osc.frequency.value = (whisper ? 300 : 494) * Math.pow(2, scale[ch.charCodeAt(0) % scale.length] / 12);
        filter.type = 'lowpass'; filter.frequency.value = whisper ? 900 : 1700;
        gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(whisper ? 0.016 : 0.03, at + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
        osc.connect(filter).connect(gain).connect(this.master!); osc.start(at); osc.stop(at + 0.1); this.murmurNodes.push(osc);
      }
      at += 0.045;
    }
    record.started_at = Date.now(); events?.onStart?.(); this.onSpeakPulse();
    const seconds = Math.max(1.5, Math.min(11, 0.5 + spoken * 0.2));
    this.speechTimeout = setTimeout(() => {
      if (sequence !== this.speechSequence) return;
      this.speechPending = false; this.speechTimeout = undefined; this.murmurNodes = []; this.finishSpeech();
    }, seconds * 1000);
  }
  async say(text: string, emotion = '', mood = 'calm', events?: SpeechEvents) {
    if (!this.speak || !text.trim() || !this.ctx || !this.master) return;
    this.stopSpeech();
    const record: SpeechRecord = { text, requested_at: Date.now(), started_at: null, finished_at: null, complete: null };
    this.currentSpeech = record; this.speechRecords.push(record); this.speechRecords = this.speechRecords.slice(-6);
    const sequence = this.speechSequence, ctx = this.ctx;
    this.speechPending = true; this.speechEvents = events;
    if (!this.voiceAvailable) { this.murmur(text, emotion.includes('低语'), record, sequence, events); return; }
    let started = false;
    const controller = new AbortController(); this.speechAbort = controller;
    const timeout = setTimeout(() => {
      if (sequence !== this.speechSequence) return;
      this.stopSpeech(); this.onSpeechError('阿里云语音请求超时，字幕仍可阅读。');
    }, 45000);
    this.speechTimeout = timeout;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      if (controller.signal.aborted) return;
      const response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ text, emotion, mood }),
      });
      if (controller.signal.aborted || sequence !== this.speechSequence) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body || response.headers.get('X-Audio-Sample-Rate') !== '24000') throw new Error('TTS unavailable');
      const reader = response.body.getReader();
      let carry = new Uint8Array(0);
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted || sequence !== this.speechSequence) { await reader.cancel(); return; }
        if (done) break;
        const bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length);
        const count = Math.floor(bytes.length / 2); carry = bytes.slice(count * 2);
        if (!count) continue;
        const buffer = ctx.createBuffer(1, count, 24000), samples = buffer.getChannelData(0), view = new DataView(bytes.buffer);
        for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(this.master!);
        source.onended = () => {
          this.speechSources.delete(source); source.disconnect();
          if (!this.speechSources.size) { clearInterval(this.speechPulse); this.speechPulse = undefined; }
          this.finishSpeech();
        };
        this.speechSources.add(source);
        const at = Math.max(ctx.currentTime + 0.04, this.speechNextTime);
        source.start(at); this.speechNextTime = at + buffer.duration;
        if (!started) { started = true; record.started_at = Date.now(); events?.onStart?.(); }
        this.onSpeakPulse();
        this.speechPulse ??= setInterval(() => this.onSpeakPulse(), 120);
      }
      if (carry.length) throw new Error('Incomplete PCM sample');
    } catch {
      if (!controller.signal.aborted && sequence === this.speechSequence) {
        this.stopSpeech(); this.onSpeechError('阿里云语音暂时不可用，字幕仍可阅读。');
      }
    } finally {
      clearTimeout(timeout);
      if (sequence === this.speechSequence) { this.speechPending = false; this.speechTimeout = undefined; this.finishSpeech(); }
    }
  }
}
