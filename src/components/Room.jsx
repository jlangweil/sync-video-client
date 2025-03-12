import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import axios from 'axios';
import './Room.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = 3000; // Your server port
  
  return `${protocol}//${hostname}:${port}`;
};

// Use this server URL for both API calls and Socket.io connections
const SERVER_URL = getServerUrl();

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  const [videoUrl, setVideoUrl] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [copySuccess, setCopySuccess] = useState('');
  const [videoFit, setVideoFit] = useState('contain'); // 'contain' or 'cover'
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [isDeletingVideo, setIsDeletingVideo] = useState(false);
  const [videoDeleted, setVideoDeleted] = useState(false);
  const [availableDuration, setAvailableDuration] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [showSeekWarning, setShowSeekWarning] = useState(false);
  const [approachingBoundary, setApproachingBoundary] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  
  // Flag to prevent event loop when receiving remote updates
  const [processingRemoteUpdate, setProcessingRemoteUpdate] = useState(false);
  
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const chatContainerRef = useRef(null);
  
  // Use a ref to track last sent state to avoid unnecessary rerenders
  const lastSentState = useRef(null);
  
  // Handle sync status
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const toggleTheaterMode = () => {
    setIsTheaterMode(!isTheaterMode);
    // Focus back on the video element after toggling
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.focus();
      }
    }, 100);
  };
  
  // Function to get absolute URL for video
  const getAbsoluteVideoUrl = (url) => {
    if (!url) return '';
    
    // If it's already an absolute URL, return it
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Make sure it starts with a slash
    if (!url.startsWith('/')) {
      url = '/' + url;
    }
    
    // Convert to absolute URL using the dynamic server URL
    return `${SERVER_URL}${url}`;
  };
  
  // Initialize socket and room
  useEffect(() => {
    // Get data from localStorage
    const storedUsername = localStorage.getItem('username');
    const storedVideoUrl = localStorage.getItem('videoUrl');
    const storedIsHost = localStorage.getItem('isHost') === 'true';
    
    if (!storedUsername) {
      navigate('/');
      return;
    }
    
    setUsername(storedUsername);
    setIsHost(storedIsHost);
    
    if (storedVideoUrl) {
      console.log('Retrieved stored video URL:', storedVideoUrl);
      setVideoUrl(storedVideoUrl);
    }
    
    // Initialize socket with dynamic server URL
    console.log('Connecting to socket server at:', SERVER_URL);
    socketRef.current = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });
    
    // Add connection logging
    socketRef.current.on('connect', () => {
      console.log('Connected to server with socket ID:', socketRef.current.id);
      
      // Join room after successful connection
      socketRef.current.emit('joinRoom', {
        roomId,
        username: storedUsername,
        isHost: storedIsHost
      });
      
      // If this user is the host and has a video URL, share it with the room after a delay
      if (storedIsHost && storedVideoUrl) {
        console.log('Host is sharing video URL:', storedVideoUrl);
        setTimeout(() => {
          console.log('Emitting shareVideo event');
          socketRef.current.emit('shareVideo', {
            roomId,
            videoUrl: storedVideoUrl
          });
        }, 2000); // Delay to ensure room is joined first
      }
    });
    
    socketRef.current.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
    
    // Handle user joined
    socketRef.current.on('userJoined', (data) => {
      console.log('User joined event:', data);
      setUsers(data.users);
      
      // Add system message
      if (data.user.id !== socketRef.current.id) {
        addSystemMessage(`${data.user.username} has joined the room`);
        
        // If we're the host and have a video, re-share it when a new user joins
        if (storedIsHost && videoUrl) {
          console.log('Re-sharing video URL after new user joined:', videoUrl);
          setTimeout(() => {
            socketRef.current.emit('shareVideo', {
              roomId,
              videoUrl
            });
            
            // Also send current playback state
            if (videoRef.current) {
              socketRef.current.emit('videoStateChange', {
                roomId,
                videoState: {
                  isPlaying: !videoRef.current.paused,
                  currentTime: videoRef.current.currentTime
                }
              });
            }
          }, 1000);
        }
      }
    });
    
    // Handle user left
    socketRef.current.on('userLeft', (data) => {
      setUsers(data.users);
      addSystemMessage(`${data.username} has left the room`);
    });
    
    // Handle system messages
    socketRef.current.on('systemMessage', (data) => {
      addSystemMessage(data.text);
    });
    
    // Handle upload progress updates
    socketRef.current.on('uploadProgress', (data) => {
      console.log(`Upload progress: ${data.progress}%`);
      setUploadProgress(data.progress);
      setIsUploading(data.progress < 100);
    });
    
    // Handle upload complete notification
    socketRef.current.on('uploadComplete', (data) => {
      console.log('Upload complete:', data);
      setUploadComplete(true);
      setIsUploading(false);
      setUploadProgress(100);
      addSystemMessage('Video upload complete.');
    });
    
    // Handle upload status updates
    socketRef.current.on('uploadStatus', (data) => {
      console.log('Upload status:', data);
      setUploadComplete(data.complete);
      setIsUploading(!data.complete);
    });
    
    // Handle video deletion events
    socketRef.current.on('videoDeleted', () => {
      console.log('Video has been deleted');
      setVideoUrl('');
      setVideoDeleted(true);
      addSystemMessage('The video has been deleted by the host');
    });
    
    // Handle video state updates from server
    socketRef.current.on('videoStateUpdate', (videoState) => {
      if (videoRef.current) {
        console.log('Received video state update:', videoState);
        
        // Set this flag to prevent triggering our own events while updating
        setProcessingRemoteUpdate(true);
        
        // For non-hosts, always follow the host's state
        // For hosts, only apply if it wasn't our own update
        const shouldUpdateTime = !isHost || 
          Math.abs(videoRef.current.currentTime - videoState.currentTime) > 2.0;
        
        if (shouldUpdateTime) {
          videoRef.current.currentTime = videoState.currentTime;
        }
        
        // Set play/pause state (for both host and viewers)
        if (videoState.isPlaying && videoRef.current.paused) {
          videoRef.current.play()
            .catch(err => console.error('Error playing video:', err));
        } else if (!videoState.isPlaying && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        
        setIsSyncing(true);
        setLastSyncTime(new Date());
        
        // Reset sync indicator after 2 seconds
        setTimeout(() => {
          setIsSyncing(false);
        }, 2000);
        
        // Clear the processing flag after a short delay
        // This prevents event handlers from firing during the update
        setTimeout(() => {
          setProcessingRemoteUpdate(false);
        }, 500);
      } else {
        console.log('Received video state update but video element not ready');
      }
    });
    
    // Handle new messages
    socketRef.current.on('newMessage', (message) => {
      setMessages(prevMessages => [...prevMessages, message]);
    });
    
    // Handle video URL updates from other users (mainly the host)
    socketRef.current.on('videoUrlUpdate', ({ videoUrl }) => {
      console.log('Received video URL update:', videoUrl);
      if (videoUrl) {
        setVideoUrl(videoUrl);
        setVideoDeleted(false);
        
        // If we're not the host, show a message
        if (!isHost) {
          addSystemMessage('Video has been shared by the host');
        }
      }
    });
    
    return () => {
      socketRef.current.disconnect();
    };
  }, [roomId, navigate]);
  
  // Add event listeners to intercept unwanted control attempts for viewers
  useEffect(() => {
    if (!isHost && videoRef.current) {
      // Function to intercept and prevent playback control
      const preventPlaybackControl = (e) => {
        // Allow these events to propagate to enable fullscreen and other features
        const allowedEvents = ['mousemove', 'mouseenter', 'mouseleave', 'mouseover'];
        
        // Check if it's a click that could trigger play/pause
        if (e.type === 'click') {
          // Get click position relative to video element
          const rect = videoRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          // Determine if click is in the center play/pause area (rough estimation)
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const clickRadius = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
          
          // If click is in the center area or bottom controls area, prevent it
          const isInPlayPauseArea = clickRadius < rect.width / 6; // Circle in the middle
          const isInControlsArea = y > rect.height - 40; // Bottom controls area
          
          if (isInPlayPauseArea || isInControlsArea) {
            e.preventDefault();
            e.stopPropagation();
            
            // Show message to user
            setIsSyncing(true);
            setTimeout(() => {
              setIsSyncing(false);
            }, 1000);
            
            return false;
          }
        }
        
        // Always allow these events
        if (allowedEvents.includes(e.type)) {
          return true;
        }
        
        // For other events related to playback control, check more carefully
        if (['play', 'pause', 'seeking', 'timeupdate'].includes(e.type)) {
          if (!processingRemoteUpdate) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }
        
        return true;
      };
      
      // Add our custom event listeners
      videoRef.current.addEventListener('click', preventPlaybackControl, true);
      videoRef.current.addEventListener('play', preventPlaybackControl, true);
      videoRef.current.addEventListener('pause', preventPlaybackControl, true);
      videoRef.current.addEventListener('seeking', preventPlaybackControl, true);
      
      return () => {
        // Clean up event listeners when component unmounts
        if (videoRef.current) {
          videoRef.current.removeEventListener('click', preventPlaybackControl, true);
          videoRef.current.removeEventListener('play', preventPlaybackControl, true);
          videoRef.current.removeEventListener('pause', preventPlaybackControl, true);
          videoRef.current.removeEventListener('seeking', preventPlaybackControl, true);
        }
      };
    }
  }, [isHost, processingRemoteUpdate]);
  
  // Effect to calculate available duration based on upload progress
  useEffect(() => {
    if (videoRef.current && totalDuration > 0) {
      // Calculate available duration based on upload progress
      const calculated = (uploadProgress / 100) * totalDuration;
      setAvailableDuration(calculated);
      
      console.log(`Available duration: ${calculated.toFixed(2)}s of ${totalDuration.toFixed(2)}s (${uploadProgress}%)`);
    }
  }, [uploadProgress, totalDuration]);
  
  // Handle video metadata loading
  const handleMetadataLoaded = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      setTotalDuration(duration);
      
      // Update available duration based on current upload progress
      const calculated = (uploadProgress / 100) * duration;
      setAvailableDuration(calculated);
      
      console.log(`Video metadata loaded. Duration: ${duration.toFixed(2)}s`);
    }
  };
  
  // Add a time update handler to prevent playback beyond available content
// Remove or reduce the restrictiveness of the timeupdate handler
useEffect(() => {
    const handleTimeUpdate = () => {
      if (videoRef.current && isUploading) {
        const currentTime = videoRef.current.currentTime;
        
        // If we're approaching the end of available content (within 3 seconds)
        // and still uploading, show a visual indicator to the host
        if (isHost && currentTime > availableDuration - 3 && currentTime < availableDuration) {
          setApproachingBoundary(true);
        } else {
          setApproachingBoundary(false);
        }
        
        // Only restrict playback if we're still uploading
        // If we somehow got beyond the available duration, seek back
        if (currentTime > availableDuration) {
          console.log(`Beyond available duration, seeking back: ${currentTime.toFixed(1)}s > ${availableDuration.toFixed(1)}s`);
          videoRef.current.currentTime = Math.max(0, availableDuration - 1);
        }
      }
    };
    
    if (videoRef.current) {
      // Only add this listener if we're uploading
      if (isUploading) {
        videoRef.current.addEventListener('timeupdate', handleTimeUpdate);
        
        return () => {
          videoRef.current?.removeEventListener('timeupdate', handleTimeUpdate);
        };
      }
    }
  }, [isHost, availableDuration, isUploading, videoRef.current]);
  
  // Periodic sync for host - less frequent and with throttling
  useEffect(() => {
    const handleVideoStateSync = () => {
      if (!videoRef.current || !socketRef.current || !isHost || processingRemoteUpdate) return;
      
      const currentState = {
        isPlaying: !videoRef.current.paused,
        currentTime: videoRef.current.currentTime
      };
      
      // Only send updates if the state has changed significantly
      if (lastSentState.current === null || 
          lastSentState.current.isPlaying !== currentState.isPlaying ||
          Math.abs(lastSentState.current.currentTime - currentState.currentTime) > 5) {
        
        console.log('Sending periodic sync update:', currentState);
        socketRef.current.emit('videoStateChange', {
          roomId,
          videoState: currentState
        });
        
        // Update the last sent state
        lastSentState.current = currentState;
      }
    };
    
    // Set up periodic sync for the host (every 10 seconds instead of 5)
    let syncInterval;
    if (isHost && videoRef.current) {
      syncInterval = setInterval(handleVideoStateSync, 10000);
    }
    
    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [isHost, roomId, processingRemoteUpdate]);
  
  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
  // Handle video loading errors
  useEffect(() => {
    const handleVideoError = (e) => {
      console.error('Video error:', e);
      
      // If the error happens during upload, just wait
      if (isUploading) {
        console.log('Video error during upload, will retry');
        // We can set up a retry mechanism here
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, 5000);
      }
    };
    
    if (videoRef.current) {
      videoRef.current.addEventListener('error', handleVideoError);
      
      return () => {
        videoRef.current.removeEventListener('error', handleVideoError);
      };
    }
  }, [videoRef.current, isUploading]);
  
  // Helper to add system messages
  const addSystemMessage = (text) => {
    setMessages(prevMessages => [
      ...prevMessages,
      {
        user: 'System',
        text,
        time: new Date().toLocaleTimeString(),
        isSystem: true
      }
    ]);
  };
  
  // Video event handlers - only for host and only when not processing remote updates
  const handlePlay = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: true,
          currentTime: videoRef.current.currentTime
        }
      });
    }
  };
  
  const handlePause = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: false,
          currentTime: videoRef.current.currentTime
        }
      });
    }
  };
  
  // Updated seek handler to check if seeking position is available
  const handleSeek = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate && videoRef.current) {
      const seekPosition = videoRef.current.currentTime;
      
      // Only restrict seeking if we're still uploading the video
      // If upload is complete, allow seeking to any position
      if (isUploading && seekPosition > availableDuration) {
        console.log(`Attempted to seek beyond available content: ${seekPosition}s > ${availableDuration}s`);
        
        // Show warning to the host
        setShowSeekWarning(true);
        setTimeout(() => setShowSeekWarning(false), 3000);
        
        // Reset to a safe position (1 second before the available boundary)
        const safePosition = Math.max(0, availableDuration - 1);
        videoRef.current.currentTime = safePosition;
        
        // Emit the safe position to keep everyone in sync
        socketRef.current.emit('videoStateChange', {
          roomId,
          videoState: {
            isPlaying: !videoRef.current.paused,
            currentTime: safePosition
          }
        });
        
        return;
      }
      
      // If seeking within available content, proceed normally
      console.log(`Host seeked to ${seekPosition}s, emitting to all viewers`);
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: !videoRef.current.paused,
          currentTime: seekPosition
        }
      });
    }
  };
  
  // Explicitly share video with all users
  const handleShareVideo = () => {
    if (socketRef.current && videoUrl && isHost) {
      console.log('Manually sharing video with room:', videoUrl);
      socketRef.current.emit('shareVideo', {
        roomId,
        videoUrl
      });
      addSystemMessage('You shared the video with everyone in the room');
    }
  };
  
  // Handle video deletion
  const handleDeleteVideo = () => {
    if (!isHost || !videoUrl) return;
    
    // Get videoId from URL or state
    const match = videoUrl.match(/\/videos\/([^.]+)\.mp4/);
    if (!match) {
      console.error('Cannot extract videoId from URL:', videoUrl);
      return;
    }
    
    const videoId = match[1];
    
    // Ask for confirmation
    if (!window.confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
      return;
    }
    
    setIsDeletingVideo(true);
    
    // Use the Socket.io approach for consistency
    socketRef.current.emit('deleteVideo', {
      roomId,
      videoId
    });
    
    setIsDeletingVideo(false);
  };
  
  // Handle sending messages
  const handleSendMessage = (e) => {
    e.preventDefault();
    
    if (newMessage.trim() && socketRef.current) {
      socketRef.current.emit('sendMessage', {
        roomId,
        message: newMessage,
        username
      });
      
      setNewMessage('');
    }
  };
  
  // Copy room ID to clipboard
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId)
      .then(() => {
        setCopySuccess('Copied!');
        setTimeout(() => setCopySuccess(''), 2000);
      })
      .catch(err => {
        console.error('Failed to copy:', err);
      });
  };

  // Format time for display
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return "0:00";
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`room-container ${isTheaterMode ? 'theater-container' : ''}`}>
      <div className={`room-info ${isTheaterMode ? 'theater-room-info' : ''}`}>
        <div className="room-id">
          <span>Room ID: {roomId}</span>
          <button onClick={copyRoomId} className="copy-button">
            {copySuccess || 'Copy'}
          </button>
        </div>
        <div className="sync-status">
          {isSyncing && (
            <span className="syncing">
              ⟳ Syncing...
            </span>
          )}
          {!isSyncing && isUploading && (
            <span className="uploading">
              ↑ Uploading: {uploadProgress}%
            </span>
          )}

        </div>
      </div>
      
      <div className={`main-content ${isTheaterMode ? 'theater-mode' : ''}`}>
        <div className="video-container">
          {videoUrl ? (
            <div className="video-wrapper">
              <video
                ref={videoRef}
                src={getAbsoluteVideoUrl(videoUrl)}
                controls={isHost}
                style={{ objectFit: videoFit }}
                onPlay={isHost ? handlePlay : null}
                onPause={isHost ? handlePause : null}
                onSeeked={isHost ? handleSeek : null}
                onLoadedMetadata={handleMetadataLoaded}
                className={!isHost ? "viewer-video" : "host-video"}
                playsInline
              />
              
              {/* Video progress overlay for host */}
              {isHost && isUploading && totalDuration > 0 && (
                <div 
                  className="video-progress-overlay" 
                  style={{ width: `${(availableDuration / totalDuration) * 100}%` }}
                ></div>
              )}
              
              {/* Upload progress indicator */}
              {isUploading && (
                <div className="streaming-indicator">
                  Uploading {uploadProgress}%
                </div>
              )}
              
              {/* Warning when approaching boundary */}
              {approachingBoundary && (
                <div className="approaching-boundary">
                  Approaching end of available content ({formatTime(availableDuration)})
                </div>
              )}
              
              {/* Warning when trying to seek beyond available content */}
              {showSeekWarning && (
                <div className="seek-warning">
                  Cannot seek beyond uploaded content
                </div>
              )}
              

              {/* Viewer controls */}
              {!isHost && (
                <div className="viewer-controls">
                 
                  <button className="full-screen-control-button theater-button" onClick={toggleTheaterMode}>
                    {isTheaterMode ? 'Exit Theater' : 'Theater Mode'}
                  </button>
                  <button className="full-screen-control-button fullscreen-button" onClick={() => {
                    if (videoRef.current.requestFullscreen) {
                      videoRef.current.requestFullscreen();
                    } else if (videoRef.current.webkitRequestFullscreen) {
                      videoRef.current.webkitRequestFullscreen();
                    } else if (videoRef.current.msRequestFullscreen) {
                      videoRef.current.msRequestFullscreen();
                    }
                  }}>
                    Fullscreen
                  </button>
                </div>
              )}
              
              {!isHost && (
                <div className="viewer-message">
                  <p>Only the host can control playback</p>
                </div>
              )}
              
              {/* Host controls */}
              {isHost && (
                <div className="host-controls">
                  <button className="control-button theater-button" onClick={toggleTheaterMode}>
                    {isTheaterMode ? 'Exit Theater' : 'Theater Mode'}
                  </button>
                  <button onClick={handleShareVideo} className="share-button">
                    Re-share Video
                  </button>
                  
                  {uploadComplete && (
                    <button 
                      onClick={handleDeleteVideo} 
                      className="delete-button"
                      disabled={isDeletingVideo}
                    >
                      {isDeletingVideo ? 'Deleting...' : 'Delete Video'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="waiting-for-video">
              {videoDeleted ? (
                <div className="video-deleted-message">
                  <p>Video has been deleted</p>
                  {isHost && (
                    <p className="upload-prompt">You can upload a new video to continue</p>
                  )}
                </div>
              ) : (
                <>
                  <p>Waiting for host to share a video...</p>
                  <p className="small">Server URL: {SERVER_URL}</p>
                  {isUploading && (
                    <div className="progress-container">
                      <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                      <p>{uploadProgress}% Uploaded</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        
        <div className="sidebar">
          <div className="users-panel">
            <h3>Users ({users.length})</h3>
            <ul>
              {users.map(user => (
                <li key={user.id}>
                  {user.username} {user.id === socketRef.current?.id && '(You)'}
                  {(isHost && user.id === socketRef.current?.id) || 
                   (user.isHost && user.id !== socketRef.current?.id) ? ' (Host)' : ''}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="chat-panel">
            <h3>Chat</h3>
            <div className="chat-messages" ref={chatContainerRef}>
              {messages.map((msg, index) => (
                <div 
                  key={index} 
                  className={`message ${msg.isSystem ? 'system-message' : ''}`}
                >
                  <span className="message-user">{msg.user}:</span>
                  <span className="message-text">{msg.text}</span>
                  <span className="message-time">{msg.time}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="chat-input">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
              />
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Room;