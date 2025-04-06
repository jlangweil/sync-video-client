import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import Room from './components/Room/Room';
import JoshTVBanner from './components/JoshTVBanner';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app-container">
        <header>
          <JoshTVBanner />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<Room />} />
          </Routes>
        </main>
        <footer>
          <p>© 2025 JEL</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;