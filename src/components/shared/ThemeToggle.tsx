'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIState } from '@/context/ui-state';

export function ThemeToggle() {
  const { state, dispatch } = useUIState();

  const toggleTheme = () => {
    dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      id="theme-toggle"
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
      aria-label="Toggle theme"
      title={state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {state.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
