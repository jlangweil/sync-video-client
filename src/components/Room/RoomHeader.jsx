import React from 'react';
import { useWebRTC } from './WebRTC/WebRTCProvider';
import './RoomHeader.css';

function RoomHeader({ 
  roomId, 
  copyRoomId, 
  copySuccess, 
  isSyncing, 
  isHost, 
  isTheaterMode 
}) {
  // Get WebRTC context
  const { 
    isStreaming, 
    bufferPercentage, 
    connectionStatus,
    isSeekInProgress,
    isReconnecting
  } = useWebRTC();

  // Get status message based on current state
  const getStatusMessage = () => {
    if (isHost) {
      if (isStreaming) {
        if (isSeekInProgress) return "Seeking and reconnecting viewers...";
        if (isReconnecting) return "Reestablishing connections...";
        return "Streaming";
      }
      return "";
    } else {
      // Viewer status
      if (connectionStatus === 'disconnected') return "Disconnected from host";
      if (connectionStatus === 'connecting') return "Connecting to stream...";
      if (connectionStatus === 'buffering') return "Buffering content...";
      if (connectionStatus === 'error') return "Connection error";
      if (connectionStatus === 'ready') return "Connected to stream";
      return "Waiting for host";
    }
  };

  // Get status class based on current state
  const getStatusClass = () => {
    if (isHost) {
      if (isStreaming) {
        if (isSeekInProgress || isReconnecting) return "reconnecting";
        return "streaming";
      }
      return "";
    } else {
      return connectionStatus;
    }
  };

  return (
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
        
        {/* Stream status indicator */}
        {getStatusMessage() && (
          <span className={`status ${getStatusClass()}`}>
            {getStatusMessage()}
            {bufferPercentage > 0 && connectionStatus === 'buffering' && (
              <span className="buffer-info">
                {" "}{bufferPercentage}%
                <div className="buffer-bar">
                  <div 
                    className="buffer-progress" 
                    style={{ width: `${bufferPercentage}%` }}
                  ></div>
                </div>
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default RoomHeader;