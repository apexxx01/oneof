import { describe, expect, it } from 'vitest';
import { countAiRequests } from './netwatch';

describe('countAiRequests', () => {
  it('counts only model endpoints, and only after the scan started', () => {
    const e = [
      { name: 'https://firebasevertexai.googleapis.com/v1beta/projects/x/models/gemini:generateContent', startTime: 50 },
      { name: 'https://firebasevertexai.googleapis.com/v1beta/projects/x/models/gemini:generateContent', startTime: 150 },
      { name: 'https://content-firebaseappcheck.googleapis.com/v1/exchange', startTime: 160 },
      { name: 'https://oneof-app.vercel.app/assets/index.js', startTime: 170 },
      { name: 'https://generativelanguage.googleapis.com/v1beta/models/x', startTime: 180 },
    ];
    expect(countAiRequests(100, e)).toBe(2);
    expect(countAiRequests(0, e)).toBe(3);
  });
});
