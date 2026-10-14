// One trader on this PC, always signed in, no account needed
import React, { createContext, useContext, useEffect, useState } from 'react';
import { client } from '@/api/client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { client.auth.me().then(setUser).catch(setError); }, []);

  return (
    <AuthContext.Provider value={{ user, error, isLoading: !user && !error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
