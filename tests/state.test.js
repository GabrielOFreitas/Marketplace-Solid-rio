// Testes das regras de negócio (state.js). Rodam no Node, sem DOM e sem dependências.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG, SEED } = require('../data.js');
const { createStore, clusterPins, normalizeText } = require('../state.js');

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

// ---------- filtros do mapa, busca de itens e categorias ----------

test('seed: toda categoria usada pelos itens existe em CONFIG.categories', () => {
  SEED.items.forEach((i) => assert.ok(CONFIG.categories.includes(i.category), `item ${i.id}: categoria ${i.category} fora da lista`));
  CONFIG.categories.forEach((c) => assert.ok(SEED.items.some((i) => i.category === c), `nenhum item de ${c} para demonstrar o filtro`));
});

test('normalizeText: sem acento, sem maiúsculas, sem espaços nas pontas', () => {
  assert.equal(normalizeText('  Feijão  '), 'feijao');
  assert.equal(normalizeText('ÓLEO'), 'oleo');
  assert.equal(normalizeText(null), '');
});

test('busca: acha por parte do nome, ignorando acento e maiúsculas', () => {
  const { store } = make();
  assert.deepEqual(store.getItems('p1', { text: 'feijao' }).map((i) => i.id), ['it2']);
  assert.deepEqual(store.getItems('p1', { text: 'OLEO' }).map((i) => i.id), ['it3']);
  assert.deepEqual(store.getItems('p1', { text: 'xyz' }), []);
  assert.equal(store.getItems('p1', { text: '   ' }).length, store.getItems('p1').length);   // só espaços = sem filtro
});

test('categoria: filtra por categoria e combina com a busca', () => {
  const { store } = make();
  assert.deepEqual(store.getItems('p1', { category: 'Roupa' }).map((i) => i.id), ['it12', 'it13']);
  assert.deepEqual(store.getItems('p1', { category: 'Roupa', text: 'cobertor' }).map((i) => i.id), ['it13']);
  assert.deepEqual(store.getItems('p1', { category: 'Móvel' }), []);
  assert.deepEqual(store.getItems('p1', { category: null, text: '' }).map((i) => i.id), store.getItems('p1').map((i) => i.id));
});

test('mapa: o raio esconde pontos e instituições mais distantes', () => {
  const { store } = make();
  const ids = (f) => store.getMapPins(f).map((p) => p.id).sort();
  assert.equal(store.getMapPins({ radiusKm: 10 }).length, store.getMapPins().length);
  assert.ok(!ids({ radiusKm: 3 }).includes('p3'));                       // 3,2 km
  assert.ok(ids({ radiusKm: 3 }).includes('i2'));                        // 2,1 km
  assert.deepEqual(ids({ radiusKm: 2 }), ['i1', 'p1', 'p2']);             // 1,4 / 1,4 / 2,0 km (limite incluso)
});

test('mapa: a categoria mantém só pontos que têm item daquela categoria; necessidades só obedecem ao raio', () => {
  const { store } = make();
  const pins = (f) => store.getMapPins(f).filter((p) => p.kind === 'oferta').map((p) => p.id).sort();
  assert.deepEqual(pins({ category: 'Roupa' }), ['p1', 'p3']);
  assert.deepEqual(pins({ category: 'Móvel' }), ['p3']);
  assert.deepEqual(pins({ category: 'Eletro', radiusKm: 2 }), []);
  assert.equal(store.getMapPins({ category: 'Roupa' }).filter((p) => p.kind === 'demanda').length, 2);
});

test('mapa: o agrupador é recalculado com o filtro (sem os 5 pontos, não há "+5")', () => {
  const { store } = make();
  assert.ok(store.getMapMarkers().some((m) => m.type === 'cluster' && m.count === 5));
  assert.ok(store.getMapMarkers({ radiusKm: 2 }).every((m) => m.type === 'pin'));
  assert.ok(store.getMapMarkers({ category: 'Roupa' }).every((m) => m.type === 'pin'));
});

test('filtro do mapa acompanha o estoque: esgotar a única unidade de uma categoria tira o pin', () => {
  const { store } = make();
  assert.ok(store.getMapPins({ category: 'Móvel' }).some((p) => p.id === 'p3'));
  assert.ok(reserveOne(store, 'it15').ok);                               // Mesa dobrável: 1 unidade
  assert.equal(store.getMapPins({ category: 'Móvel' }).some((p) => p.kind === 'oferta'), false);
});

test('publicar item: valida a categoria e usa a primeira como padrão', () => {
  const { store } = make();
  const bad = store.publishItem({ name: 'Sofá', qty: 1, category: 'Veículo' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'INVALID_CATEGORY');
  const ok = store.publishItem({ name: 'Sofá', qty: 1, category: 'Móvel' });
  assert.ok(ok.ok);
  assert.deepEqual(store.getItems('p1', { category: 'Móvel' }).map((i) => i.name), ['Sofá']);
  assert.equal(store.publishItem({ name: 'Pacote', qty: 1 }).item.category, 'Alimento');
});

// ---------- notificações ----------

test('notificações: começam com as do seed, com idade calculada pelo relógio', () => {
  const { store, clock } = make();
  const list = store.getNotifications();
  assert.equal(list.length, SEED.notifications.length);
  assert.equal(clock.now() - list[0].createdAt, SEED.notifications[0].minutesAgo * 60000);
  assert.equal(store.getUnreadCount(), SEED.notifications.filter((n) => !n.read).length);
});

test('notificações: cada evento de negócio gera um aviso novo, não lido, no topo', () => {
  const { store } = make();
  const before = store.getNotifications().length;
  const { reservation } = reserveOne(store, 'it1');
  let top = store.getNotifications()[0];
  assert.match(top.text, /Reserva criada: Arroz 5kg x1/);
  assert.equal(top.read, false);
  assert.equal(top.tone, 'ok');
  store.confirmPickup(reservation.id);
  const [a, b] = store.getNotifications();
  assert.match(a.text, /Retirada confirmada: Arroz 5kg x1\. Seu score subiu \+3/);
  assert.match(b.text, /Comprovante de doação disponível/);
  assert.equal(store.getNotifications().length, before + 3);
});

test('notificações: expirar, cancelar, recusar, publicar item e necessidade também avisam', () => {
  const { store, clock } = make();
  const text = () => store.getNotifications()[0].text;
  const r1 = reserveOne(store, 'it2').reservation;
  store.cancelReservation(r1.id);
  assert.match(text(), /cancelou a reserva de Feijão 2kg x1/);
  reserveOne(store, 'it3');
  clock.advance(CONFIG.reservationTtlMs + 1);
  store.expireDue();
  assert.match(text(), /expirou: Óleo 900ml x1/);
  store.addToCart('it4');
  store.simulateCompetingReservation();
  store.reserve();
  assert.equal(store.getNotifications()[0].tone, 'err');
  store.publishItem({ name: 'Camisa', qty: 2, category: 'Roupa' });
  assert.match(text(), /Item publicado: Camisa \(x2\) em Mercado São José/);
  store.publishNeed({ name: 'Cadernos', qty: 5, urgency: 'Média' });
  assert.match(text(), /Necessidade publicada na vitrine: Cadernos \(x5\) — urgência Média/);
});

test('notificações: operação recusada pelas regras não gera aviso de sucesso', () => {
  const { store } = make();
  const before = store.getNotifications().length;
  store.publishItem({ name: '', qty: 1 });
  store.publishNeed({ name: 'X', qty: 1, urgency: 'Nenhuma' });
  store.reserve();                                                       // carrinho vazio
  assert.equal(store.getNotifications().length, before);
});

test('notificações: marcar como lidas zera o contador e avisa só quando algo mudou', () => {
  const { store } = make();
  const events = [];
  store.subscribe((e) => events.push(e.type));
  reserveOne(store, 'it1');
  assert.ok(store.getUnreadCount() >= 2);
  const r = store.markNotificationsRead();
  assert.equal(r.ok, true);
  assert.equal(store.getUnreadCount(), 0);
  assert.equal(events.filter((t) => t === 'notifications:read').length, 1);
  assert.equal(store.markNotificationsRead().changed, 0);
  assert.equal(events.filter((t) => t === 'notifications:read').length, 1);
});

test('notificações: a lista respeita o limite configurado', () => {
  const { store } = make();
  for (let n = 0; n < CONFIG.notificationLimit + 5; n += 1) store.publishItem({ name: 'Item ' + n, qty: 1 });
  assert.equal(store.getNotifications().length, CONFIG.notificationLimit);
  assert.match(store.getNotifications()[0].text, new RegExp('Item ' + (CONFIG.notificationLimit + 4)));
});
