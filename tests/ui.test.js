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

test('formatAge: tempo relativo em português', () => {
  const t0 = 1_000_000_000;
  const ago = (ms) => UI.formatAge(t0 - ms, t0);
  assert.equal(ago(0), 'agora mesmo');
  assert.equal(ago(59_000), 'agora mesmo');
  assert.equal(ago(60_000), '1 min atrás');
  assert.equal(ago(59 * 60_000), '59 min atrás');
  assert.equal(ago(2 * 3600_000), '2h atrás');
  assert.equal(ago(23 * 3600_000 + 59 * 60_000), '23h atrás');
  assert.equal(ago(24 * 3600_000), '1d atrás');
  assert.equal(ago(3 * 24 * 3600_000), '3d atrás');
  assert.equal(UI.formatAge(t0 + 5000, t0), 'agora mesmo');           // relógio adiantado não vira negativo
});

test('acessibilidade: ações são <button>, não <div> clicável', () => {
  assert.equal(/<div[^>]*data-action/.test(html.replace(/<div class="(?:sheet-backdrop)"[^>]*>/g, '')), false,
    'há <div data-action>: use <button type="button">');
  assert.equal(/<div class="(btn|link|chip|cat-pill|urgency-opt)\b/.test(html), false);
  assert.equal(/<div class="field"/.test(html), false, 'campo de formulário desenhado como <div>');
});

test('toda ação declarada em ACTION_NAMES é usada no HTML ou gerada pela UI', () => {
  const ui = read('ui.js');
  for (const name of UI.ACTION_NAMES) {
    assert.ok(html.includes(`data-action="${name}"`) || ui.includes(`data-action="${name}"`), `ação sem uso: ${name}`);
  }
});

test('ui.js: style="" só para posição, tamanho e largura calculados (o resto vai no CSS)', () => {
  const ui = read('ui.js');
  const inline = [...ui.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(inline.length > 0);
  for (const v of inline) assert.match(v, /^(width|top)/, `estilo inline que deveria ser classe: ${v}`);
  assert.equal(/\.style\.(display|color)/.test(ui), false, 'use classes (.is-hidden, .msg-ok, ...) em vez de style.display/color');
});

test('pílulas de categoria e select de publicação vêm de CONFIG.categories (fonte única)', () => {
  assert.equal(/class="cat-pill"/.test(html), false, 'categorias não devem ser fixas no HTML');
  const { CONFIG } = require('../data.js');
  assert.ok(CONFIG.categories.length >= 2);
  assert.ok(/id="catRow"/.test(html) && /id="novoItemCategoria"/.test(html));
});
