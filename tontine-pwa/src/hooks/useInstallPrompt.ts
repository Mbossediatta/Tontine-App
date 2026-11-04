import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// L'évènement peut arriver avant le montage des composants : on le garde ici.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((listener) => listener());
  });
}

/**
 * Invite d'installation : bouton sur Android (beforeinstallprompt),
 * aide « Partager puis Sur l'écran d'accueil » sur iPhone.
 */
export function useInstallPrompt() {
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const update = () => {
      setCanPrompt(deferredPrompt !== null);
      setInstalled(isStandalone());
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setCanPrompt(false);
    return outcome === 'accepted';
  }, []);

  return {
    installed,
    canPrompt,
    showIosHelp: !installed && isIos(),
    promptInstall,
  };
}
