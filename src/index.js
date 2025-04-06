import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Polyfill for process to fix WebRTC compatibility issues
if (typeof window !== 'undefined' && !window.process) {
  window.process = {
    env: {
      NODE_ENV: window.location.hostname.includes('localhost') ? 'development' : 'production'
    },
    nextTick: function(callback) {
      setTimeout(callback, 0);
    }
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);