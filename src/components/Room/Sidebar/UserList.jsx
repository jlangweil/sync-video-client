import React from 'react';
import './Sidebar.css';

function UserList({ users, currentUserId }) {
  return (
    <div className="users-panel">
      <h3>Users ({users.length})</h3>
      <ul>
        {users.map(user => (
          <li key={user.id}>
            {user.username} 
            {user.id === currentUserId && ' (You)'}
            {user.isHost ? ' (Host)' : ''}
            {user.isChatOnly ? ' (Chat Only)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default UserList;