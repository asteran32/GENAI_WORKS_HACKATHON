import { UI } from './i18n.js';

// Interface preview only: no API calls, generated replies or persistent storage.
export function initialiseChat(root = document) {
  const $ = id => root.getElementById(id);
  const launcher = $('chat-launcher'), panel = $('chat-panel'), input = $('chat-input');
  const form = $('chat-form'), send = $('chat-send'), clear = $('chat-clear');
  const welcome = $('chat-welcome'), messages = $('chat-messages'), scroll = $('chat-scroll');
  const status = $('chat-status');

  // Chat remains usable even if the independent 3D scene cannot initialise.
  for (const attribute of ['data-i18n', 'data-i18n-label', 'data-i18n-title', 'data-i18n-placeholder']) {
    for (const el of [launcher, panel, ...panel.querySelectorAll(`[${attribute}]`)]) {
      const key = el.getAttribute(attribute);
      if (!key) continue;
      const value = UI[key];
      if (attribute === 'data-i18n') el.textContent = value;
      else el.setAttribute({ 'data-i18n-label': 'aria-label', 'data-i18n-title': 'title', 'data-i18n-placeholder': 'placeholder' }[attribute], value);
    }
  }

  function updateComposer() {
    send.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = Math.min(112, Math.max(48, input.scrollHeight)) + 'px';
  }
  function close() { panel.close(); }
  launcher.addEventListener('click', () => {
    if (panel.open) { close(); return; }
    panel.showModal(); launcher.setAttribute('aria-expanded', 'true');
    updateComposer(); input.focus({ preventScroll: true });
  });
  $('chat-close').addEventListener('click', close);
  panel.addEventListener('close', () => { launcher.setAttribute('aria-expanded', 'false'); launcher.focus({ preventScroll: true }); });
  panel.addEventListener('click', event => {
    if (event.target !== panel) return;
    const rect = panel.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  input.addEventListener('input', updateComposer);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!send.disabled) form.requestSubmit(); }
  });
  panel.querySelectorAll('[data-chat-prompt]').forEach(button => button.addEventListener('click', () => {
    input.value = UI[button.dataset.chatPrompt]; updateComposer(); input.focus({ preventScroll: true });
  }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const message = root.createElement('article'); message.className = 'chat-message chat-message-user';
    const speaker = root.createElement('span'); speaker.className = 'chat-message-speaker'; speaker.textContent = UI.chatYou;
    const body = root.createElement('p'); body.textContent = text;
    message.append(speaker, body); messages.append(message); welcome.hidden = true; clear.disabled = false;
    input.value = ''; updateComposer(); status.textContent = UI.chatSaved;
    scroll.scrollTop = scroll.scrollHeight; input.focus({ preventScroll: true });
  });
  clear.addEventListener('click', () => {
    messages.replaceChildren(); welcome.hidden = false; clear.disabled = true;
    input.value = ''; updateComposer(); status.textContent = UI.chatCleared; input.focus({ preventScroll: true });
  });
}

initialiseChat();
