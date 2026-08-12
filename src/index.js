/**
 * index.js
 *
 * Entry point. Mounts the app and registers the service worker.
 */

import App from './ui/App.js';

function mount() {
  const container = document.getElementById('app');

  if (!container) {
    console.error('Missing #app container');
    return;
  }

  try {
    // Keep a handle for debugging from the console
    window.trainer = new App(container);
  } catch (error) {
    console.error('Failed to start:', error);
    container.innerHTML =
      '<div class="boot"><p class="boot__text">Something went wrong starting the game.<br>' +
      'Pull to refresh, or clear site data if it keeps happening.</p></div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

// Offline support. Registration failures are non-fatal - the app still runs.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
