import { ToolCall, ToolResult } from './tools';
import { InteractionMemory, InteractionDecision } from './interaction';

export interface AgentReply { thought: string; say: string; mood: string; emotion?: string; tools: ToolCall[]; reply?: string; interaction?: InteractionDecision }
export interface AgentEvent { id?: string; type: string; detail: string; t: number; urgent?: boolean }
export interface LogEntry { t: number; thought: string; say: string; emotion?: string; tools: { label: string; ok: boolean; msg: string }[]; source: 'llm' | 'rule'; channel: string; ms: number; trigger: string[]; interaction?: ReturnType<InteractionMemory['context']> }

export interface Perception { state: Record<string, any>; ascii: string }
export interface AppliedReply { results: ToolResult[]; deliveredSay: string }

export class Agent {
  session = Math.random().toString(36).slice(2, 10);
  busy = false; consoleBusy = false;
  events: AgentEvent[] = []; history: { role: string; text: string }[] = []; results: ToolResult[] = [];
  log: LogEntry[] = []; lastCall = -99; calls = 0; fails = 0; llmOk = 0; heartbeat = 12; enabled = true;
  canSpeak: () => boolean = () => true;
  query?: (call: ToolCall) => ToolResult;
  interaction: InteractionMemory;
  constructor(public perceive: () => Perception, public apply: (r: AgentReply, channel: string) => Promise<ToolResult[] | AppliedReply>, public now: () => number, public fallback: (events: AgentEvent[]) => AgentReply) { this.interaction = new InteractionMemory(now); }
  push(type: string, detail: string, urgent = false) {
    const t = this.now();
    // 同类事件去重（3 秒内）
    const last = [...this.events].reverse().find(e => e.type === type && e.detail === detail); if (last && t - last.t < 3) return;
    const observation = this.interaction.recordEvent(type, detail);
    this.events.push({ id: observation.id, type, detail, t, urgent }); if (this.events.length > 30) this.events.shift();
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
    if (consoleMsg) { const event = this.interaction.recordEvent('console', consoleMsg); evs.push({ ...event }); this.history.push({ role: 'console', text: consoleMsg }); }
    const t0 = performance.now(); let reply!: AgentReply; let source: 'llm' | 'rule' = 'llm';
    const queries: ToolResult[] = [];
    let requestRevision = this.interaction.context().revision;
    try {
    try {
      for (let round = 0; round < 3; round++) {
        const p = this.perceive(); this.calls++;
        p.state = { ...p.state, interaction: this.interaction.context(p.state) };
        requestRevision = p.state.interaction.revision;
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 26000);
        try {
          const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ session: this.session, channel, state: p.state, ascii: p.ascii, events: evs.map(e => ({ id: e.id, type: e.type, detail: e.detail })), history: this.history.slice(-12), results: [...this.results, ...queries].slice(-10) }) });
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
    this.interaction.context(this.perceive().state);
    reply = this.interaction.reconcile(reply, requestRevision, channel);
    const applied = await this.apply(reply, channel);
    const results = [...queries, ...(Array.isArray(applied) ? applied : applied.results)];
    if (!Array.isArray(applied)) reply = { ...reply, say: applied.deliveredSay };
    if (reply.say) this.history.push({ role: 'ai', text: reply.say });
    if (channel === 'console' && reply.reply) this.history.push({ role: 'ai', text: `（终端）${reply.reply}` });
    this.interaction.recordResults(results, channel);
    this.results = results;
    this.log.push({ t: this.now(), thought: reply.thought, say: reply.say, emotion: reply.emotion, tools: results.map(r => ({ label: r.label, ok: r.ok, msg: r.msg })), source, channel, ms, trigger: evs.map(e => `${e.type}:${e.detail}`.slice(0, 80)), interaction: this.interaction.context(this.perceive().state) });
    const fresh = this.perceive().state;
    if (channel === 'building' && this.interaction.context(fresh).last_suppression.startsWith('当前有危险') && fresh.player?.danger?.length) this.push('danger', `仍需处理眼前危险：${fresh.player.danger.join('；')}`, true);
    return reply;
    } finally {
      if (channel === 'building') this.busy = false; else this.consoleBusy = false;
      this.lastCall = this.now();
    }
  }
}
