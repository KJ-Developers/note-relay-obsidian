/**
 * Note Relay UI - Entry Point
 * Bootstraps the application and initializes all modules
 */

import './styles/main.css';
import 'easymde/dist/easymde.min.css';
import 'prismjs/themes/prism-tomorrow.css';

import { initApp } from './core/app.js';
import { getIdentity } from './core/identity.js';

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('🚀 Note Relay UI Initializing...');
  
  // Read identity injected by server (optional for now)
  const identity = getIdentity();
  if (identity && identity.email) {
    console.log('📧 Identity:', identity.email);
    console.log('🔑 License:', identity.licenseType);
  }
  
  // Initialize the application
  initApp();
}
