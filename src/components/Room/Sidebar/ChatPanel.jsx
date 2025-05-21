import React, { useEffect, useState } from 'react';
import './Sidebar.css';

function ChatPanel({ 
  messages, 
  newMessage, 
  setNewMessage, 
  handleSendMessage, 
  chatContainerRef,
  isChatOnly = false 
}) {
  const [isIOS, setIsIOS] = useState(false);
  
  // Detect iOS on mount
  useEffect(() => {
    // Check if this is an iOS device
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(iOS);
  }, []);
  
  // Handler for Enter key submission (except on iOS)
  const handleKeyDown = (e) => {
    if (!isIOS && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };
  
  // Fix input focus issues on iOS
  const handleInputFocus = () => {
    if (isIOS && isChatOnly) {
      // Scroll the chat container to the bottom after a short delay
      // This helps with the iOS keyboard pushing content up
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 500);
    }
  };

  return (
    <div className={`chat-panel ${isChatOnly ? 'chat-only-panel' : ''}`}>
      {!isChatOnly && <h3>Chat</h3>}
      <div className="chat-messages" ref={chatContainerRef}>
        {messages.length === 0 ? (
          <div className="empty-chat-message">
            <p>No messages yet. Be the first to say hello!</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div 
              key={index} 
              className={`message ${msg.isSystem ? 'system-message' : ''}`}
            >
              <span className="message-user">{msg.user}:</span>
              <span className="message-text">{msg.text}</span>
              <span className="message-time">{msg.time}</span>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSendMessage} className="chat-input">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          placeholder="Type a message..."
          aria-label="Chat message input"
          autoComplete="off"
        />
        <button 
          type="submit" 
          aria-label="Send message"
        >
          {isChatOnly ? 'Send' : '→'}
        </button>
      </form>
    </div>
  );
}

export default ChatPanel;