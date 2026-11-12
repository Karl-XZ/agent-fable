import { CharacterCardStore, CardFields, DEFAULT_FIELDS, FIELD_LABELS, FIELD_LIMITS } from './character-card';

export function mountCharacterEditor(store: CharacterCardStore, onOpen: () => void, notify: (text: string) => void) {
  const button = document.getElementById('btnCharacter') as HTMLButtonElement;
  const screen = document.getElementById('characterEditor')!;
  const form = document.getElementById('characterForm') as HTMLFormElement;
  const fields = document.getElementById('characterFields')!;
  const status = document.getElementById('characterStatus')!;
  const keys = Object.keys(DEFAULT_FIELDS) as (keyof CardFields)[];
  for (const key of keys) {
    const label = document.createElement('label');
    const title = document.createElement('span'); title.textContent = FIELD_LABELS[key];
    const area = document.createElement('textarea'); area.name = key; area.id = 'character-' + key; area.maxLength = FIELD_LIMITS[key]; area.rows = key === 'examples' ? 8 : 4; area.className = 'serif';
    label.append(title, area); fields.append(label);
  }
  function fill(values: CardFields) { for (const key of keys) (form.elements.namedItem(key) as HTMLTextAreaElement).value = values[key]; }
  function refresh() {
    button.disabled = !store.unlocked;
    button.textContent = store.unlocked ? '编辑' : '逃离后解锁';
    document.getElementById('characterSummary')!.textContent = !store.unlocked ? '第一次逃离之后，可以改写她的性格。' : store.payload() ? '当前使用此浏览器的个人角色卡。' : '当前使用静的默认角色卡。';
  }
  function close() { screen.classList.add('hidden'); document.getElementById('pause')!.classList.remove('hidden'); button.focus(); }
  button.onclick = () => {
    if (!store.unlocked) return;
    onOpen(); fill(store.values()); document.getElementById('pause')!.classList.add('hidden');
    status.textContent = store.storageError ? '此浏览器未允许保存，修改仅在当前页面生效。' : '';
    screen.classList.remove('hidden'); (form.elements.namedItem(keys[0]) as HTMLTextAreaElement).focus();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(keys.map(key => [key, (form.elements.namedItem(key) as HTMLTextAreaElement).value]));
    if (store.save(values)) {
      refresh(); close();
      notify(store.storageError ? '浏览器未允许保存，角色卡仅在当前页面生效。' : '角色卡已保存在此浏览器，将用于下一次对话。');
    }
  };
  document.getElementById('characterCancel')!.onclick = close;
  document.getElementById('characterReset')!.onclick = () => { fill({ ...DEFAULT_FIELDS }); status.textContent = '已填入默认设置，保存后生效。'; };
  screen.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.code === 'Escape' && !event.isComposing) { event.preventDefault(); close(); }
    if (event.code === 'Tab') {
      const controls = [...screen.querySelectorAll<HTMLElement>('textarea, button:not([disabled])')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  screen.addEventListener('keyup', event => event.stopPropagation());
  refresh();
  return { refresh };
}
