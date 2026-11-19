/**
 * Optional voice narration for guided tours using the browser's Web Speech API.
 * Off (muted) by default; when enabled, reads each stop's title and caption in the current UI
 * language (uz / en / ru) and cancels cleanly on pause, stop, or stop jump.
 */

import { getLang, type Lang } from '../i18n';

const BCP47: Record<Lang, string[]> = {
  uz: ['uz-UZ', 'uz', 'tr-TR'],
  en: ['en-GB', 'en-US', 'en'],
  ru: ['ru-RU', 'ru'],
};

export class TourSpeech {
  enabled = false;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  speak(title: string, text: string) {
    if (!this.enabled || !this.supported) return;
    this.stop();
    const full = [title, text].filter(Boolean).join('. ');
    if (!full.trim()) return;
    const u = new SpeechSynthesisUtterance(full);
    const lang = getLang();
    const prefs = BCP47[lang];
    u.lang = prefs[0];
    const voices = window.speechSynthesis.getVoices();
    const match = prefs.map((p) => voices.find((v) => v.lang.toLowerCase().startsWith(p.toLowerCase()))).find(Boolean);
    if (match) u.voice = match;
    u.rate = 0.98;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      /* browser autoplay policy blocked speech */
    }
  }

  stop() {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}
