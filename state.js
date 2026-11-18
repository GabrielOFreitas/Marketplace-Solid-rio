/* state.js — estado central e regras de negócio (RN de disponibilidade, reserva,
 * expiração, cancelamento e confirmação).
 *
 * Regras desta camada:
 *  - NÃO toca no DOM e NÃO chama renderização nem log. Roda igual no navegador e no Node.
 *  - Toda operação devolve { ok:true, ... } ou { ok:false, code, message } (não lança exceção para erro de uso).
 *  - Quem quiser reagir a mudanças usa store.subscribe(fn); a interface e o log fazem isso.
 *  - Relógio injetável (opção `now`) para testar expiração sem esperar.
 *
 * Ponto de integração futura com backend: cada operação abaixo viraria uma chamada
 * de API mantendo o mesmo contrato de retorno.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketState = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var fail = function (code, message) { return { ok: false, code: code, message: message }; };

  /** Texto para comparação: minúsculas e sem acento ("Feijão" casa com "feijao"). */
  function normalizeText(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  /** Agrupa pins do mesmo tipo mais próximos que `radius` px (função pura, testável). */
  function clusterPins(pins, radius) {
    var used = {}, markers = [];
    pins.forEach(function (p, i) {
      if (used[i]) return;
      var group = [p];
      used[i] = true;
      pins.forEach(function (q, j) {
        if (used[j] || q.kind !== p.kind) return;
        var d = Math.hypot(q.top - p.top, q.left - p.left);
        if (d <= radius) { group.push(q); used[j] = true; }
      });
      if (group.length === 1) markers.push(Object.assign({ type: 'pin' }, p));
      else markers.push({ type: 'cluster', kind: p.kind, count: group.length, top: p.top, left: p.left,
                          memberIds: group.map(function (g) { return g.id; }) });
    });
    return markers;
  }

  function createStore(opts) {
    if (!opts || !opts.seed || !opts.config) throw new Error('createStore requer { seed, config }');
    var config = opts.config;
    var now = opts.now || Date.now;
    var counter = 0;
    var genId = opts.newId || function (prefix) { counter += 1; return prefix + now() + '-' + counter; };

    var state = clone(opts.seed);
    state.cart = [];                 // [{ itemId, qty }]  (só intenção; não debita estoque)
    state.reservations = [];         // [{ id, pointId, items, status, createdAt, expiresAt, resolvedAt }]
    state.currentReservationId = null;
    state.selectedPointId = state.pickupPoints.length ? state.pickupPoints[0].id : null;
    // notificações: as iniciais vêm do seed (com "há quantos minutos"); as novas nascem dos eventos
    state.notifications = (opts.seed.notifications || []).map(function (n) {
      return { id: genId('n'), tone: n.tone, text: n.text, createdAt: now() - n.minutesAgo * 60000, read: !!n.read };
    });

    var listeners = [];
    function subscribe(fn) {
      listeners.push(fn);
      return function unsubscribe() { listeners = listeners.filter(function (l) { return l !== fn; }); };
    }
    function emit(type, payload) {
      var evt = { type: type, payload: payload || {} };
      recordNotifications(evt);                           // antes dos ouvintes: quem redesenha já enxerga o aviso
      listeners.slice().forEach(function (fn) { fn(evt); });
    }

    // ---------- notificações (avisos automáticos no lugar do contato direto) ----------
    function names(items) { return items.map(function (i) { return i.name + ' x' + i.qty; }).join(', '); }
    function notificationsFor(evt) {
      var p = evt.payload;
      switch (evt.type) {
        case 'reservation:created':
          return [{ tone: 'ok', text: 'Reserva criada: ' + names(p.reservation.items) + ' — retire em até ' +
            (p.reservation.expiresAt - p.reservation.createdAt) / 1000 + 's.' }];
        case 'reservation:rejected':
          return [{ tone: 'err', text: 'Não foi possível reservar: o item já foi reservado por outra pessoa.' }];
        case 'reservation:expired':
          return [{ tone: 'warn', text: 'Sua reserva expirou: ' + names(p.reservation.items) + ' — os itens voltaram ao estoque.' }];
        case 'reservation:cancelled':
          return [{ tone: 'warn', text: 'Você cancelou a reserva de ' + names(p.reservation.items) + '.' }];
        case 'pickup:confirmed':
          return [{ tone: 'ok', text: 'Retirada confirmada: ' + names(p.reservation.items) + '. Seu score subiu +' + p.scoreDelta + '.' },
                  { tone: 'info', text: 'Comprovante de doação disponível.' }];
        case 'item:published':
          return [{ tone: 'ok', text: 'Item publicado: ' + p.item.name + ' (x' + p.item.qty + ') em ' + findPoint(p.item.pointId).name + '.' }];
        case 'need:published':
          return [{ tone: 'ok', text: 'Necessidade publicada na vitrine: ' + p.need.name + ' (x' + p.need.qty + ') — urgência ' + p.need.urgency + '.' }];
        default: return [];
      }
    }
    function recordNotifications(evt) {
      notificationsFor(evt).slice().reverse().forEach(function (n) {   // reverse: o 1º da lista fica no topo
        state.notifications.unshift({ id: genId('n'), tone: n.tone, text: n.text, createdAt: now(), read: false });
      });
      if (state.notifications.length > (config.notificationLimit || 20)) state.notifications.length = config.notificationLimit || 20;
    }
    function getNotifications() { return state.notifications.map(function (n) { return Object.assign({}, n); }); }
    function getUnreadCount() { return state.notifications.filter(function (n) { return !n.read; }).length; }
    function markNotificationsRead() {
      var unread = state.notifications.filter(function (n) { return !n.read; });
      unread.forEach(function (n) { n.read = true; });
      if (unread.length) emit('notifications:read', { count: unread.length });
      return { ok: true, changed: unread.length };
    }

    // ---------- consultas (somente leitura) ----------
    var findItem = function (id) { return state.items.find(function (i) { return i.id === id; }); };
    var findPoint = function (id) { return state.pickupPoints.find(function (p) { return p.id === id; }); };
    var findInstitution = function (id) { return state.institutions.find(function (i) { return i.id === id; }); };
    var findReservation = function (id) { return state.reservations.find(function (r) { return r.id === id; }); };
    var cartQty = function (itemId) { var l = state.cart.find(function (x) { return x.itemId === itemId; }); return l ? l.qty : 0; };

    function getAvailableQty(itemId) { var it = findItem(itemId); return it ? it.qty - cartQty(itemId) : 0; }
    function getCartPointId() { return state.cart.length ? findItem(state.cart[0].itemId).pointId : null; }
    function getCartLines() {
      return state.cart.map(function (l) { var it = findItem(l.itemId); return { itemId: l.itemId, name: it.name, qty: l.qty, pointId: it.pointId }; });
    }
    function getCartTotal() { return state.cart.reduce(function (s, l) { return s + l.qty; }, 0); }
    /** Itens (opcionalmente de um ponto), filtrados por filters = { category, text } — busca sem acento e sem maiúsculas. */
    function getItems(pointId, filters) {
      var cat = filters && filters.category, text = normalizeText(filters && filters.text);
      return state.items.filter(function (i) {
        return (!pointId || i.pointId === pointId) && (!cat || i.category === cat) &&
               (!text || normalizeText(i.name).indexOf(text) !== -1);
      });
    }
    function getCategories() { return config.categories.slice(); }
    function getRadiusOptions() { return config.radiusOptionsKm.slice(); }
    function getNeeds(institutionId) { return state.needs.filter(function (n) { return !institutionId || n.institutionId === institutionId; }); }
    function getReservations() { return state.reservations.slice(); }
    function getCurrentReservation() { return findReservation(state.currentReservationId) || null; }

    function confirmedReservations() { return state.reservations.filter(function (r) { return r.status === 'confirmed'; }); }
    // Score e histórico são DERIVADOS das reservas confirmadas (sem copiar dados).
    function getScore() {
      var s = state.user.baseScore + confirmedReservations().length * config.scorePerConfirmedPickup;
      return Math.min(config.maxScore, s);
    }
    function getHistory() {
      return confirmedReservations()
        .sort(function (a, b) { return b.resolvedAt - a.resolvedAt; })
        .map(function (r) { return { reservationId: r.id, itemNames: r.items.map(function (i) { return i.name; }), at: r.resolvedAt }; });
    }

    // ---------- mapa e vitrine (derivados dos mesmos dados) ----------
    /* filters = { radiusKm, category } (ambos opcionais).
     * radiusKm vale para pontos e instituições; category só filtra os itens dos pontos
     * (necessidades não têm categoria no modelo de dados, então só obedecem ao raio). */
    function getMapPins(filters) {
      var pins = [], radius = filters && filters.radiusKm, cat = filters && filters.category;
      var inRadius = function (km) { return !radius || km <= radius; };
      state.pickupPoints.forEach(function (p) {
        if (!inRadius(p.distanceKm)) return;
        var total = getItems(p.id, { category: cat }).reduce(function (s, i) { return s + i.qty; }, 0);
        if (total <= 0) return;                         // sem estoque (nessa categoria) => sem pin de "item disponível"
        var sz = config.pinSize.oferta;
        pins.push({ kind: 'oferta', id: p.id, top: p.map.top, left: p.map.left,
                    size: Math.max(sz.min, Math.min(sz.max, sz.min + Math.floor(total / 2))) });
      });
      state.institutions.forEach(function (inst) {
        var needs = getNeeds(inst.id);
        if (!needs.length || !inRadius(inst.distanceKm)) return;
        var top = needs.reduce(function (best, n) {
          return config.urgencies.indexOf(n.urgency) > config.urgencies.indexOf(best) ? n.urgency : best;
        }, needs[0].urgency);
        pins.push({ kind: 'demanda', id: inst.id, top: inst.map.top, left: inst.map.left,
                    size: config.pinSize.demanda[top], urgency: top });
      });
      return pins;
    }
    function getMapMarkers(filters) { return clusterPins(getMapPins(filters), config.clusterRadiusPx); }
    function getPointDetails(pointId) {
      var p = findPoint(pointId);
      return p ? { point: p, items: getItems(pointId).filter(function (i) { return i.qty > 0; }) } : null;
    }
    function getInstitutionDetails(id) {
      var inst = findInstitution(id);
      return inst ? { institution: inst, needs: getNeeds(id) } : null;
    }

    // ---------- carrinho ----------
    function addToCart(itemId) {
      var item = findItem(itemId);
      if (!item) return fail('ITEM_NOT_FOUND', 'Item inexistente.');
      if (state.cart.length && getCartPointId() !== item.pointId)
        return fail('DIFFERENT_POINT', 'Cada reserva aceita itens de um único ponto de doação.');
      if (getAvailableQty(itemId) <= 0) return fail('OUT_OF_STOCK', 'Sem estoque disponível.');
      var line = state.cart.find(function (l) { return l.itemId === itemId; });
      if (line) line.qty += 1; else state.cart.push({ itemId: itemId, qty: 1 });
      emit('cart:changed', { itemId: itemId });
      return { ok: true, qty: cartQty(itemId) };
    }
    function removeFromCart(itemId) {
      var line = state.cart.find(function (l) { return l.itemId === itemId; });
      if (!line) return fail('NOT_IN_CART', 'Item não está no carrinho.');
      line.qty -= 1;
      if (line.qty <= 0) state.cart = state.cart.filter(function (l) { return l !== line; });
      emit('cart:changed', { itemId: itemId });
      return { ok: true, qty: cartQty(itemId) };
    }
    function selectPoint(pointId) {
      if (!findPoint(pointId)) return fail('POINT_NOT_FOUND', 'Ponto inexistente.');
      state.selectedPointId = pointId;
      emit('point:selected', { pointId: pointId });
      return { ok: true };
    }

    // ---------- reservas ----------
    function reserve() {
      if (!state.cart.length) return fail('EMPTY_CART', 'Carrinho vazio.');
      // disponibilidade é checada de novo no momento da confirmação (concorrência)
      var short = state.cart.filter(function (l) { var it = findItem(l.itemId); return !it || it.qty < l.qty; });
      if (short.length) {
        emit('reservation:rejected', { itemIds: short.map(function (l) { return l.itemId; }) });
        return fail('INSUFFICIENT_STOCK', 'Esse item já foi reservado por outra pessoa');
      }
      var t = now();
      var pointId = getCartPointId();
      var items = state.cart.map(function (l) {
        var it = findItem(l.itemId);
        it.qty -= l.qty;                                // reservar debita o estoque de verdade
        return { itemId: l.itemId, name: it.name, qty: l.qty };
      });
      var r = { id: genId('r'), pointId: pointId, items: items, status: 'pending',
                createdAt: t, expiresAt: t + config.reservationTtlMs, resolvedAt: null };
      state.reservations.push(r);
      state.currentReservationId = r.id;
      state.cart = [];
      emit('reservation:created', { reservation: r });
      return { ok: true, reservation: r };
    }

    function settle(id, to, eventType, extra) {
      var r = findReservation(id);
      if (!r) return fail('RESERVATION_NOT_FOUND', 'Reserva inexistente.');
      if (r.status !== 'pending') return fail('NOT_PENDING', 'A reserva já está ' + r.status + '.');
      var scoreBefore = getScore();
      r.status = to;
      r.resolvedAt = now();
      if (to !== 'confirmed') {                          // expirar/cancelar devolve o estoque
        r.items.forEach(function (ri) { var it = findItem(ri.itemId); if (it) it.qty += ri.qty; });
      }
      emit(eventType, Object.assign({ reservation: r, scoreDelta: getScore() - scoreBefore }, extra));
      return { ok: true, reservation: r };
    }
    function expireReservation(id) { return settle(id, 'expired', 'reservation:expired'); }
    function cancelReservation(id) { return settle(id, 'cancelled', 'reservation:cancelled'); }
    function confirmPickup(id) {
      var r = findReservation(id);
      if (r && r.status === 'pending' && now() >= r.expiresAt) {   // venceu antes de ler o QR
        expireReservation(id);
        return fail('EXPIRED', 'A reserva expirou antes da confirmação.');
      }
      return settle(id, 'confirmed', 'pickup:confirmed');
    }
    /** Expira todas as reservas pendentes vencidas segundo o relógio. Devolve os ids expirados. */
    function expireDue() {
      var t = now();
      return state.reservations
        .filter(function (r) { return r.status === 'pending' && t >= r.expiresAt; })
        .map(function (r) { expireReservation(r.id); return r.id; });
    }
    /** Ferramenta de DEMONSTRAÇÃO: finge que outra pessoa levou TODO o estoque restante do 1º item do carrinho. */
    function simulateCompetingReservation() {
      if (!state.cart.length) return fail('EMPTY_CART', 'Carrinho vazio.');
      var it = findItem(state.cart[0].itemId);
      var taken = it.qty;
      it.qty = 0;
      emit('stock:changed', { itemId: it.id, itemName: it.name, taken: taken, cause: 'competing-reservation' });
      return { ok: true, itemId: it.id, taken: taken };
    }

    // ---------- publicação ----------
    function publishItem(data) {
      data = data || {};
      var name = typeof data.name === 'string' ? data.name.trim() : '';
      var pointId = data.pointId || state.user.pickupPointId;
      if (!name) return fail('INVALID_NAME', 'Informe o nome do item.');
      if (!Number.isInteger(data.qty) || data.qty <= 0) return fail('INVALID_QTY', 'A quantidade deve ser um inteiro positivo.');
      if (!findPoint(pointId)) return fail('POINT_NOT_FOUND', 'Ponto de doação inexistente.');
      var category = data.category || config.categories[0];
      if (config.categories.indexOf(category) === -1) return fail('INVALID_CATEGORY', 'Escolha uma categoria válida.');
      var item = { id: genId('it'), pointId: pointId, name: name, qty: data.qty, urgent: !!data.urgent, category: category };
      state.items.push(item);
      emit('item:published', { item: item });
      return { ok: true, item: item };
    }
    function publishNeed(data) {
      data = data || {};
      var name = typeof data.name === 'string' ? data.name.trim() : '';
      var institutionId = data.institutionId || state.user.institutionId;
      if (!name) return fail('INVALID_NAME', 'Informe o que você precisa.');
      if (!Number.isInteger(data.qty) || data.qty <= 0) return fail('INVALID_QTY', 'A quantidade deve ser um inteiro positivo.');
      if (config.urgencies.indexOf(data.urgency) === -1) return fail('INVALID_URGENCY', 'Escolha o nível de urgência.');
      if (!findInstitution(institutionId)) return fail('INSTITUTION_NOT_FOUND', 'Instituição inexistente.');
      var need = { id: genId('nd'), institutionId: institutionId, name: name, qty: data.qty, urgency: data.urgency };
      state.needs.push(need);
      emit('need:published', { need: need });
      return { ok: true, need: need };
    }

    return {
      subscribe: subscribe,
      // dados de referência
      getUser: function () { return state.user; },
      getPoint: findPoint, getInstitution: findInstitution,
      getSelectedPoint: function () { return findPoint(state.selectedPointId); },
      getItems: getItems, getNeeds: getNeeds, getAvailableQty: getAvailableQty,
      getCategories: getCategories, getRadiusOptions: getRadiusOptions,
      getNotifications: getNotifications, getUnreadCount: getUnreadCount,
      getPointDetails: getPointDetails, getInstitutionDetails: getInstitutionDetails,
      getMapPins: getMapPins, getMapMarkers: getMapMarkers,
      // carrinho e reservas
      getCartLines: getCartLines, getCartTotal: getCartTotal, getCartPoint: function () { return findPoint(getCartPointId()) || null; },
      getReservations: getReservations, getCurrentReservation: getCurrentReservation,
      getScore: getScore, getHistory: getHistory,
      // operações
      addToCart: addToCart, removeFromCart: removeFromCart, selectPoint: selectPoint,
      reserve: reserve, expireReservation: expireReservation, cancelReservation: cancelReservation,
      confirmPickup: confirmPickup, expireDue: expireDue,
      publishItem: publishItem, publishNeed: publishNeed, markNotificationsRead: markNotificationsRead,
      simulateCompetingReservation: simulateCompetingReservation
    };
  }

  return { createStore: createStore, clusterPins: clusterPins, normalizeText: normalizeText };
});
