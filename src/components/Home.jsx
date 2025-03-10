import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = 3000; // Your server port
  
  return `${protocol}//${hostname}:${port}`;
};

// Use this server URL for API calls
const SERVER_URL = getServerUrl();

function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [joining, setJoining] = useState(false);
  
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a video file');
      return;
    }
    
    if (!username) {
      setError('Please enter a username');
      return;
    }

    console.log('Uploading file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB', 'Type:', file.type);

    const formData = new FormData();
    formData.append('video', file);

    setLoading(true);
    setError('');
    
    try {
      console.log('Sending upload request to:', `${SERVER_URL}/upload`);
      const response = await axios.post(`${SERVER_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000, // 5 minutes
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`Upload progress: ${percentCompleted}%`);
        }
      });
      
      console.log('Upload successful:', response.data);
      localStorage.setItem('username', username);
      localStorage.setItem('videoUrl', response.data.videoUrl);
      localStorage.setItem('isHost', 'true');
      
      navigate(`/room/${response.data.roomId}`);
    } catch (err) {
      console.error('Upload error:', err);
      
      // Provide detailed error information
      if (err.response) {
        // The server responded with a status code outside the 2xx range
        console.error('Server response:', err.response.data);
        setError(`Server error: ${err.response.status} - ${err.response.data.error || 'Unknown error'}`);
      } else if (err.request) {
        // The request was made but no response was received
        console.error('No response received:', err.request);
        setError('No response from server. The upload may have timed out or the server might be down.');
      } else {
        // Something happened in setting up the request
        console.error('Request setup error:', err.message);
        setError(`Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }
    
    if (!username) {
      setError('Please enter a username');
      return;
    }
    
    localStorage.setItem('username', username);
    localStorage.setItem('isHost', 'false');
    
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="home-container">
      <div className="tabs">
        <button 
          className={!joining ? 'active' : ''} 
          onClick={() => setJoining(false)}
        >
          Create Room
        </button>
        <button 
          className={joining ? 'active' : ''} 
          onClick={() => setJoining(true)}
        >
          Join Room
        </button>
      </div>
      
      {!joining ? (
        <div className="create-room">
          <h2>Create a new viewing room</h2>
          <form onSubmit={handleUpload}>
            <div className="form-group">
              <label htmlFor="username">Your Name:</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            
            <div className="form-group file-input">
              <label htmlFor="video">Upload Video:</label>
              <input
                type="file"
                id="video"
                accept="video/*"
                onChange={handleFileChange}
              />
              <p className="file-name">{file ? file.name : 'No file selected'}</p>
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              className="primary-button"
            >
              {loading ? 'Uploading...' : 'Create Room'}
            </button>
          </form>
        </div>
      ) : (
        <div className="join-room">
          <h2>Join an existing room</h2>
          <form onSubmit={handleJoinRoom}>
            <div className="form-group">
              <label htmlFor="join-username">Your Name:</label>
              <input
                type="text"
                id="join-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="room-id">Room ID:</label>
              <input
                type="text"
                id="room-id"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
                required
              />
            </div>
            
            <button type="submit" className="primary-button">
              Join Room
            </button>
          </form>
        </div>
      )}
      
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export default Home;