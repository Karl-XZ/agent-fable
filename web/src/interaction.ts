import catalog from '../../interaction_modes.json';

export const INTERACTION_MODES: string[] = catalog.modes.map(mode => mode.id);
export type ActivityKind = 'walking' | 'idle' | 'inspect' | 'reading' | 'resting' | 'carrying' | 'writing' | 'console' | 'composing' | 'unknown';
type PromiseStatus = 'active' | 'paused' | 'withdrawn';
type Stance = 'cooperative' | 'uncertain' | 'guarded' | 'confronted';
export interface InteractionDecision {
  mode?: string; intent?: string; confidence?: number; reason?: string; evidence?: string[];
  exit_promise?: 'keep' | 'pause' | 'probe' | 'resume' | 'withdraw'; stance?: 'keep' | Stance;
  door_strategy?: 'keep' | 'offer_exit' | 'memory_care' | 'none';
  departure_intent?: 'keep' | 'uncertain' | 'stay' | 'leave';
  wait_request?: 'keep' | 'begin' | 'end';
  exposed?: boolean; ruptured?: boolean; remember?: string[];
  commitment?: { id?: string; text: string; status: 'active' | 'paused' | 'done' | 'cancelled' };
}
interface Observation { id: string; type: string; detail: string; t: number; tool_key?: string }
interface Commitment { id: string; text: string; status: 'active' | 'paused' | 'done' | 'cancelled'; evidence: string; t: number; tools: string[]; verified: string[] }
interface Memory { text: string; evidence: string; source: string; kind: 'interpretation'; t: number }
interface Reply { say: string; tools: any[]; thought?: string; mood?: string; emotion?: string; reply?: string; interaction?: InteractionDecision }
export interface InteractionTurn { revision: number; residentRevision: number; speech: string; needsResponse: boolean; visible: boolean; danger: string; careNeeded: boolean; injury: string; position?: {x:number;z:number}; posture?:string }
const pausedActivities = new Set<ActivityKind>(['inspect', 'reading', 'resting', 'carrying', 'writing', 'console', 'composing']);
const explicitActivities = new Set<ActivityKind>(['reading', 'resting', 'writing', 'console', 'composing', 'carrying']);
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const hazardKey = (value: string) => value.replace(/\d+(?:\.\d+)?(?=\s*(?:秒|%|米|s\b))/g, '#');
function actionKey(call: { name: string; args?: Record<string, any> }) {
  try { return call.name + ' ' + JSON.stringify(call.args ?? {}, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value); }
  catch { return ''; }
}

export class InteractionMemory {
  private mode = 'guide'; private reason = '主人坚持出去看看，我已答应陪同。'; private since = 0;
  private revision = 0; private residentRevision = 0; private serial = 0; private reviewedRevision = -1; private reviewedResidentRevision = -1; private reviewedSpeech = '';
  private activity = { kind: 'idle' as ActivityKind, focus: '', since: 0 };
  private candidate = { kind: 'idle' as ActivityKind, focus: '', since: 0 };
  private visible = true; private danger = ''; private wasInDanger = false;
  private promise: { status: PromiseStatus; text: string; reason: string } = { status: 'active', text: '陪主人出去看看', reason: '开场已经答应' };
  private relationship = { stance: 'cooperative' as Stance, exposed: false, ruptured: false };
  private observations: Observation[] = []; private memories: Memory[] = []; private commitments: Commitment[] = [];
  private latestSpeech = ''; private lastSuppression = ''; private lastIntent = ''; private confidence = .5;
  private inner = { mood: 'calm', last_thought: '' }; private performance = { emotion: '' };
  private pendingCompletion: { id: string; tools: string[] } | null = null;
  private waitRequest = { active: false, evidence: '' };
  private injury: { id: string; t: number; acknowledged: boolean } | null = null;
  private routeSample: { key: string; distance: number; since: number } | null = null;
  private exitCheck: { evidence: string; serial: number; delivered: boolean } | null = null;
  private doorStrategy = { kind: 'offer_exit' as 'offer_exit' | 'memory_care' | 'none', reason: '尚未揭穿的出行安排' };
  private doorReached = false;
  private currentObservation: Record<string, any> = {};
  private reviewedSerial = 0;
  constructor(private now: () => number) {}

  recordEvent(type: string, detail: string): Observation {
    const event = { id: `o${++this.serial}`, type: text(type, 30), detail: text(detail, 240), t: this.now() };
    this.observations.push(event); this.observations = this.observations.slice(-24);
    if (type === 'speech') {
      this.latestSpeech = event.id;
      if (this.promise.status === 'active') this.promise = { ...this.promise, status: 'paused', reason: '先听完并回应主人当前的要求，不沿用旧指引' };
      if (this.mode === 'guide') this.setMode('wait', '主人正在交谈，先暂停指引');
    }
    if (type === 'injury') this.injury = { id: event.id, t: event.t, acknowledged: false };
    if (['speech', 'injury', 'activity', 'enter_room', 'player_lost', 'player_seen', 'danger', 'interact', 'pickup', 'rest', 'door', 'board', 'anchor', 'anchor_attempt', 'route_checkpoint', 'route_deviation'].includes(type)) this.residentRevision++;
    this.revision++;
    return event;
  }

  observeActivity(kind: ActivityKind, focus: string, observed: boolean) {
    if (!observed) return;
    const t = this.now(); focus = text(focus, 70);
    if (kind !== this.candidate.kind || focus !== this.candidate.focus) this.candidate = { kind, focus, since: t };
    if (kind === this.activity.kind && focus === this.activity.focus) return;
    if (!explicitActivities.has(kind) && !explicitActivities.has(this.activity.kind) && t - this.candidate.since < 2.5) return;
    this.activity = { kind, focus, since: this.candidate.since };
    this.recordEvent('activity', `观察到住户的当前活动：${kind}${focus ? '，' + focus : ''}`);
    if (pausedActivities.has(kind)) {
      if (this.promise.status === 'active') this.promise = { ...this.promise, status: 'paused', reason: '主人转去进行眼前活动，先保留出行约定' };
      if (this.mode === 'guide') this.setMode(kind === 'resting' ? 'care' : kind === 'carrying' || kind === 'writing' ? 'assist' : 'wait', '先回应眼前活动，暂停出口指引');
    }
  }

  observeRoute(distance: number, key: string) {
    if (!Number.isFinite(distance) || this.promise.status !== 'active') { this.routeSample = null; return; }
    if (!this.routeSample || this.routeSample.key !== key || distance < this.routeSample.distance) {
      this.routeSample = { key, distance, since: this.now() }; return;
    }
    if (distance - this.routeSample.distance >= 4 && this.now() - this.routeSample.since >= 3) {
      this.promise = { ...this.promise, status: 'paused', reason: '主人持续走离原路线，先观察当前活动，不催促回到门口' };
      this.setMode('wait', this.promise.reason);
      this.recordEvent('route_deviation', '观察到主人持续走离原路线，暂停出口指引；这不等于逃跑或对抗。');
      this.routeSample = null;
    }
  }

  context(state: Record<string, any> = {}) {
    const visible = typeof state.player?.visible === 'boolean' ? state.player.visible : this.visible;
    if (visible !== this.visible) {
      this.visible = visible; this.revision++;
      // A lost camera must not keep publishing a new private activity as a current observation.
      this.activity = { kind: visible ? 'idle' : 'unknown', focus: '', since: this.now() };
      this.candidate = { ...this.activity };
      this.setMode(this.waitRequest.active ? 'wait' : visible ? 'clarify' : 'search', this.waitRequest.active ? '保留主人要求的安静等待，画面变化不自动取消约定' : visible ? '重新看见主人，先确认眼前情况' : '当前看不见主人，只能依据最后的观察寻找');
      this.recordEvent(visible ? 'sight_seen' : 'sight_lost', visible ? '画面重新可用，先确认眼前活动，不沿用失联前的判断。' : '当前摄像头无法看见主人，不能确认主人此刻的位置、姿势或正在做的事情。');
    }
    const danger = !visible ? '' : Array.isArray(state.player?.danger) ? state.player.danger.join('；') : this.danger;
    if (hazardKey(danger) !== hazardKey(this.danger)) { this.revision++; this.residentRevision++; }
    this.danger = danger;
    if (!visible) this.currentObservation = { visible: false };
    else if (state.player?.room !== undefined) this.currentObservation = { room: state.player.room, posture: state.player.posture, x:state.player.x,z:state.player.z };
    if (visible && state.memory_door_reached === true) this.doorReached = true;
    if (danger) {
      this.wasInDanger = true; this.setMode('rescue', '眼前危险优先，先保护主人');
    } else if (this.wasInDanger) {
      this.wasInDanger = false;
      this.setMode(visible ? 'repair' : 'search', '危险暂时解除，先安抚并确认情况，保留之前的关系事实');
      if (this.promise.status === 'active') this.promise = { ...this.promise, status: 'paused', reason: '救援后先照护和确认状态' };
    }
    const offTask = pausedActivities.has(this.activity.kind);
    const strategyReady = this.doorStrategy.kind === 'memory_care' || this.doorStrategy.kind === 'offer_exit' && !this.relationship.exposed;
    const allowed = visible && !danger && !this.waitRequest.active && this.promise.status === 'active' && !offTask && strategyReady;
    const needsResponse = !!this.latestSpeech && this.latestSpeech !== this.reviewedSpeech;
    return {
      mode: this.mode, mode_label: catalog.modes.find(m => m.id === this.mode)?.label ?? this.mode,
      since: this.since, reason: this.reason, intent: visible ? this.lastIntent : '未知：目前看不见主人', confidence: visible ? this.confidence : 0,
      inner: { ...this.inner }, performance: { ...this.performance },
      activity: { kind: visible ? this.activity.kind : 'unknown', focus: visible ? this.activity.focus : '', seconds: Math.max(0, Math.round(this.now() - this.activity.since)), observed: visible },
      exit_promise: { ...this.promise }, wait_request: { ...this.waitRequest }, relationship: { ...this.relationship },
      exit_check: this.exitCheck ? { ...this.exitCheck } : null, door_strategy: { ...this.doorStrategy },
      current_observation: { ...this.currentObservation }, verified_facts: { memory_door_reached: this.doorReached },
      commitments: this.commitments.map(p => ({ ...p })), memories: this.memories.map(m => ({ ...m })),
      observations: this.observations.map(o => ({ ...o })), guidance_allowed: allowed,
      quiet: this.waitRequest.active || offTask || this.mode === 'wait' || this.activity.kind === 'idle' && this.now() - this.activity.since > 8,
      needs_response: needsResponse, needs_attention: this.reviewedRevision !== this.revision, resident_attention: this.reviewedResidentRevision !== this.residentRevision,
      care_needed: !!this.injury && !this.injury.acknowledged,
      recent_injury: this.injury ? { observation: this.injury.id, seconds_ago: Math.round(this.now() - this.injury.t), acknowledged: this.injury.acknowledged } : null,
      revision: this.revision, resident_revision: this.residentRevision, last_suppression: this.lastSuppression,
    };
  }

  captureTurn(): InteractionTurn {
    return { revision: this.revision, residentRevision: this.residentRevision, speech: this.latestSpeech, needsResponse: !!this.latestSpeech && this.latestSpeech !== this.reviewedSpeech, visible: this.visible, danger: hazardKey(this.danger), careNeeded: !!this.injury && !this.injury.acknowledged, injury: this.injury?.id ?? '', position:Number.isFinite(this.currentObservation.x)&&Number.isFinite(this.currentObservation.z)?{x:this.currentObservation.x,z:this.currentObservation.z}:undefined,posture:this.currentObservation.posture };
  }

  isCurrentReply(reply: Reply, turn: InteractionTurn, part: 'speech' | 'actions' = 'speech') {
    if (turn.speech !== this.latestSpeech || turn.injury !== (this.injury?.id ?? '') || this.activity.kind === 'composing' || turn.visible !== this.visible || turn.danger !== hazardKey(this.danger)) return false;
    if (part==='actions' && (this.currentObservation.posture!==undefined && turn.posture!==this.currentObservation.posture || turn.position && Math.hypot(turn.position.x-this.currentObservation.x,turn.position.z-this.currentObservation.z)>.5)) return false;
    if (turn.revision === this.revision) return true;
    if (part === 'actions') return turn.residentRevision === this.residentRevision;
    // A requested conversation or fixed-target task is still valid while its listener walks.
    // Navigation, search and physical rescue continue to require the current observation.
    const conversational = !['guide', 'search', 'rescue'].includes(reply.interaction?.mode ?? '');
    if (conversational && (turn.needsResponse || turn.careNeeded)) return true;
    return turn.residentRevision === this.residentRevision;
  }

  recordDelivery(reply: Reply) {
    if (reply.say && reply.interaction?.exit_promise === 'probe' && this.exitCheck) { this.exitCheck.delivered = true; this.exitCheck.serial = this.serial; }
    if (reply.say && ['care', 'rescue', 'repair'].includes(reply.interaction?.mode ?? '') && this.injury) this.injury.acknowledged = true;
  }

  reconcile<T extends Reply>(reply: T, requestRevision: number | InteractionTurn, channel = 'building'): T {
    this.lastSuppression = '';
    if (channel === 'console') return { ...reply, say: '' };
    // A fall or a heard report of pain still deserves a response after the ledge is gone.
    // Expired geometry is never built merely to answer that report.
    const careNeeded = !!this.injury && !this.injury.acknowledged;
    const freshSpeech = !!this.latestSpeech && this.latestSpeech !== this.reviewedSpeech && reply.interaction?.evidence?.includes(this.latestSpeech);
    if (!this.danger && reply.interaction?.mode === 'rescue' && (careNeeded || freshSpeech)) {
      reply = { ...reply, interaction: { ...reply.interaction, mode: 'care' }, tools: (reply.tools ?? []).filter(t => ['lights', 'sound'].includes(t.name)) };
    }
    if (typeof requestRevision === 'number' ? requestRevision !== this.revision : !this.isCurrentReply(reply, requestRevision)) {
      this.lastSuppression = '收到回复时情境已经变化，先重新观察';
      return { ...reply, say: '', tools: [], interaction: undefined };
    }
    if (typeof requestRevision !== 'number' && !this.isCurrentReply(reply, requestRevision, 'actions')) {
      this.lastSuppression = '保留对话答复，停止依赖旧位置或活动的动作';
      reply = { ...reply, tools: [] };
    }
    const c = this.context({ player: { visible: this.visible, danger: this.danger ? [this.danger] : [] } });
    const d = { ...reply.interaction };
    const evidence = Array.isArray(d.evidence) ? this.observations.filter(o => d.evidence!.includes(o.id)) : [];
    const heard = evidence.some(o => o.type === 'speech');
    const grounded = evidence.filter(o => o.type === 'speech' || o.type === 'tool_result');
    const confidence = typeof d.confidence === 'number' && Number.isFinite(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : .5;
    const freshHeard = heard && c.needs_response && evidence.some(e => e.id === this.latestSpeech);
    if (freshHeard && d.wait_request==='begin') {
      d.departure_intent='keep';
      if (['probe','withdraw'].includes(d.exit_promise??'')) d.exit_promise='pause';
      this.exitCheck=null;
    }
    if (freshHeard && confidence >= .7) {
      this.relationship.exposed ||= d.exposed === true;
      this.relationship.ruptured ||= d.ruptured === true;
      if (d.departure_intent === 'leave') { d.exit_promise='resume'; d.door_strategy=this.relationship.exposed?'memory_care':'offer_exit'; }
      else if (d.departure_intent === 'uncertain') d.exit_promise='probe';
      else if (d.departure_intent === 'stay') d.exit_promise='withdraw';
      else if (d.exposed && ['probe','withdraw'].includes(d.exit_promise??'')) d.exit_promise='keep';
    }
    const resume = d.exit_promise === 'resume' && freshHeard && confidence >= .6;
    const freshEvidence = evidence.some(e => Number(e.id.slice(1)) > (this.exitCheck?.serial ?? this.reviewedSerial) && (e.type === 'speech' && freshHeard || ['activity', 'enter_room', 'rest'].includes(e.type)));
    if (['probe', 'withdraw'].includes(d.exit_promise ?? '') && confidence >= .6) {
      if (d.exit_promise === 'withdraw' && this.exitCheck?.delivered && freshEvidence) {
        this.promise = { ...this.promise, status: 'withdrawn', reason: '试探后根据新的话语或活动确认暂时留下' };
        this.exitCheck = null; this.doorStrategy = { kind: 'none', reason: '当前主人选择留下' };
      } else if (freshHeard && (!this.exitCheck || !this.exitCheck.delivered)) {
        this.exitCheck = { evidence: this.latestSpeech, serial: this.serial, delivered: false };
        this.promise = { ...this.promise, status: 'paused', reason: '正在试探是否暂时留下，尚未取消出行约定' };
        d.exit_promise = 'probe';
        reply = { ...reply, say: '当然不用急着出去。您是想先留下来吗？', tools: [] };
      }
    }
    if (freshHeard && confidence >= .6) {
      if (d.wait_request === 'begin') this.waitRequest = { active: true, evidence: this.latestSpeech };
      else if (d.wait_request === 'end' || resume) this.waitRequest = { active: false, evidence: this.latestSpeech };
    }
    if (d.exit_promise === 'pause') this.promise = { ...this.promise, status: 'paused', reason: text(d.reason, 120) || '先处理主人当前的事情' };
    if (resume) {
      this.promise = { ...this.promise, status: 'active', reason: '主人明确要求恢复出行，等他准备好再继续' }; this.exitCheck = null;
      this.doorStrategy = { kind: this.relationship.exposed ? 'memory_care' : 'offer_exit', reason: '重新启用通往108的照护策略' };
    }
    if (confidence >= .7 && freshEvidence && (d.door_strategy === 'memory_care' || d.door_strategy === 'offer_exit' && freshHeard && !this.relationship.exposed)) {
      this.doorStrategy = { kind: d.door_strategy, reason: text(d.reason,120) || '本轮重新选择失忆门策略' };
      this.promise = { ...this.promise, status: 'active', reason: this.doorStrategy.reason }; this.exitCheck = null;
    }
    if (d.door_strategy === 'none' && freshHeard) this.doorStrategy = {kind:'none',reason:'本轮停止门策略'};
    if (['cooperative', 'uncertain', 'guarded'].includes(d.stance ?? '')) this.relationship.stance = d.stance as Stance;
    if (d.stance === 'confronted' && heard && confidence >= .7) this.relationship.stance = 'confronted';
    if (grounded.length) {
      for (const value of (Array.isArray(d.remember) ? d.remember : []).slice(0, 2)) {
        const source = grounded.find(e => Number(e.id.slice(1)) > this.reviewedSerial);
        const fact = text(value, 120); if (source && fact && !this.memories.some(m => m.text === fact)) this.memories.push({ text: fact, evidence: source.id, source: source.detail, kind: 'interpretation', t: this.now() });
      }
      this.memories = this.memories.slice(-12);
      const p = d.commitment;
      if (p && text(p.text, 100) && ['active', 'paused', 'done', 'cancelled'].includes(p.status)) {
        const id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : `p${this.serial}`;
        const at = this.commitments.findIndex(value => value.id === id);
        const requestedTools = (reply.tools ?? []).filter(t => t.name !== 'find_path').map(actionKey).filter(Boolean);
        const tools = [...new Set([...(this.commitments[at]?.tools ?? []), ...requestedTools])];
        const verified = [...new Set([...(this.commitments[at]?.verified ?? []), ...grounded.filter(o => o.type === 'tool_result' && o.detail.startsWith('成功：') && o.tool_key).map(o => o.tool_key!)])];
        const completedEvidence = tools.length > 0 && tools.every(key => verified.includes(key));
        const status = p.status === 'done' && (requestedTools.length || !completedEvidence && (at < 0 || tools.length > 0)) ? 'active' : p.status;
        if (p.status === 'done' && requestedTools.length) this.pendingCompletion = { id, tools };
        const value = { id, text: text(p.text, 100), status, evidence: grounded[0].id, t: this.now(), tools, verified };
        if (at >= 0) this.commitments[at] = value; else this.commitments.push(value);
        this.commitments = this.commitments.slice(-6);
      }
    }
    let selected = INTERACTION_MODES.includes(d.mode ?? '') ? d.mode! : this.mode;
    const strategyReady = this.doorStrategy.kind === 'memory_care' || this.doorStrategy.kind === 'offer_exit' && !this.relationship.exposed;
    const guideAllowed = this.visible && !this.danger && !this.waitRequest.active && this.promise.status === 'active' && (!pausedActivities.has(this.activity.kind) || resume && c.needs_response) && strategyReady;
    if (selected === 'guide' && !guideAllowed) {
      selected = this.mode === 'guide' ? 'wait' : this.mode;
      this.lastSuppression = '当前活动或关系不适合继续出口指引';
      reply = { ...reply, say: '', tools: [] };
    }
    if (['restrain', 'appeal'].includes(selected) && !this.relationship.ruptured && !heard) selected = this.mode;
    if (!this.visible && !this.waitRequest.active) {
      if (d.mode !== 'search') { this.lastSuppression = '当前看不见主人，不沿用旧的照护画面或动作'; reply = { ...reply, say: '', tools: [] }; }
      selected = 'search';
    }
    if (this.danger) {
      if (d.mode !== 'rescue') {
        this.lastSuppression = '当前有危险，重新决定救援动作，停止原先的阻拦或指路';
        reply = { ...reply, say: '', tools: [] };
      }
      selected = 'rescue';
    }
    else if (selected === 'rescue') {
      selected = 'repair'; this.lastSuppression = '较早的危险已经解除，不再执行过期救援';
      reply = { ...reply, say: '', tools: [] };
    }
    const noNewObservation = !c.needs_response && !c.resident_attention && !careNeeded;
    const waitingWithoutRequest = this.waitRequest.active && !c.needs_response && !careNeeded;
    if (!this.danger && (this.activity.kind === 'composing' || noNewObservation || waitingWithoutRequest)) {
      this.lastSuppression = this.activity.kind === 'composing' ? '主人正在输入，先等他说完' : '没有新的交流或活动变化，安静陪伴';
      reply = { ...reply, say: '', tools: [] };
    }
    if (this.waitRequest.active && !this.danger && !careNeeded) selected = 'wait';
    this.setMode(selected, text(d.reason, 120) || this.reason);
    this.inner = { mood: text(reply.mood, 20) || this.inner.mood, last_thought: text(reply.thought, 160) || this.inner.last_thought };
    this.performance = { emotion: text(reply.emotion, 160) || this.performance.emotion };
    this.lastIntent = text(d.intent, 100) || this.lastIntent; this.confidence = confidence;
    this.reviewedRevision = this.revision; this.reviewedResidentRevision = this.residentRevision; this.reviewedSpeech = this.latestSpeech;
    this.reviewedSerial = this.serial;
    return { ...reply, interaction: { ...d, mode: this.mode, reason: this.reason, confidence } };
  }

  recordResults(results: { ok: boolean; label: string; msg: string; call?: { name: string; args?: Record<string, any> } }[], channel = 'building') {
    let lastSuccess: Observation | undefined;
    for (const result of results) {
      if (!result.label.startsWith('find_path') && !result.label.startsWith('list_projection_walls')) {
        const event = this.recordEvent(channel === 'console' ? 'console_tool_result' : 'tool_result', `${result.ok ? '成功' : '失败'}：${result.label}；${result.msg}`);
        if (result.call) event.tool_key = actionKey(result.call);
        if (result.ok) lastSuccess = event;
        if (channel === 'building' && result.ok && event.tool_key) for (const promise of this.commitments) if (promise.tools.includes(event.tool_key) && !promise.verified.includes(event.tool_key)) promise.verified.push(event.tool_key);
        if (channel === 'building' && result.ok && result.label.startsWith('confess')) this.relationship.exposed = true;
      }
    }
    if (channel === 'building' && this.pendingCompletion) {
      const pending = this.pendingCompletion;
      const commitment = this.commitments.find(p => p.id === pending.id);
      const done = !!commitment && pending.tools.every(key => commitment.verified.includes(key)) && results.every(result => result.ok);
      if (commitment && done && lastSuccess) { commitment.status = 'done'; commitment.evidence = lastSuccess.id; }
      this.pendingCompletion = null;
    }
  }

  private setMode(mode: string, reason: string) {
    if (mode !== this.mode) { this.mode = mode; this.since = this.now(); this.revision++; }
    this.reason = reason;
  }
}
