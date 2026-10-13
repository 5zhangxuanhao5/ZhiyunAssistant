// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function defaultPaneChoices() { return { slides: true, transcript: true, video: false, notes: false, ai: false, summary: false }; }
export function normalizePaneChoices(raw) { const defaults = defaultPaneChoices(); return { slides: typeof raw?.slides === 'boolean' ? raw.slides : defaults.slides, transcript: typeof raw?.transcript === 'boolean' ? raw.transcript : defaults.transcript, video: typeof raw?.video === 'boolean' ? raw.video : defaults.video, notes: typeof raw?.notes === 'boolean' ? raw.notes : defaults.notes, ai: typeof raw?.ai === 'boolean' ? raw.ai : defaults.ai, summary: typeof raw?.summary === 'boolean' ? raw.summary : defaults.summary }; }
export function missingPaneKey(ids) { return ['slides', 'transcript', 'video'].filter((id) => ids.includes(id)).join('|'); }
export function chosenPanes(preferences, absent) { const key = missingPaneKey(absent), choices = normalizePaneChoices(key ? preferences.missing[key] || preferences.regular : preferences.regular); absent.forEach((id) => { if (id === 'slides')
    choices.slides = false; if (id === 'transcript')
    choices.transcript = false; if (id === 'video')
    choices.video = false; }); return choices; }
export function rememberPaneChoices(preferences, choices, absent) { const key = missingPaneKey(absent), missing = {}; Object.keys(preferences.missing).forEach((id) => missing[id] = preferences.missing[id]); if (key)
    missing[key] = normalizePaneChoices(choices); return { regular: key ? normalizePaneChoices(preferences.regular) : normalizePaneChoices(choices), missing }; }
