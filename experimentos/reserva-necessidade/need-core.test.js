'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NeedCore } = require('./need-core');
let tempo = 1_000_000;
function nova() { tempo = 1_000_000; return new NeedCore({ necessidades: [{ id: 1, instituicaoId: 10, solicitada: 100, confirmada: 0, status: 'ABERTA', verificada: true }], agora: () => tempo }); }
function reserva(core, q=60) { return core.reservar({ necessidadeId:1, doadorId:7, quantidade:q, expiraEm: tempo+3600000 }); }
test('EXP-JS-01: disponibilidade inicial = 100', () => { assert.equal(nova().disponibilidade(1).disponivel,100); });
test('EXP-JS-02: reserva de 60 deixa 40 disponíveis', () => { const c=nova(); assert.equal(reserva(c).ok,true); assert.equal(c.disponibilidade(1).disponivel,40); });
test('EXP-JS-03: reserva acima do saldo é recusada sem alterar o saldo', () => { const c=nova(); reserva(c); assert.equal(reserva(c,41).code,'SALDO_INSUFICIENTE'); assert.equal(c.disponibilidade(1).disponivel,40); });
test('EXP-JS-04: quantidade nula, negativa e fracionada é recusada', () => { const c=nova(); for(const q of [0,-3,1.5]) assert.equal(reserva(c,q).code,'QUANTIDADE_INVALIDA'); });
test('EXP-JS-05: cancelamento libera quantidade e não se repete', () => { const c=nova(), id=reserva(c).reserva.id; assert.equal(c.cancelar(id,7).ok,true); assert.equal(c.disponibilidade(1).disponivel,100); assert.equal(c.cancelar(id,7).code,'ESTADO_INVALIDO'); });
test('EXP-JS-06: usuário diferente não cancela reserva alheia', () => { const c=nova(), id=reserva(c).reserva.id; assert.equal(c.cancelar(id,11).code,'NAO_AUTORIZADO'); assert.equal(c.disponibilidade(1).disponivel,40); });
test('EXP-JS-07: expiração só após prazo e restaura 100', () => { const c=nova(), id=reserva(c).reserva.id; assert.equal(c.expirar(id,tempo+1000).code,'AINDA_VALIDA'); tempo+=3600000; assert.equal(c.expirar(id).ok,true); assert.equal(c.disponibilidade(1).disponivel,100); });
test('EXP-JS-08: entrega informada não conta como recebimento', () => { const c=nova(),id=reserva(c).reserva.id; assert.equal(c.informarEntrega(id,7).ok,true); assert.equal(c.disponibilidade(1).confirmada,0); assert.equal(c.disponibilidade(1).reservada,60); });
test('EXP-JS-09: outra instituição não confirma e membro sem autorização também não', () => { const c=nova(),id=reserva(c).reserva.id; c.informarEntrega(id,7); assert.equal(c.confirmar(id,11,true).code,'NAO_AUTORIZADO'); assert.equal(c.confirmar(id,10,false).code,'NAO_AUTORIZADO'); });
test('EXP-JS-10: confirmação institucional move reservado para confirmado, sem mudar disponível', () => { const c=nova(),id=reserva(c).reserva.id; c.informarEntrega(id,7); assert.equal(c.confirmar(id,10,true).ok,true); const s=c.disponibilidade(1); assert.equal(s.confirmada,60); assert.equal(s.reservada,0); assert.equal(s.disponivel,40); });
test('EXP-JS-11: confirmação duplicada e cancelamento confirmado são rejeitados', () => { const c=nova(),id=reserva(c).reserva.id; c.informarEntrega(id,7); c.confirmar(id,10,true); assert.equal(c.confirmar(id,10,true).code,'ESTADO_INVALIDO'); assert.equal(c.cancelar(id,7).code,'ESTADO_INVALIDO'); });
test('EXP-JS-12: necessidade atendida não recebe novas reservas', () => { const c=nova(),id=reserva(c,100).reserva.id; c.informarEntrega(id,7); c.confirmar(id,10,true); assert.equal(c.necessidades[0].status,'ATENDIDA'); assert.equal(reserva(c,1).code,'NECESSIDADE_INATIVA'); });
