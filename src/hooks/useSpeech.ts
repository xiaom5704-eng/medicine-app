import { useState, useRef, useEffect, useCallback } from 'react';

// Web Speech API is not in standard TypeScript lib. We use `any` to avoid build errors.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface UseSpeechOptions {
  onResult?: (transcript: string) => void;
}

export function useSpeechRecognition({ onResult }: UseSpeechOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognitionAPI: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionAPI) {
      setIsSupported(true);
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = 'zh-TW';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onresult = (event: any) => {
        const transcript: string = event.results[0][0].transcript;
        onResult?.(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    setIsListening(true);
    recognitionRef.current.start();
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListening) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, [isListening]);

  return { isListening, isSupported, startListening, stopListening };
}

export function useSpeechSynthesis() {
  const [speakingId, setSpeakingId] = useState<number | null>(null);

  const speak = useCallback((text: string, id: number) => {
    if (!window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.85;   // slightly slow for elderly users
    utterance.pitch = 1.0;

    // Prefer zh-TW voices; fall back to any zh voice
    const loadVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang === 'zh-TW')
        || voices.find(v => v.lang.startsWith('zh-TW'))
        || voices.find(v => v.lang.toLowerCase().includes('tw'))
        || voices.find(v => v.lang.startsWith('zh'));
      if (preferred) utterance.voice = preferred;
    };

    // Voices may not be loaded yet on first call
    if (window.speechSynthesis.getVoices().length > 0) {
      loadVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = () => { loadVoice(); };
    }

    utterance.onstart = () => setSpeakingId(id);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);

    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, []);

  return { speakingId, speak, stop };
}
