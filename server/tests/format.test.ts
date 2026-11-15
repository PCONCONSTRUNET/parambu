import { describe, expect, it } from 'vitest';
import {
  centsToInputString,
  formatCpfInput,
  formatMoneyMask,
  formatPhoneInput,
  parseMoneyToCents,
} from '../../src/lib/format.ts';

describe('Pontuação automática de valores, telefones e CPF', () => {
  it('formata valores digitados automaticamente com vírgula e ponto de milhar', () => {
    expect(formatMoneyMask('')).toBe('');
    expect(formatMoneyMask('4')).toBe('0,04');
    expect(formatMoneyMask('40')).toBe('0,40');
    expect(formatMoneyMask('4000')).toBe('40,00');
    expect(formatMoneyMask('120000')).toBe('1.200,00');
    expect(formatMoneyMask('1.200,005')).toBe('12.000,05');

    expect(parseMoneyToCents('40,00')).toBe(4000);
    expect(parseMoneyToCents('1.200,00')).toBe(120000);
    expect(centsToInputString(120000)).toBe('1.200,00');
  });

  it('formata telefone brasileiro automaticamente enquanto digita', () => {
    expect(formatPhoneInput('88')).toBe('(88');
    expect(formatPhoneInput('889999')).toBe('(88) 9999');
    expect(formatPhoneInput('88999991234')).toBe('(88) 99999-1234');
    expect(formatPhoneInput('8834431234')).toBe('(88) 3443-1234');
  });

  it('formata CPF automaticamente enquanto digita', () => {
    expect(formatCpfInput('')).toBe('');
    expect(formatCpfInput('123')).toBe('123');
    expect(formatCpfInput('123456')).toBe('123.456');
    expect(formatCpfInput('123456789')).toBe('123.456.789');
    expect(formatCpfInput('12345678901')).toBe('123.456.789-01');
  });
});
