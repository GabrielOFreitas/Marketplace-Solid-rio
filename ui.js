/* ui.js — camada de apresentação: renderização, navegação, eventos da tela e log.
 *
 * Esta camada só LÊ o estado (getters do store) e só ALTERA dados chamando as
 * operações do store. Nenhuma regra de negócio mora aqui.
 * O fluxo é sempre: clique -> operação do store -> evento do store -> render + log.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.MarketUI = api;
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.init);
  else api.init();
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SCREENS = [
    { id: 'login', name: 'Login', status: 'same', group: 'Onboarding' },
    { id: 'cadastro', name: 'Cadastro', status: 'edit', group: 'Onboarding' },
    { id: 'mapa', name: 'Mapa compartilhado', status: 'edit', group: 'Descoberta' },
    { id: 'itens', name: 'Itens do ponto', status: 'same', group: 'Descoberta' },
    { id: 'publicar-item', name: 'Publicar item', status: 'new', group: 'Publicação' },
    { id: 'publicar-necessidade', name: 'Publicar necessidade', status: 'new', group: 'Publicação' },
    { id: 'carrinho', name: 'Carrinho', status: 'edit', group: 'Reserva e retirada' },
    { id: 'processando', name: 'Processando reserva', status: 'edit', group: 'Reserva e retirada' },
    { id: 'qr', name: 'QR Code', status: 'edit', group: 'Reserva e retirada' },
    { id: 'confirmacao', name: 'Confirmação de retirada', status: 'new', group: 'Reserva e retirada' },
    { id: 'comprovante', name: 'Comprovante de doação', status: 'new', group: 'Reserva e retirada' },
    { id: 'perfil', name: 'Perfil / Histórico', status: 'new', group: 'Perfil' },
    { id: 'notificacoes', name: 'Notificações', status: 'new', group: 'Perfil' }
  ];
  var STATUS_LABEL = { same: 'igual', edit: 'ajustada', 'new': 'nova' };

  // Toda ação que o HTML pode pedir via data-action (conferida nos testes).
  var ACTION_NAMES = ['goto', 'prev', 'next', 'filter-map', 'open-sheet', 'close-sheet', 'sheet-primary',
    'cart-add', 'cart-remove', 'confirm-reservation', 'simulate-competition', 'qr-tab', 'confirm-pickup',
    'expire-reservation', 'cancel-reservation', 'publish-item', 'publish-need', 'select-urgency'];

  // ---------- formatação (pura) ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function listItems(items) { return items.map(function (i) { return i.name + ' x' + i.qty; }).join(', '); }

  /** Traduz um evento do store numa linha de log. Devolve null para eventos que não são logados. */
  function describeEvent(evt) {
    var p = evt.payload || {};
    switch (evt.type) {
      case 'reservation:created':
        return { kind: 'ok', text: 'Reserva criada: ' + listItems(p.reservation.items) + ' — estoque debitado, expira em ' + (p.reservation.expiresAt - p.reservation.createdAt) / 1000 + 's.' };
      case 'reservation:rejected':
        return { kind: 'err', text: 'Reserva recusada — estoque insuficiente no momento da confirmação.' };
      case 'reservation:expired':
        return { kind: 'warn', text: 'Reserva expirada: ' + listItems(p.reservation.items) + ' — estoque devolvido automaticamente.' };
      case 'reservation:cancelled':
        return { kind: 'warn', text: 'Reserva cancelada pelo usuário: ' + listItems(p.reservation.items) + ' — estoque devolvido.' };
      case 'pickup:confirmed':
        return { kind: 'ok', text: 'Retirada confirmada por QR: ' + listItems(p.reservation.items) + ' — score +' + p.scoreDelta + '.' };
      case 'item:published':
        return { kind: 'ok', text: 'Item publicado: ' + p.item.name + ' (x' + p.item.qty + ')' + (p.item.urgent ? ' — urgente' : '') + '.' };
      case 'need:published':
        return { kind: 'ok', text: 'Necessidade publicada: ' + p.need.name + ' (x' + p.need.qty + ') — urgência ' + p.need.urgency + '.' };
      case 'stock:changed':
        return { kind: 'warn', text: '[Teste] Outro usuário reservou ' + p.itemName + ' — estoque real caiu, seu carrinho ficou desatualizado.' };
      default: return null;
    }
  }

  // ---------- aplicação ----------
  function init() {
    var data = root.MarketData, State = root.MarketState;
    var store = State.createStore({ seed: data.SEED, config: data.CONFIG });
    var config = data.CONFIG;

    var $ = function (id) { return document.getElementById(id); };
    var ui = { current: 0, mapFilter: 'tudo', sheet: null, urgency: null, logLines: [] };

    // ----- navegação -----
    function indexOfScreen(id) { return SCREENS.findIndex(function (s) { return s.id === id; }); }
    function goTo(idOrIndex) {
      var i = typeof idOrIndex === 'number' ? idOrIndex : indexOfScreen(idOrIndex);
      if (i < 0 || i >= SCREENS.length) return;
      ui.current = i;
      document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('active'); });
      $('screen-' + SCREENS[i].id).classList.add('active');
      document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
      $('nav-' + i).classList.add('active');
      $('flowLabel').textContent = (i + 1) + ' / ' + SCREENS.length + ' — ' + SCREENS[i].name;
      $('prevBtn').disabled = i === 0;
      $('nextBtn').disabled = i === SCREENS.length - 1;
      renderAll();
    }
    function buildNav() {
      var nav = $('nav'), lastGroup = null;
      SCREENS.forEach(function (s, i) {
        if (s.group !== lastGroup) {
          var label = document.createElement('div');
          label.className = 'group-label';
          label.textContent = s.group;
          nav.appendChild(label);
          lastGroup = s.group;
        }
        var btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.id = 'nav-' + i;
        btn.dataset.action = 'goto';
        btn.dataset.screen = s.id;
        btn.innerHTML = '<span class="tag ' + s.status + '">' + STATUS_LABEL[s.status] + '</span> ' + esc(s.name);
        nav.appendChild(btn);
      });
    }
    function showProc(which) {
      ['loading', 'success', 'error'].forEach(function (k) { $('proc-' + k).style.display = k === which ? 'flex' : 'none'; });
    }
    function showQrTab(tab) {
      $('qr-mine').style.display = tab === 'mine' ? 'block' : 'none';
      $('qr-scan').style.display = tab === 'scan' ? 'block' : 'none';
      document.querySelectorAll('#screen-qr .tabs button').forEach(function (b) { b.classList.remove('active'); });
      $('qr-btn-' + tab).classList.add('active');
    }
    function setEnabled(el, enabled) { el.classList.toggle('is-disabled', !enabled); el.setAttribute('aria-disabled', String(!enabled)); }
    function setMsg(id, text, ok) { var el = $(id); el.textContent = text; el.style.color = text ? (ok ? 'var(--oferta)' : 'var(--danger)') : ''; }

    // ----- renderização (lê do store; não decide nada) -----
    function renderMap() {
      $('mapArea').innerHTML = store.getMapMarkers().filter(function (m) {
        return ui.mapFilter === 'tudo' || m.kind === ui.mapFilter;
      }).map(function (m) {
        if (m.type === 'cluster') {
          return '<div class="cluster" data-t="' + m.kind + '" data-action="filter-map" data-f="' + m.kind +
                 '" style="top:' + m.top + 'px;left:' + m.left + 'px">+' + m.count + '</div>';
        }
        return '<div class="pin ' + m.kind + '" data-t="' + m.kind + '" data-action="open-sheet" data-kind="' + m.kind +
               '" data-id="' + esc(m.id) + '" style="width:' + m.size + 'px;height:' + m.size + 'px;top:' + m.top + 'px;left:' + m.left + 'px">' +
               (m.kind === 'demanda' ? '<span class="pin-ic">!</span>' : '') + '</div>';
      }).join('');
      document.querySelectorAll('#screen-mapa .segmented button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.f === ui.mapFilter);
      });
    }
    function renderSheet() {
      var open = !!ui.sheet, html = '';
      if (open && ui.sheet.kind === 'oferta') {
        var d = store.getPointDetails(ui.sheet.id);
        if (!d) open = false; else
          html = '<div style="display:flex; flex-direction:column; gap:8px;"><span class="sheet-type oferta">Item disponível</span>' +
            '<strong style="font-size:14px;">' + esc(d.point.name) + '</strong>' +
            '<div class="sheet-row"><span>Itens</span><span>' + (d.items.map(function (i) { return esc(i.name); }).join(', ') || '—') + '</span></div>' +
            '<div class="sheet-row"><span>Distância</span><span>' + String(d.point.distanceKm).replace('.', ',') + ' km</span></div>' +
            '<div class="sheet-row"><span>Horário</span><span>' + esc(d.point.hours) + '</span></div>' +
            '<div class="sheet-row"><span>Endereço</span><span>' + esc(d.point.address) + '</span></div>' +
            '<div class="btn btn-accent" data-action="sheet-primary">Quero retirar este item</div></div>';
      } else if (open && ui.sheet.kind === 'demanda') {
        var di = store.getInstitutionDetails(ui.sheet.id);
        if (!di) open = false; else
          html = '<div style="display:flex; flex-direction:column; gap:8px;"><span class="sheet-type demanda">Necessidade</span>' +
            '<strong style="font-size:14px;">' + esc(di.institution.name) + '</strong>' +
            di.needs.map(function (n) {
              return '<div class="sheet-row"><span>Item necessário</span><span>' + esc(n.name) + '</span></div>' +
                '<div class="sheet-row"><span>Quantidade</span><span>' + n.qty + ' unidades</span></div>' +
                '<div class="sheet-row"><span>Urgência</span><span' + (n.urgency === 'Alta' ? ' style="color:var(--demanda); font-weight:700;"' : '') + '>' + esc(n.urgency) + '</span></div>';
            }).join('') +
            '<div class="sheet-row"><span>Distância</span><span>' + String(di.institution.distanceKm).replace('.', ',') + ' km</span></div>' +
            '<div class="sheet-row"><span>Endereço</span><span>' + esc(di.institution.address) + '</span></div>' +
            '<div class="btn btn-accent" data-action="sheet-primary">Quero doar este item</div></div>';
      }
      $('sheetBody').innerHTML = html;
      $('sheet').classList.toggle('open', open);
      $('sheetBackdrop').classList.toggle('open', open);
    }
    function renderItens() {
      var point = store.getSelectedPoint();
      $('itensPoint').textContent = point ? 'Ponto: ' + point.name : '';
      var items = point ? store.getItems(point.id) : [];
      $('itensGrid').innerHTML = items.map(function (item) {
        var avail = store.getAvailableQty(item.id), inCart = item.qty - avail;
        return '<div class="item-card">' + (item.urgent ? '<span class="flag">urgente</span>' : '') +
          '<div style="display:flex;flex-direction:column;gap:4px;width:100%;"><span>' + esc(item.name) + '</span>' +
          '<span class="hint">' + (avail <= 0 ? 'sem estoque' : avail + ' disponível(is)') + '</span>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<button class="qty-btn" data-action="cart-remove" data-item-id="' + esc(item.id) + '"' + (inCart === 0 ? ' disabled' : '') + '>−</button>' +
          '<span style="font-size:11px;">' + inCart + '</span>' +
          '<button class="qty-btn" data-action="cart-add" data-item-id="' + esc(item.id) + '"' + (avail <= 0 ? ' disabled' : '') + '>+</button>' +
          '</div></div></div>';
      }).join('');
    }
    function renderCarrinho() {
      var lines = store.getCartLines(), point = store.getCartPoint() || store.getSelectedPoint();
      $('cartPoint').textContent = point ? 'Ponto: ' + point.name : '';
      $('cartLines').innerHTML = lines.length
        ? lines.map(function (l) { return '<div class="cart-line"><span>' + esc(l.name) + '</span><span>x' + l.qty + '</span></div>'; }).join('')
        : '<span class="hint">Carrinho vazio — volte aos itens e adicione algo para doar.</span>';
      $('cartTotal').textContent = store.getCartTotal();
      setEnabled($('cartConfirmBtn'), lines.length > 0);
      setEnabled($('cartRaceBtn'), lines.length > 0);
    }
    function renderQr() {
      var r = store.getCurrentReservation(), info = $('qrInfo'), pending = !!r && r.status === 'pending';
      if (!r) info.textContent = 'Nenhuma reserva ativa.';
      else if (r.status === 'expired') info.innerHTML = '<span style="color:var(--danger); font-weight:600;">Reserva expirada — o item voltou a ficar disponível para outras pessoas.</span>';
      else if (r.status === 'cancelled') info.innerHTML = '<span style="color:var(--demanda); font-weight:600;">Reserva cancelada — o item voltou a ficar disponível.</span>';
      else if (r.status === 'confirmed') info.textContent = 'Retirada já confirmada.';
      else info.textContent = 'Reserva ativa (' + r.items.map(function (i) { return i.name; }).join(', ') + ') — expira em ~' +
        Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000)) + 's se não for confirmada.';
      ['qrScanBtn', 'qrExpireBtn', 'qrCancelBtn'].forEach(function (id) { setEnabled($(id), pending); });
    }
    function renderConfirmacao() {
      var last = store.getReservations().filter(function (r) { return r.status === 'confirmed'; }).pop();
      $('confirmItemsList').textContent = last ? last.items.map(function (i) { return i.name + ' (x' + i.qty + ')'; }).join(', ') : '';
      $('confirmScoreFill').style.width = store.getScore() + '%';
    }
    function renderComprovante() {
      var last = store.getReservations().filter(function (r) { return r.status === 'confirmed'; }).pop();
      $('comprovanteItens').textContent = last ? last.items.map(function (i) { return i.name + ' (x' + i.qty + ')'; }).join(', ') : 'Nenhuma doação confirmada ainda.';
    }
    function renderPerfil() {
      $('perfilName').textContent = store.getUser().name;
      $('perfilScoreLabel').textContent = store.getScore() + '%';
      $('perfilScoreFill').style.width = store.getScore() + '%';
      var h = store.getHistory();
      $('perfilHistorico').innerHTML = h.length
        ? h.map(function (e) { return '<div class="hist-line"><span>' + esc(e.itemNames.join(', ')) + ' — retirado</span><span>' + new Date(e.at).toLocaleDateString('pt-BR') + '</span></div>'; }).join('')
        : '<span class="hint">Nenhuma retirada confirmada ainda.</span>';
    }
    function renderEventLog() {
      $('eventLog').innerHTML = ui.logLines.length
        ? ui.logLines.map(function (e) { return '<div class="log-line ' + e.kind + '"><span class="log-time">' + e.time + '</span>' + esc(e.text) + '</div>'; }).join('')
        : '<span class="hint">Nenhum evento ainda — interaja com o carrinho/reserva.</span>';
    }
    function renderAll() {
      renderMap(); renderSheet(); renderItens(); renderCarrinho(); renderQr();
      renderConfirmacao(); renderComprovante(); renderPerfil(); renderEventLog();
    }

    // ----- log: mecanismo separado, alimentado pelos eventos do store -----
    function log(evt) {
      var line = describeEvent(evt);
      if (!line) return;
      ui.logLines.unshift({ time: new Date().toLocaleTimeString('pt-BR'), kind: line.kind, text: line.text });
      if (ui.logLines.length > config.eventLogLimit) ui.logLines.pop();
    }
    store.subscribe(function (evt) { log(evt); renderAll(); });

    // ----- ações (UI -> operações do store) -----
    var actions = {
      'goto': function (el) { goTo(el.dataset.screen); if (el.dataset.qrTab) showQrTab(el.dataset.qrTab); },
      'prev': function () { goTo(Math.max(0, ui.current - 1)); },
      'next': function () { goTo(Math.min(SCREENS.length - 1, ui.current + 1)); },
      'filter-map': function (el) { ui.mapFilter = el.dataset.f; renderMap(); },
      'open-sheet': function (el) { ui.sheet = { kind: el.dataset.kind, id: el.dataset.id }; renderSheet(); },
      'close-sheet': function () { ui.sheet = null; renderSheet(); },
      'sheet-primary': function () {
        var s = ui.sheet; ui.sheet = null;
        if (s && s.kind === 'oferta') { store.selectPoint(s.id); goTo('itens'); }
        else goTo('carrinho');
        renderSheet();
      },
      'cart-add': function (el) { var r = store.addToCart(el.dataset.itemId); setMsg('itensMsg', r.ok ? '' : r.message, false); },
      'cart-remove': function (el) { store.removeFromCart(el.dataset.itemId); setMsg('itensMsg', ''); },
      'confirm-reservation': function () {
        if (!store.getCartTotal()) return;
        goTo('processando'); showProc('loading');
        setTimeout(function () {                      // pausa só visual; a decisão é do store
          var r = store.reserve();
          showProc(r.ok ? 'success' : 'error');
        }, 900);
      },
      'simulate-competition': function () { store.simulateCompetingReservation(); },
      'qr-tab': function (el) { showQrTab(el.dataset.tab); },
      'confirm-pickup': function () {
        var r = store.getCurrentReservation();
        if (r && store.confirmPickup(r.id).ok) goTo('confirmacao'); else renderAll();
      },
      'expire-reservation': function () { var r = store.getCurrentReservation(); if (r) store.expireReservation(r.id); },
      'cancel-reservation': function () { var r = store.getCurrentReservation(); if (r) store.cancelReservation(r.id); },
      'publish-item': function () {
        var qty = parseInt($('novoItemQtd').value, 10);
        var r = store.publishItem({ name: $('novoItemNome').value, qty: qty, urgent: $('novoItemUrgente').checked });
        if (r.ok) { $('novoItemNome').value = ''; $('novoItemQtd').value = '1'; $('novoItemUrgente').checked = false; }
        setMsg('publicarItemMsg', r.ok ? 'Item publicado! Já aparece em "Itens do ponto".' : r.message, r.ok);
      },
      'select-urgency': function (el) {
        ui.urgency = el.dataset.u;
        document.querySelectorAll('#novaNecUrgenciaRow .urgency-opt').forEach(function (o) { o.classList.toggle('selected', o === el); });
      },
      'publish-need': function () {
        var qty = parseInt($('novaNecQtd').value, 10);
        var r = store.publishNeed({ name: $('novaNecNome').value, qty: qty, urgency: ui.urgency });
        if (r.ok) {
          $('novaNecNome').value = ''; $('novaNecQtd').value = '1'; ui.urgency = null;
          document.querySelectorAll('#novaNecUrgenciaRow .urgency-opt').forEach(function (o) { o.classList.remove('selected'); });
        }
        setMsg('publicarNecMsg', r.ok ? 'Necessidade publicada! Já aparece na vitrine de necessidades.' : r.message, r.ok);
      }
    };
    ACTION_NAMES.forEach(function (n) { if (!actions[n]) throw new Error('Ação sem handler: ' + n); });

    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
    });

    // relógio da expiração: o store decide quem venceu; a UI só atualiza a contagem
    setInterval(function () { store.expireDue(); if (SCREENS[ui.current].id === 'qr') renderQr(); }, 1000);

    buildNav();
    showQrTab('mine');
    goTo(0);
    root.MarketApp = { store: store, goTo: goTo };   // útil para depurar no console
  }

  return { SCREENS: SCREENS, ACTION_NAMES: ACTION_NAMES, describeEvent: describeEvent, esc: esc, init: init };
});
