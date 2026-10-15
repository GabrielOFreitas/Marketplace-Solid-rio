// Testes estruturais da camada de apresentação (sem DOM): contrato entre index.html e ui.js,
// formatação do log e separação de camadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../ui.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('index.html');

test('as 13 telas existem no HTML, sem ids repetidos', () => {
  assert.equal(UI.SCREENS.length, 13);
  assert.equal(new Set(UI.SCREENS.map((s) => s.id)).size, 13);
  for (const s of UI.SCREENS) {
    assert.equal(html.split(`id="screen-${s.id}"`).length - 1, 1, `tela ${s.id} ausente ou duplicada`);
  }
  assert.equal((html.match(/class="screen( active)?"/g) || []).length, 13);
});

test('HTML sem manipuladores inline nem JavaScript embutido', () => {
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'achou atributo onclick/onchange/...');
  assert.equal(/javascript:/i.test(html), false);
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.deepEqual(scripts, ['<script src="data.js">', '<script src="state.js">', '<script src="ui.js">']);
  assert.equal(/<script[^>]*>\s*\S/.test(html.replace(/<script[^>]*src=[^>]*>\s*<\/script>/g, '')), false);
});

test('HTML sem estilo inline: o visual fica todo no style.css', () => {
  assert.equal(/\sstyle\s*=/i.test(html), false, 'achou atributo style="..." no index.html');
  const css = read('style.css');
  for (const cls of ['is-hidden', 'text-center', 'hint-center', 'receipt-preview', 'btn-danger-outline']) {
    assert.ok(css.includes('.' + cls), `classe .${cls} não existe no style.css`);
  }
});

test('todo data-action do HTML tem handler registrado na UI', () => {
  const used = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(UI.ACTION_NAMES.includes(name), `ação sem handler: ${name}`);
  for (const el of html.matchAll(/data-action="goto"[^>]*data-screen="([^"]+)"/g)) {
    assert.ok(UI.SCREENS.some((s) => s.id === el[1]), `goto para tela inexistente: ${el[1]}`);
  }
});

test('camadas: data.js e state.js não conhecem DOM, renderização nem log', () => {
  const forbidden = /\b(document|window|localStorage|alert)\b|innerHTML|querySelector|getElementById|\brender[A-Z(]|logEvent|console\./;
  for (const f of ['data.js', 'state.js']) assert.equal(forbidden.test(read(f)), false, `${f} depende da interface`);
});

test('camadas: ui.js não implementa as regras (não mexe no estoque nem calcula score)', () => {
  const src = read('ui.js');
  assert.equal(/\.qty\s*(-=|\+=)|\.status\s*=[^=]|baseScore|scorePerConfirmedPickup/.test(src), false);
});

test('log: cada evento de negócio vira uma linha legível; o resto é ignorado', () => {
  const items = [{ name: 'Arroz 5kg', qty: 2 }, { name: 'Leite', qty: 1 }];
  const reservation = { items, createdAt: 0, expiresAt: 20000 };
  const d = (type, payload) => UI.describeEvent({ type, payload });
  assert.deepEqual(d('reservation:created', { reservation }),
    { kind: 'ok', text: 'Reserva criada: Arroz 5kg x2, Leite x1 — estoque debitado, expira em 20s.' });
  assert.equal(d('reservation:rejected', {}).kind, 'err');
  assert.equal(d('reservation:expired', { reservation }).kind, 'warn');
  assert.match(d('reservation:cancelled', { reservation }).text, /cancelada.*estoque devolvido/);
  assert.match(d('pickup:confirmed', { reservation, scoreDelta: 3 }).text, /Retirada confirmada por QR: Arroz 5kg x2, Leite x1 — score \+3\./);
  assert.match(d('item:published', { item: { name: 'Feijão', qty: 3, urgent: true } }).text, /Feijão \(x3\) — urgente/);
  assert.match(d('need:published', { need: { name: 'Fraldas', qty: 9, urgency: 'Alta' } }).text, /urgência Alta/);
  assert.match(d('stock:changed', { itemName: 'Leite' }).text, /\[Teste\].*Leite/);
  assert.equal(d('cart:changed', {}), null);
  assert.equal(d('point:selected', {}), null);
});

test('esc: neutraliza HTML digitado pelo usuário', () => {
  assert.equal(UI.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(UI.esc("O'Neil & Cia"), 'O&#39;Neil &amp; Cia');
});
