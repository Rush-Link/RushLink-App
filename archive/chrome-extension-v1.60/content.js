// Headrush Companion — content script
// 1. Injects extension ID into the DOM so the page can call chrome.runtime.sendMessage directly.
// 2. Relays chrome.storage host changes to the page as a CustomEvent.

const div = document.createElement('div');
div.id = 'headrush-companion-data';
div.dataset.extensionId = chrome.runtime.id;
div.style.display = 'none';

if (document.documentElement) {
  document.documentElement.appendChild(div);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    (document.body || document.documentElement).appendChild(div);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'host' in changes) {
    window.dispatchEvent(new CustomEvent('headrush-host-changed', {
      detail: { host: changes.host.newValue || null }
    }));
  }
});
