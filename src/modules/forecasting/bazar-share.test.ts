import { describe, expect, it } from 'vitest';
import { escapeHtml, waLink, waPhone } from './bazar-share';

describe('waPhone', () => {
  it('turns Bangladesh mobile formats into WhatsApp form', () => {
    expect(waPhone('01711-223344')).toBe('8801711223344');
    expect(waPhone('+880 1711 223344')).toBe('8801711223344');
    expect(waPhone('8801711223344')).toBe('8801711223344');
    expect(waPhone('1711223344')).toBe('8801711223344');
  });
  it('refuses anything else', () => {
    expect(waPhone('12345')).toBeNull();
    expect(waPhone(null)).toBeNull();
    expect(waPhone('')).toBeNull();
  });
});

describe('waLink', () => {
  it('puts the text in the link, with or without a chat', () => {
    expect(waLink('a b\n• x')).toBe('https://wa.me/?text=a%20b%0A%E2%80%A2%20x');
    expect(waLink('hi', '01711223344')).toBe('https://wa.me/8801711223344?text=hi');
  });
});

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).not.toMatch(/[<>"']/);
  });
});
