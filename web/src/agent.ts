import { ToolCall, ToolResult } from './tools';
import { InteractionMemory, InteractionDecision, InteractionTurn } from './interaction';
import type { CharacterCard } from './character-card';

export interface AgentReply { thought: string; say: string; mood: string; emotion?: string; tools: ToolCall[]; reply?: string; interaction?: InteractionDecision; turn?: InteractionTurn }
export interface AgentEvent { id?: string; type: string; detail: string; t: number; urgent?: boolean }
export interface LogEntry { t: number; thought: string; say: string; emotion?: string; tools: { label: string; ok: boolean; msg: string }[]; source: 'llm' | 'rule'; channel: string; ms: number; trigger: string[]; interaction?: ReturnType<InteractionMemory['context']> }

export interface Perception { state: Record<string, any>; ascii: string }
export interface AppliedReply { results: ToolResult[]; deliveredSay: string }

export class Agent {
  session = Math.random().toString(36).slice(2, 10);
  busy = false; consoleBusy = false;
  events: AgentEvent[] = []; history: { role: string; text: string }[] = []; results: ToolResult[] = [];
  log: LogEntry[] = []; lastCall = -99; calls = 0; fails = 0; llmOk = 0; enabled = true;
  canSpeak: () => boolean = () => true;
  canDecide: () => boolean = () => true;
  canInterrupt: () => boolean = () => true;
  characterCard?: () => CharacterCard | undefined;
  private privateCharacterSession = false;
  private pending: { controller?: AbortController; superseded: boolean } | null = null;
  query?: (call: ToolCall) => ToolResult;
  interaction: InteractionMemory;
  constructor(public perceive: () => Perception, public apply: (r: AgentReply, channel: string) => Promise<ToolResult[] | AppliedReply>, public now: () => number, public fallback: (events: AgentEvent[]) => AgentReply) { this.interaction = new InteractionMemory(now); }
  push(type: string, detail: string, urgent = false) {
    const t = this.now();
    // 同类事件去重（3 秒内）
    const last = [...this.events].reverse().find(e => e.type === type && e.detail === detail); if (last && t - last.t < 3) return;
    const observation = this.interaction.recordEvent(type, detail);
    this.events.push({ id: observation.id, type, detail, t, urgent }); if (this.events.length > 30) this.events.shift();
    if (this.pending?.controller && (type === 'speech' || type === 'injury' || type === 'danger' && this.canInterrupt())) {
      this.pending.superseded = true; this.pending.controller.abort();
    }
  }
  tick() {
    if (!this.enabled || this.busy || !this.canDecide()) return;
    const t = this.now(); const urgent = this.events.some(e => e.urgent && e.type === 'danger') && this.canInterrupt();
    const c = this.interaction.context();
    const direct = c.needs_response || c.care_needed && c.activity.observed;
    if (!urgent && !direct && !this.canSpeak()) return;
    // Inference for a new request can overlap old audio. Playback itself remains serialized.
    if ((urgent && t - this.lastCall > 1.2) || direct || ((this.events.length || c.resident_attention) && t - this.lastCall > 3.2)) void this.run('building');
  }
  async run(channel: 'building' | 'console', consoleMsg?: string): Promise<AgentReply | null> {
    if (channel === 'building' ? this.busy : this.consoleBusy) return null;
    if (channel === 'building') this.busy = true; else this.consoleBusy = true;
    this.lastCall = this.now();
    const evs = channel === 'building' ? this.events.splice(0) : [...this.events.slice(-6)];
    if (consoleMsg) { const event = this.interaction.recordEvent('console', consoleMsg); evs.push({ ...event }); this.history.push({ role: 'console', text: consoleMsg }); }
    const t0 = performance.now(); let reply!: AgentReply; let source: 'llm' | 'rule' = 'llm';
    const queries: ToolResult[] = [];
    let requestTurn = this.interaction.captureTurn();
    const pending = { superseded: false, controller: undefined as AbortController | undefined };
    if (channel === 'building') this.pending = pending;
    try {
    try {
      for (let round = 0; round < 3; round++) {
        const p = this.perceive(); this.calls++;
        const card = this.characterCard?.();
        this.privateCharacterSession ||= !!card;
        p.state = { ...p.state, interaction: this.interaction.context(p.state) };
        requestTurn = this.interaction.captureTurn();
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 26000);
        if (channel === 'building') pending.controller = ctl;
        try {
          const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ session: this.session, channel, character_card: card, private_character_session: this.privateCharacterSession, state: p.state, ascii: p.ascii, events: evs.map(e => ({ id: e.id, type: e.type, detail: e.detail })), history: this.history.slice(-12), results: [...this.results.filter(r => !r.navigation), ...queries].slice(-10) }) });
          if (!res.ok) throw new Error(String(res.status));
          reply = await res.json(); if (!reply || typeof reply !== 'object' || (reply as any).error) throw new Error('bad');
        } finally { clearTimeout(to); pending.controller = undefined; }
        if (pending.superseded) return null;
        this.llmOk++;
        const requests = (reply.tools ?? []).filter(t => t.name === 'find_path').slice(0, 2);
        if (!requests.length) break;
        if (!this.query) throw new Error('Navigation queries unavailable');
        for (const request of requests) queries.push(this.query(request));
        // A route query is internal deliberation: no premature voice or mutations.
        if (round === 2) reply = { ...reply, say: p.state.interaction.guidance_allowed ? '我先重新确认一下路线，请稍等。' : '', tools: [] };
      }
    } catch (e) {
      if (pending.superseded) return null;
      this.fails++; source = 'rule'; reply = this.fallback(evs);
      if (channel === 'console') reply.reply = reply.reply ?? '[ERR] 连接中断……请稍后再试。';
    }
    const ms = Math.round(performance.now() - t0);
    this.interaction.context(this.perceive().state);
    reply = this.interaction.reconcile(reply, requestTurn, channel);
    reply.turn = { ...this.interaction.captureTurn(), needsResponse: requestTurn.needsResponse, careNeeded: requestTurn.careNeeded };
    const applied = await this.apply(reply, channel);
    const results = [...queries, ...(Array.isArray(applied) ? applied : applied.results)];
    if (!Array.isArray(applied)) reply = { ...reply, say: applied.deliveredSay };
    this.interaction.recordDelivery(reply);
    if (reply.say) this.history.push({ role: 'ai', text: reply.say });
    if (channel === 'console' && reply.reply) this.history.push({ role: 'console_ai', text: reply.reply });
    this.interaction.recordResults(results, channel);
    this.results = results;
    this.log.push({ t: this.now(), thought: reply.thought, say: reply.say, emotion: reply.emotion, tools: results.map(r => ({ label: r.label, ok: r.ok, msg: r.msg })), source, channel, ms, trigger: evs.map(e => `${e.type}:${e.detail}`.slice(0, 80)), interaction: this.interaction.context(this.perceive().state) });
    const fresh = this.perceive().state;
    if (channel === 'building' && this.interaction.context(fresh).last_suppression.startsWith('当前有危险') && fresh.player?.danger?.length) this.push('danger', `仍需处理眼前危险：${fresh.player.danger.join('；')}`, true);
    return reply;
    } finally {
      if (channel === 'building') this.busy = false; else this.consoleBusy = false;
      if (this.pending === pending) this.pending = null;
      this.lastCall = this.now();
    }
  }
}
