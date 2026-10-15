// Testes das regras de negócio (state.js). Rodam no Node, sem DOM e sem dependências.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG, SEED } = require('../data.js');
const { createStore, clusterPins } = require('../state.js');

function make() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = createStore({ seed: SEED, config: CONFIG, now: clock.now });
  return { store, clock };
}
const stockOf = (store, id) => store.getItems().find((i) => i.id === id).qty;
const reserveOne = (store, itemId) => { assert.ok(store.addToCart(itemId).ok); return store.reserve(); };

test('inicialização: dados de exemplo são consistentes entre si', () => {
  const { store } = make();
  const ids = (list) => list.map((x) => x.id);
  for (const list of [SEED.institutions, SEED.pickupPoints, SEED.items, SEED.needs]) {
    assert.equal(new Set(ids(list)).size, list.length, 'ids repetidos');
  }
  const pointIds = ids(SEED.pickupPoints), instIds = ids(SEED.institutions);
  SEED.items.forEach((i) => assert.ok(pointIds.includes(i.pointId), `item ${i.id} aponta para ponto inexistente`));
  SEED.needs.forEach((n) => assert.ok(instIds.includes(n.institutionId), `necessidade ${n.id} aponta para instituição inexistente`));
  assert.ok(pointIds.includes(SEED.user.pickupPointId));
  assert.ok(instIds.includes(SEED.user.institutionId));
  assert.equal(store.getScore(), SEED.user.baseScore);
  assert.equal(store.getCartTotal(), 0);
  assert.equal(store.getSelectedPoint().id, 'p1');
});

test('as stores são isoladas entre si e não alteram o SEED', () => {
  const before = JSON.stringify(SEED);
  const a = make().store, b = make().store;
  reserveOne(a, 'it1');
  assert.equal(stockOf(a, 'it1'), 2);
  assert.equal(stockOf(b, 'it1'), 3);
  assert.equal(JSON.stringify(SEED), before);
});

test('carrinho: adiciona, respeita estoque e remove', () => {
  const { store } = make();
  assert.deepEqual(store.addToCart('it4'), { ok: true, qty: 1 });   // Leite tem 2
  assert.deepEqual(store.addToCart('it4'), { ok: true, qty: 2 });
  const r = store.addToCart('it4');
  assert.equal(r.ok, false); assert.equal(r.code, 'OUT_OF_STOCK');
  assert.equal(store.getCartTotal(), 2);
  assert.equal(store.getAvailableQty('it4'), 0);
  assert.deepEqual(store.removeFromCart('it4'), { ok: true, qty: 1 });
  assert.deepEqual(store.removeFromCart('it4'), { ok: true, qty: 0 });
  assert.equal(store.removeFromCart('it4').code, 'NOT_IN_CART');
  assert.equal(store.getCartLines().length, 0);
  assert.equal(store.addToCart('nao-existe').code, 'ITEM_NOT_FOUND');
});

test('carrinho: uma reserva aceita itens de um único ponto', () => {
  const { store } = make();
  store.addToCart('it1');
  const r = store.addToCart('it5');                    // it5 é do ponto p2
  assert.equal(r.ok, false); assert.equal(r.code, 'DIFFERENT_POINT');
  assert.deepEqual(store.getCartLines().map((l) => l.itemId), ['it1']);
  store.removeFromCart('it1');
  assert.ok(store.addToCart('it5').ok);                // carrinho vazio: qualquer ponto
  assert.equal(store.getCartPoint().id, 'p2');
});

test('reserva: debita o estoque, esvazia o carrinho e define a expiração', () => {
  const { store, clock } = make();
  store.addToCart('it1'); store.addToCart('it1'); store.addToCart('it2');
  const r = store.reserve();
  assert.ok(r.ok);
  assert.equal(r.reservation.status, 'pending');
  assert.equal(r.reservation.pointId, 'p1');
  assert.equal(r.reservation.expiresAt, clock.now() + CONFIG.reservationTtlMs);
  assert.deepEqual(r.reservation.items.map((i) => [i.itemId, i.qty]), [['it1', 2], ['it2', 1]]);
  assert.equal(stockOf(store, 'it1'), 1);
  assert.equal(stockOf(store, 'it2'), 4);
  assert.equal(store.getCartTotal(), 0);
  assert.equal(store.getCurrentReservation().id, r.reservation.id);
});

test('reserva: carrinho vazio é recusado', () => {
  const { store } = make();
  assert.equal(store.reserve().code, 'EMPTY_CART');
  assert.equal(store.getReservations().length, 0);
});

test('reserva: estoque que caiu depois de montar o carrinho recusa e não altera nada', () => {
  const { store } = make();
  store.addToCart('it4'); store.addToCart('it4');
  assert.ok(store.simulateCompetingReservation().ok);
  assert.equal(stockOf(store, 'it4'), 0);
  const r = store.reserve();
  assert.equal(r.ok, false); assert.equal(r.code, 'INSUFFICIENT_STOCK');
  assert.equal(store.getReservations().length, 0);
  assert.equal(stockOf(store, 'it4'), 0);
  assert.equal(store.getCartTotal(), 2);              // o carrinho continua como estava
  assert.equal(make().store.simulateCompetingReservation().code, 'EMPTY_CART');
});

test('reserva: mesmo com o carrinho menor que o estoque, quem foi mais rápido leva tudo e a reserva é recusada', () => {
  const { store } = make();
  store.addToCart('it2');                              // 1 de 5 Feijões no carrinho
  assert.equal(store.simulateCompetingReservation().taken, 5);
  assert.equal(stockOf(store, 'it2'), 0);
  assert.equal(store.reserve().code, 'INSUFFICIENT_STOCK');
  assert.equal(store.getReservations().length, 0);
});

test('expiração: só vence depois do prazo e devolve o estoque', () => {
  const { store, clock } = make();
  const { reservation } = reserveOne(store, 'it1');
  clock.advance(CONFIG.reservationTtlMs - 1);
  assert.deepEqual(store.expireDue(), []);
  assert.equal(stockOf(store, 'it1'), 2);
  clock.advance(1);
  assert.deepEqual(store.expireDue(), [reservation.id]);
  assert.equal(reservation.status, 'expired');
  assert.equal(stockOf(store, 'it1'), 3);
  assert.deepEqual(store.expireDue(), []);            // não expira duas vezes
});

test('expiração manual (demo) devolve o estoque e bloqueia a confirmação', () => {
  const { store } = make();
  const { reservation } = reserveOne(store, 'it1');
  assert.ok(store.expireReservation(reservation.id).ok);
  assert.equal(stockOf(store, 'it1'), 3);
  assert.equal(store.confirmPickup(reservation.id).code, 'NOT_PENDING');
});

test('confirmar depois do prazo falha e expira a reserva (mesmo sem o timer ter rodado)', () => {
  const { store, clock } = make();
  const { reservation } = reserveOne(store, 'it1');
  clock.advance(CONFIG.reservationTtlMs);
  const r = store.confirmPickup(reservation.id);
  assert.equal(r.ok, false); assert.equal(r.code, 'EXPIRED');
  assert.equal(reservation.status, 'expired');
  assert.equal(stockOf(store, 'it1'), 3);
  assert.equal(store.getScore(), SEED.user.baseScore);
});

test('cancelamento: devolve o estoque e não pode ser repetido nem confirmado', () => {
  const { store } = make();
  const { reservation } = reserveOne(store, 'it2');
  assert.equal(stockOf(store, 'it2'), 4);
  assert.ok(store.cancelReservation(reservation.id).ok);
  assert.equal(stockOf(store, 'it2'), 5);
  assert.equal(store.cancelReservation(reservation.id).code, 'NOT_PENDING');
  assert.equal(store.confirmPickup(reservation.id).code, 'NOT_PENDING');
  assert.equal(store.cancelReservation('inexistente').code, 'RESERVATION_NOT_FOUND');
});

test('confirmação: fecha a reserva, mantém o estoque debitado e alimenta score e histórico', () => {
  const { store, clock } = make();
  const { reservation } = reserveOne(store, 'it1');
  clock.advance(5000);
  assert.ok(store.confirmPickup(reservation.id).ok);
  assert.equal(reservation.status, 'confirmed');
  assert.equal(stockOf(store, 'it1'), 2);             // retirado de verdade: não volta
  assert.equal(store.getScore(), SEED.user.baseScore + CONFIG.scorePerConfirmedPickup);
  const h = store.getHistory();
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].itemNames, ['Arroz 5kg']);
  assert.equal(h[0].at, clock.now());
  assert.equal(store.cancelReservation(reservation.id).code, 'NOT_PENDING');
  assert.equal(store.expireReservation(reservation.id).code, 'NOT_PENDING');
});

test('score: nunca passa do máximo e o delta informado é o real', () => {
  const { store } = make();
  store.publishItem({ name: 'Lote', qty: 50 });
  const deltas = [];
  store.subscribe((e) => { if (e.type === 'pickup:confirmed') deltas.push(e.payload.scoreDelta); });
  const lote = store.getItems('p1').find((i) => i.name === 'Lote').id;
  for (let n = 0; n < 8; n += 1) store.confirmPickup(reserveOne(store, lote).reservation.id);
  assert.equal(store.getScore(), CONFIG.maxScore);
  assert.deepEqual(deltas, [3, 3, 3, 3, 3, 3, 0, 0]);   // 82 -> 100 (cap) e depois 0
});

test('publicar item: valida os dados e não deixa lixo no estado', () => {
  const { store } = make();
  const total = store.getItems().length;
  const bad = [
    [{ name: '', qty: 1 }, 'INVALID_NAME'], [{ name: '   ', qty: 1 }, 'INVALID_NAME'], [{ qty: 1 }, 'INVALID_NAME'],
    [{ name: 'X', qty: 0 }, 'INVALID_QTY'], [{ name: 'X', qty: -2 }, 'INVALID_QTY'], [{ name: 'X', qty: 1.5 }, 'INVALID_QTY'],
    [{ name: 'X', qty: '3' }, 'INVALID_QTY'], [{ name: 'X', qty: NaN }, 'INVALID_QTY'],
    [{ name: 'X', qty: 1, pointId: 'zzz' }, 'POINT_NOT_FOUND'], [undefined, 'INVALID_NAME']
  ];
  for (const [input, code] of bad) assert.equal(store.publishItem(input).code, code, JSON.stringify(input));
  assert.equal(store.getItems().length, total);
});

test('publicar item: entra no ponto do usuário e aparece na lista e no mapa', () => {
  const { store } = make();
  const r = store.publishItem({ name: '  Feijão preto 1kg ', qty: 3, urgent: true });
  assert.ok(r.ok);
  assert.equal(r.item.name, 'Feijão preto 1kg');
  assert.equal(r.item.pointId, SEED.user.pickupPointId);
  assert.ok(store.getItems('p1').some((i) => i.id === r.item.id && i.urgent));
  assert.ok(store.getPointDetails('p1').items.some((i) => i.id === r.item.id));
  assert.ok(store.addToCart(r.item.id).ok);
});

test('publicar necessidade: valida e atualiza o pin da instituição', () => {
  const { store } = make();
  assert.equal(store.publishNeed({ name: 'Cobertores', qty: 5, urgency: 'Urgentíssima' }).code, 'INVALID_URGENCY');
  assert.equal(store.publishNeed({ name: 'Cobertores', qty: 5 }).code, 'INVALID_URGENCY');
  assert.equal(store.publishNeed({ name: '', qty: 5, urgency: 'Alta' }).code, 'INVALID_NAME');
  assert.equal(store.publishNeed({ name: 'Cobertores', qty: 0, urgency: 'Alta' }).code, 'INVALID_QTY');
  assert.equal(store.publishNeed({ name: 'C', qty: 1, urgency: 'Alta', institutionId: 'zzz' }).code, 'INSTITUTION_NOT_FOUND');
  const antes = store.getMapPins().find((p) => p.kind === 'demanda' && p.id === 'i2');
  assert.equal(antes.urgency, 'Baixa');
  assert.equal(antes.size, CONFIG.pinSize.demanda['Baixa']);
  const r = store.publishNeed({ name: 'Cobertores', qty: 5, urgency: 'Alta', institutionId: 'i2' });
  assert.ok(r.ok);
  const depois = store.getMapPins().filter((p) => p.kind === 'demanda' && p.id === 'i2');
  assert.equal(depois.length, 1);                       // um pin por instituição
  assert.equal(depois[0].urgency, 'Alta');
  assert.equal(depois[0].size, CONFIG.pinSize.demanda['Alta']);
  assert.deepEqual(store.getInstitutionDetails('i2').needs.map((n) => n.name), ['Fraldas', 'Cobertores']);
});

test('mapa x estoque: o pin de "item disponível" some quando o ponto fica sem estoque', () => {
  const { store } = make();
  const hasPin = () => store.getMapPins().some((p) => p.kind === 'oferta' && p.id === 'p2');
  assert.ok(hasPin());
  for (let n = 0; n < 6; n += 1) store.addToCart('it5');   // Pão de forma: 6 unidades
  const { reservation } = store.reserve();
  assert.equal(hasPin(), false);
  assert.equal(store.getPointDetails('p2').items.length, 0);
  store.cancelReservation(reservation.id);
  assert.ok(hasPin());                                   // cancelou: voltou ao mapa
});

test('mapa x dados: todo pin vem de um ponto/instituição existente', () => {
  const { store } = make();
  for (const pin of store.getMapPins()) {
    const ref = pin.kind === 'oferta' ? store.getPoint(pin.id) : store.getInstitution(pin.id);
    assert.ok(ref, `pin ${pin.kind}:${pin.id} sem origem`);
    assert.equal(pin.top, ref.map.top); assert.equal(pin.left, ref.map.left);
  }
  const kinds = store.getMapPins().map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === 'oferta').length, SEED.pickupPoints.length);
  assert.equal(kinds.filter((k) => k === 'demanda').length, SEED.institutions.length);
});

test('agrupador: pontos próximos viram um marcador "+N"; tipos diferentes não se misturam', () => {
  const { store } = make();
  const clusters = store.getMapMarkers().filter((m) => m.type === 'cluster');
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 5);
  assert.deepEqual(clusters[0].memberIds.sort(), ['p4', 'p5', 'p6', 'p7', 'p8']);
  const pins = [{ kind: 'oferta', id: 'a', top: 0, left: 0 }, { kind: 'demanda', id: 'b', top: 1, left: 1 }];
  assert.equal(clusterPins(pins, 100).filter((m) => m.type === 'cluster').length, 0);
  assert.equal(clusterPins([{ kind: 'oferta', id: 'a', top: 0, left: 0 }, { kind: 'oferta', id: 'c', top: 3, left: 4 }], 5)[0].count, 2);
  assert.equal(clusterPins([{ kind: 'oferta', id: 'a', top: 0, left: 0 }, { kind: 'oferta', id: 'c', top: 30, left: 40 }], 5).length, 2);
});

test('eventos: a interface é avisada de cada mudança, na ordem, e pode cancelar a inscrição', () => {
  const { store } = make();
  const seen = [];
  const off = store.subscribe((e) => seen.push(e.type));
  const { reservation } = reserveOne(store, 'it1');
  store.confirmPickup(reservation.id);
  assert.deepEqual(seen, ['cart:changed', 'reservation:created', 'pickup:confirmed']);
  off();
  store.publishItem({ name: 'Y', qty: 1 });
  assert.equal(seen.length, 3);
});

test('seleção de ponto: valida o id e emite evento', () => {
  const { store } = make();
  assert.equal(store.selectPoint('zzz').code, 'POINT_NOT_FOUND');
  assert.equal(store.getSelectedPoint().id, 'p1');
  assert.ok(store.selectPoint('p3').ok);
  assert.equal(store.getSelectedPoint().id, 'p3');
});
