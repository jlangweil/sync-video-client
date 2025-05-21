import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Home from './components/Home';
import Room from './components/Room/Room';
import JoshTVBanner from './components/JoshTVBanner';
import ChatOnlyRoom from './components/Room/ChatOnlyRoom';

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
    <BrowserRouter>
      <JoshTVBanner/>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/chat/:roomId" element={<ChatOnlyRoom />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);