/* data.js — configuração e dados iniciais de DEMONSTRAÇÃO.
 * Aqui não há lógica: só valores. Quem usa (state.js) recebe cópias profundas,
 * então nada do que acontece em execução altera este arquivo.
 *
 *  CONFIG  -> parâmetros da aplicação (ajustáveis num só lugar)
 *  SEED    -> dados de exemplo com que a demo inicializa
 *  (dados criados em execução ficam no estado; valores calculados, como o score
 *   exibido, são derivados pelas regras em state.js)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    reservationTtlMs: 20000,        // janela de expiração da reserva (demo: 20 s)
    scorePerConfirmedPickup: 3,     // regra herdada do protótipo: +3 por retirada confirmada (não consta em RN documentada)
    maxScore: 100,
    urgencies: ['Baixa', 'Média', 'Alta'],
    eventLogLimit: 30,
    clusterRadiusPx: 45,            // pins do mesmo tipo mais próximos que isso viram um agrupador
    pinSize: {
      demanda: { 'Baixa': 16, 'Média': 20, 'Alta': 24 },   // tamanho por urgência
      oferta: { min: 14, max: 20 }                          // tamanho cresce com o estoque do ponto
    }
  };

  // top/left = posição do pin no mapa (px). O mapa é desenhado a partir destes dados.
  var SEED = {
    user: { name: 'Gabriel', baseScore: 82, pickupPointId: 'p1', institutionId: 'i1' },

    institutions: [
      { id: 'i1', name: 'Abrigo Vida Nova', address: 'Av. Central, 45',  distanceKm: 1.4, map: { top: 90,  left: 150 } },
      { id: 'i2', name: 'Creche Esperança', address: 'Rua Sete, 300',    distanceKm: 2.1, map: { top: 230, left: 70 } }
    ],

    pickupPoints: [
      { id: 'p1', name: 'Mercado São José',  address: 'Rua das Flores, 120', hours: '8h – 18h', distanceKm: 1.4, map: { top: 40,  left: 50 } },
      { id: 'p2', name: 'Padaria Bom Pão',   address: 'Rua Nove, 15',        hours: '6h – 19h', distanceKm: 2.0, map: { top: 200, left: 140 } },
      { id: 'p3', name: 'Empório Boa Safra', address: 'Av. Brasil, 800',     hours: '9h – 20h', distanceKm: 3.2, map: { top: 270, left: 180 } },
      // cinco pontos próximos entre si: formam o agrupador "+5" do mapa
      { id: 'p4', name: 'Mercearia Aurora',  address: 'Rua A, 10', hours: '8h – 17h', distanceKm: 2.6, map: { top: 150, left: 250 } },
      { id: 'p5', name: 'Armazém do Zé',     address: 'Rua B, 22', hours: '8h – 17h', distanceKm: 2.7, map: { top: 158, left: 262 } },
      { id: 'p6', name: 'Quitanda Verde',    address: 'Rua C, 35', hours: '7h – 16h', distanceKm: 2.7, map: { top: 145, left: 268 } },
      { id: 'p7', name: 'Mini Mercado Sol',  address: 'Rua D, 48', hours: '8h – 18h', distanceKm: 2.8, map: { top: 165, left: 255 } },
      { id: 'p8', name: 'Supermercado União', address: 'Rua E, 61', hours: '8h – 21h', distanceKm: 2.9, map: { top: 152, left: 275 } }
    ],

    items: [
      { id: 'it1', pointId: 'p1', name: 'Arroz 5kg',  qty: 3, urgent: true,  category: 'Alimento' },
      { id: 'it2', pointId: 'p1', name: 'Feijão 2kg', qty: 5, urgent: false, category: 'Alimento' },
      { id: 'it3', pointId: 'p1', name: 'Óleo 900ml', qty: 4, urgent: false, category: 'Alimento' },
      { id: 'it4', pointId: 'p1', name: 'Leite',      qty: 2, urgent: true,  category: 'Alimento' },
      { id: 'it5', pointId: 'p2', name: 'Pão de forma',   qty: 6,  urgent: false, category: 'Alimento' },
      { id: 'it6', pointId: 'p3', name: 'Macarrão 500g',  qty: 8,  urgent: false, category: 'Alimento' },
      { id: 'it7', pointId: 'p4', name: 'Açúcar 1kg',     qty: 4,  urgent: false, category: 'Alimento' },
      { id: 'it8', pointId: 'p5', name: 'Café 500g',      qty: 3,  urgent: false, category: 'Alimento' },
      { id: 'it9', pointId: 'p6', name: 'Sabão em barra', qty: 5,  urgent: false, category: 'Alimento' },
      { id: 'it10', pointId: 'p7', name: 'Água 1,5L',     qty: 10, urgent: false, category: 'Alimento' },
      { id: 'it11', pointId: 'p8', name: 'Biscoito',      qty: 6,  urgent: false, category: 'Alimento' }
    ],

    needs: [
      { id: 'nd1', institutionId: 'i1', name: 'Cesta básica', qty: 12, urgency: 'Alta' },
      { id: 'nd2', institutionId: 'i2', name: 'Fraldas',      qty: 30, urgency: 'Baixa' }
    ]
  };

  return { CONFIG: CONFIG, SEED: SEED };
});
