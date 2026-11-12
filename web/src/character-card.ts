import definition from '../../character_card.json';

export const DEFAULT_FIELDS = definition.fields;
export const FIELD_LIMITS = definition.limits;
export const FIELD_LABELS = definition.labels;
export type CardFields = typeof DEFAULT_FIELDS;
export interface CharacterCard { schema_version: 1; fields: Partial<CardFields> }
export const CARD_KEY = 'agent-fable.jing-card.v1';
export const UNLOCK_KEY = 'agent-fable.jing-card-unlocked.v1';
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keys = Object.keys(DEFAULT_FIELDS) as (keyof CardFields)[];
function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
function normalize(value: unknown): CardFields {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(keys.map(key => [key, typeof input[key] === 'string' && (input[key] as string).trim() ? (input[key] as string).slice(0, FIELD_LIMITS[key]) : DEFAULT_FIELDS[key]])) as CardFields;
}
export class CharacterCardStore {
  unlocked = false;
  storageError = false;
  private overrides: Partial<CardFields> = {};
  constructor(private storage: BrowserStorage | undefined = browserStorage()) {
    try {
      if (!storage) { this.storageError = true; return; }
      this.unlocked = storage.getItem(UNLOCK_KEY) === '1';
      const raw = storage.getItem(CARD_KEY);
      if (raw) {
        let saved;
        try { saved = JSON.parse(raw); } catch { return; }
        if (saved?.schema_version === 1) this.setOverrides(saved.fields);
      }
    } catch { this.storageError = true; }
  }
  values(): CardFields { return { ...DEFAULT_FIELDS, ...this.overrides }; }
  payload(): CharacterCard | undefined {
    return this.unlocked && Object.keys(this.overrides).length ? { schema_version: 1, fields: { ...this.overrides } } : undefined;
  }
  unlock(ending: string) {
    if (ending !== 'out' || this.unlocked) return false;
    this.unlocked = true;
    try { this.storage?.setItem(UNLOCK_KEY, '1'); } catch { this.storageError = true; }
    return true;
  }
  save(fields: unknown) {
    if (!this.unlocked) return false;
    this.setOverrides(fields);
    try {
      if (Object.keys(this.overrides).length) this.storage?.setItem(CARD_KEY, JSON.stringify(this.payload()));
      else this.storage?.removeItem(CARD_KEY);
    } catch { this.storageError = true; }
    return true;
  }
  reset() {
    this.overrides = {};
    try { this.storage?.removeItem(CARD_KEY); } catch { this.storageError = true; }
  }
  private setOverrides(fields: unknown) {
    const all = normalize(fields);
    this.overrides = Object.fromEntries(keys.filter(key => all[key] !== DEFAULT_FIELDS[key]).map(key => [key, all[key]]));
  }
}
