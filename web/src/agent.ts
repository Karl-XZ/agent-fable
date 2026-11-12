import { ToolCall, ToolResult } from './tools';

export interface AgentReply { thought: string; say: string; mood: string; emotion?: string; tools: ToolCall[]; reply?: string }
export interface AgentEvent { type: string; detail: string; t: number; urgent?: boolean }
export interface LogEntry { t: number; thought: string; say: string; emotion?: string; tools: { label: string; ok: boolean; msg: string }[]; source: 'llm' | 'rule'; channel: string; ms: number; trigger: string[] }

export interface Perception { state: Record<string, any>; ascii: string }

export class Agent {
  session = Math.random().toString(36).slice(2, 10);
  busy = false; consoleBusy = false;
  events: AgentEvent[] = []; history: { role: string; text: string }[] = []; results: ToolResult[] = [];
  log: LogEntry[] = []; lastCall = -99; calls = 0; fails = 0; llmOk = 0; heartbeat = 12; enabled = true;
  canSpeak: () => boolean = () => true;
  query?: (call: ToolCall) => ToolResult;
  constructor(public perceive: () => Perception, public apply: (r: AgentReply, channel: string) => Promise<ToolResult[]>, public now: () => number, public fallback: (events: AgentEvent[]) => AgentReply) {}
  push(type: string, detail: string, urgent = false) {
    const t = this.now();
    // 同类事件去重（3 秒内）
    const last = [...this.events].reverse().find(e => e.type === type && e.detail === detail); if (last && t - last.t < 3) return;
    this.events.push({ type, detail, t, urgent }); if (this.events.length > 30) this.events.shift();
  }
  tick() {
    if (!this.enabled || this.busy) return;
    const t = this.now(); const urgent = this.events.some(e => e.urgent);
    if (!urgent && !this.canSpeak()) return;
    if ((urgent && t - this.lastCall > 1.2) || (this.events.length && t - this.lastCall > 3.2) || t - this.lastCall > this.heartbeat) this.run('building');
  }
  async run(channel: 'building' | 'console', consoleMsg?: string): Promise<AgentReply | null> {
    if (channel === 'building') this.busy = true; else this.consoleBusy = true;
    this.lastCall = this.now();
    const evs = channel === 'building' ? this.events.splice(0) : [...this.events.slice(-6)];
    if (consoleMsg) { evs.push({ type: 'console', detail: consoleMsg, t: this.now() }); this.history.push({ role: 'console', text: consoleMsg }); }
    const t0 = performance.now(); let reply!: AgentReply; let source: 'llm' | 'rule' = 'llm';
    const queries: ToolResult[] = [];
    try {
      for (let round = 0; round < 3; round++) {
        const p = this.perceive(); this.calls++;
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 26000);
        try {
          const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ session: this.session, channel, state: p.state, ascii: p.ascii, events: evs.map(e => ({ type: e.type, detail: e.detail })), history: this.history.slice(-12), results: [...this.results, ...queries].slice(-10) }) });
          if (!res.ok) throw new Error(String(res.status));
          reply = await res.json(); if (!reply || typeof reply !== 'object' || (reply as any).error) throw new Error('bad');
        } finally { clearTimeout(to); }
        this.llmOk++;
        const requests = (reply.tools ?? []).filter(t => t.name === 'find_path').slice(0, 2);
        if (!requests.length) break;
        if (!this.query) throw new Error('Navigation queries unavailable');
        for (const request of requests) queries.push(this.query(request));
        // A route query is internal deliberation: no premature voice or mutations.
        if (round === 2) reply = { thought: reply.thought, say: '我先重新确认一下路线，请稍等。', mood: reply.mood, tools: [] };
      }
    } catch (e) {
      this.fails++; source = 'rule'; reply = this.fallback(evs);
      if (channel === 'console') reply.reply = reply.reply ?? '[ERR] 连接中断……请稍后再试。';
    }
    const ms = Math.round(performance.now() - t0);
    if (reply.say) this.history.push({ role: 'ai', text: reply.say });
    if (channel === 'console' && reply.reply) this.history.push({ role: 'ai', text: `（终端）${reply.reply}` });
    const results = [...queries, ...await this.apply(reply, channel)];
    this.results = results;
    this.log.push({ t: this.now(), thought: reply.thought, say: reply.say, emotion: reply.emotion, tools: results.map(r => ({ label: r.label, ok: r.ok, msg: r.msg })), source, channel, ms, trigger: evs.map(e => `${e.type}:${e.detail}`.slice(0, 80)) });
    if (channel === 'building') this.busy = false; else this.consoleBusy = false;
    this.lastCall = this.now();
    return reply;
  }
}
