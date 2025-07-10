
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { verifyPassword } from '@/app/actions';

type AuthContextType = {
  isAuthenticated: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedAuth = sessionStorage.getItem('isAuthenticated');
      if (storedAuth === 'true') {
        setIsAuthenticated(true);
      }
    } catch (error) {
        console.error("Could not access sessionStorage:", error);
    } finally {
        setIsLoading(false);
    }
  }, []);

  const login = async (password: string): Promise<boolean> => {
    const { success } = await verifyPassword(password);
    if (success) {
      try {
        sessionStorage.setItem('isAuthenticated', 'true');
      } catch (error) {
        console.error("Could not access sessionStorage:", error);
      }
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem('isAuthenticated');
    } catch (error) {
      console.error("Could not access sessionStorage:", error);
    }
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
