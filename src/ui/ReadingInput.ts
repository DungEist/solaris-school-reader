const interactiveSelector = 'input, select, textarea, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="tab"]';

type ReadingKey = Pick<KeyboardEvent, 'key' | 'repeat' | 'isComposing' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export function isReadingKey(event: ReadingKey): boolean {
  return [' ', 'Enter'].includes(event.key) && !event.repeat && !event.isComposing && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return !!target && 'closest' in target && typeof target.closest === 'function' && !!target.closest(interactiveSelector);
}

export function shouldHandleReadingShortcut(event: ReadingKey & Pick<KeyboardEvent, 'target'>): boolean {
  return isReadingKey(event) && !isInteractiveTarget(event.target);
}
