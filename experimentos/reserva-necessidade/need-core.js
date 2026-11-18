'use strict';
// PoC ISOLADA do domínio 'necessidade institucional'
class NeedCore {
  constructor({ necessidades, agora = () => Date.now() }) {
    this.agora = agora;
    this.necessidades = structuredClone(necessidades);
    this.reservas = [];
    this.sequencia = 0;
  }
  _falha(code, message) { return { ok: false, code, message }; }
  _busca(id) { return this.necessidades.find(n => n.id === id); }
  _reserva(id) { return this.reservas.find(r => r.id === id); }
  disponibilidade(id) {
    const n = this._busca(id);
    if (!n) return this._falha('NECESSIDADE_INEXISTENTE', 'Necessidade inexistente');
    const reservado = this.reservas
      .filter(r => r.necessidadeId === id && (r.status === 'RESERVADA' || r.status === 'ENTREGUE'))
      .reduce((total, r) => total + r.quantidade, 0);
    return { ok: true, solicitada: n.solicitada, reservada: reservado, confirmada: n.confirmada,
             disponivel: n.solicitada - reservado - n.confirmada };
  }
  reservar({ necessidadeId, doadorId, quantidade, expiraEm }) {
    const n = this._busca(necessidadeId);
    if (!n) return this._falha('NECESSIDADE_INEXISTENTE', 'Necessidade inexistente');
    if (!n.verificada || !['ABERTA','PARCIALMENTE_ATENDIDA'].includes(n.status))
      return this._falha('NECESSIDADE_INATIVA', 'Necessidade não habilitada para doações');
    if (!doadorId) return this._falha('DOADOR_INVALIDO', 'Doador não informado');
    if (!Number.isInteger(quantidade) || quantidade <= 0)
      return this._falha('QUANTIDADE_INVALIDA', 'Quantidade deve ser inteiro positivo');
    if (!Number.isFinite(expiraEm) || expiraEm <= this.agora())
      return this._falha('PRAZO_INVALIDO', 'Prazo precisa ser futuro');
    const saldo = this.disponibilidade(necessidadeId);
    if (quantidade > saldo.disponivel)
      return this._falha('SALDO_INSUFICIENTE', 'Quantidade acima da disponível');
    const r = { id: ++this.sequencia, necessidadeId, doadorId, quantidade, status: 'RESERVADA', expiraEm };
    this.reservas.push(r);
    return { ok: true, reserva: structuredClone(r) };
  }
  cancelar(id, doadorId) {
    const r = this._reserva(id);
    if (!r) return this._falha('RESERVA_INEXISTENTE', 'Reserva inexistente');
    if (r.doadorId !== doadorId) return this._falha('NAO_AUTORIZADO', 'Doador não autorizado');
    if (r.status !== 'RESERVADA') return this._falha('ESTADO_INVALIDO', 'Cancelamento não permitido');
    r.status = 'CANCELADA';
    return { ok: true };
  }
  expirar(id, instante = this.agora()) {
    const r = this._reserva(id);
    if (!r) return this._falha('RESERVA_INEXISTENTE', 'Reserva inexistente');
    if (r.status !== 'RESERVADA') return this._falha('ESTADO_INVALIDO', 'Expiração não permitida');
    if (instante < r.expiraEm) return this._falha('AINDA_VALIDA', 'Reserva não venceu');
    r.status = 'EXPIRADA';
    return { ok: true };
  }
  informarEntrega(id, doadorId) {
    const r = this._reserva(id);
    if (!r) return this._falha('RESERVA_INEXISTENTE', 'Reserva inexistente');
    if (r.doadorId !== doadorId) return this._falha('NAO_AUTORIZADO', 'Doador não autorizado');
    if (r.status !== 'RESERVADA') return this._falha('ESTADO_INVALIDO', 'Estado não permite entrega');
    if (this.agora() >= r.expiraEm) return this._falha('EXPIRADA', 'Reserva vencida');
    r.status = 'ENTREGUE'; // continua comprometendo quantidade; ainda NÃO confirma recebimento
    return { ok: true };
  }
  confirmar(id, instituicaoId, membroAutorizado) {
    const r = this._reserva(id);
    if (!r) return this._falha('RESERVA_INEXISTENTE', 'Reserva inexistente');
    const n = this._busca(r.necessidadeId);
    // `membroAutorizado` é dado simulado, não token de autenticação verificável.
    if (n.instituicaoId !== instituicaoId || !membroAutorizado)
      return this._falha('NAO_AUTORIZADO', 'Apenas a instituição destinatária pode confirmar');
    if (r.status !== 'ENTREGUE') return this._falha('ESTADO_INVALIDO', 'Confirmação exige entrega informada');
    r.status = 'CONFIRMADA';
    n.confirmada += r.quantidade;
    n.status = n.confirmada === n.solicitada ? 'ATENDIDA' : 'PARCIALMENTE_ATENDIDA';
    return { ok: true, confirmada: n.confirmada };
  }
}
module.exports = { NeedCore };
