// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { LANG_STORAGE_KEY } from './i18n';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('App landing', () => {
  it('shows the pitch, privacy line and disclaimer in PT-BR by default', () => {
    render(<App />);
    expect(screen.getByText(/Seu vídeo nunca sai do seu aparelho/)).toBeTruthy();
    expect(screen.getByText(/não é dispositivo médico/)).toBeTruthy();
    expect(screen.getByLabelText('Escolher vídeo')).toBeTruthy();
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('PT/EN toggle switches the strings and persists the choice', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /EN/ }));
    expect(screen.getByText(/Your video never leaves your device/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /EN/ }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    cleanup();
    render(<App />);
    expect(screen.getByLabelText('Choose video')).toBeTruthy();
  });
});
