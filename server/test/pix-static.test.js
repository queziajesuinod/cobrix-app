const { test } = require('node:test');
const assert = require('node:assert');
const { crc16, buildCopyPaste, normalizePixKey } = require('../src/services/pix-static');

test('CRC16-CCITT-FALSE bate com o vetor canônico', () => {
  assert.strictEqual(crc16('123456789'), '29B1');
});

test('buildCopyPaste gera BR Code com CRC embutido válido', () => {
  const cp = buildCopyPaste({
    pixKey: 'foo@bar.com',
    merchantName: 'Empresa Acao Ltda',
    merchantCity: 'Sao Paulo',
    amount: 123.45,
    txid: 'FATURA001',
  });
  // começa com o Payload Format Indicator
  assert.ok(cp.startsWith('000201'), 'deve começar com 000201');
  // contém o GUI do PIX e a chave
  assert.ok(cp.includes('br.gov.bcb.pix'), 'deve conter o GUI do PIX');
  assert.ok(cp.includes('foo@bar.com'), 'deve conter a chave');
  // moeda BRL e valor
  assert.ok(cp.includes('5303986'), 'deve conter a moeda 986');
  assert.ok(cp.includes('5406123.45'), 'deve conter o valor');
  // o CRC embutido (últimos 4) confere sobre o restante do payload
  const body = cp.slice(0, -4);
  const embedded = cp.slice(-4);
  assert.strictEqual(crc16(body), embedded, 'CRC embutido deve bater');
});

test('normalizePixKey trata os tipos de chave', () => {
  assert.strictEqual(normalizePixKey('  Foo@Bar.COM '), 'foo@bar.com');
  assert.strictEqual(normalizePixKey('11.222.333/0001-44'), '11222333000144');
  assert.strictEqual(normalizePixKey('12345678901'), '12345678901');
  assert.strictEqual(normalizePixKey('+55 (67) 99262-5560'), '+5567992625560');
  assert.strictEqual(
    normalizePixKey('123E4567-E89B-12D3-A456-426614174000'),
    '123e4567-e89b-12d3-a456-426614174000'
  );
});
