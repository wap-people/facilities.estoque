// Pedidos de compra registrados: emitir (a partir do modal do pedido em app.js),
// listar, receber (total ou parcial) e cancelar. Usa window.EstoqueApp.
(function () {
  const App = window.EstoqueApp;
  const esc = App.escapeHtml;
  const STATUS = {
    emitido: { label: 'emitido', badge: 'neutral' },
    parcial: { label: 'recebido parcial', badge: 'warn' },
    recebido: { label: 'recebido', badge: 'ok' },
    cancelado: { label: 'cancelado', badge: 'danger' },
  };

  const st = { wired: false, orders: [], items: {}, open: null, statusFilter: 'open', visible: false };

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return n == null ? '—' : String(Math.round(n * 100) / 100).replace('.', ','); }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'; }
  function feedback(id, msg) {
    const el = $(id); el.textContent = msg || '';
    if (msg) setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 6000);
  }

  // ---------- registrar (chamado pelo modal do pedido em app.js) ----------

  async function registerFromModal(rows, unit, month) {
    const fb = $('poFeedback');
    if (!rows.length) { fb.textContent = 'Nenhum item com quantidade a pedir.'; return; }
    const btn = $('poSaveBtn');
    btn.disabled = true;
    fb.textContent = 'Registrando…';
    const { data: order, error } = await App.sb.from('purchase_orders').insert({
      unit_id: unit, month: month, status: 'emitido',
      created_by: App.userId, created_by_name: App.myName || null,
    }).select('id').single();
    if (error) { btn.disabled = false; fb.textContent = 'Não foi possível registrar: ' + error.message; return; }
    const items = rows.map(function (r) {
      return { order_id: order.id, code: r.code, name: r.name, category: r.category, unit: r.unit || '',
        qty_current: r.qty, min_stock: r.min, qty_ordered: r.order };
    });
    const res = await App.sb.from('purchase_order_items').insert(items);
    btn.disabled = false;
    if (res.error) {
      fb.textContent = 'O pedido nº ' + order.id + ' foi criado, mas os itens falharam: ' + res.error.message;
      return;
    }
    App.logActivity(unit, 'order', '#' + order.id, rows.length + (rows.length === 1 ? ' item' : ' itens'), '');
    fb.textContent = '';
    App.closePurchaseOrder();
    App.showBanner('Pedido nº ' + order.id + ' registrado com ' + rows.length + ' itens. Acompanhe em "Pedidos de compra".');
    setTimeout(function () { App.showBanner(''); }, 6000);
    if (st.visible) loadOrders();
  }

  // ---------- página ----------

  function open() {
    st.visible = true;
    wire();
    loadOrders();
  }

  function wire() {
    if (st.wired) return;
    st.wired = true;
    $('newOrderBtn').addEventListener('click', function () { App.openPurchaseOrder(); });
    $('ordersStatus').addEventListener('change', function (e) { st.statusFilter = e.target.value; renderOrders(); });
    $('ordersBody').addEventListener('click', onOrdersClick);
    document.addEventListener('click', function (e) { if (e.target.closest('[data-rcv-close]')) closeReceive(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeReceive(); });
    $('rcvAllBtn').addEventListener('click', function () {
      document.querySelectorAll('#rcvBody .rcv-qty').forEach(function (i) { i.value = i.dataset.ordered; });
      updateReceiveTotal();
    });
    $('rcvBody').addEventListener('input', updateReceiveTotal);
    $('rcvSaveBtn').addEventListener('click', saveReceive);
    $('rcvCancelOrderBtn').addEventListener('click', cancelOrder);
    window.addEventListener('estoque:context', function () { if (st.visible && isOnPage()) loadOrders(); });
    document.querySelectorAll('.nav-item[data-page]').forEach(function (b) {
      b.addEventListener('click', function () { st.visible = b.dataset.page === 'pedidos'; });
    });
  }

  function isOnPage() { return !$('page-pedidos').hidden; }

  async function loadOrders() {
    const unit = App.currentUnit;
    $('ordersSubtitle').textContent = App.unitLabel(unit) + ' · pedidos registrados e recebimentos';
    $('ordersBody').innerHTML = '<tr><td colspan="10" class="empty-state">Carregando…</td></tr>';
    const { data, error } = await App.sb.from('purchase_orders').select('*').eq('unit_id', unit)
      .order('created_at', { ascending: false }).limit(300);
    if (unit !== App.currentUnit) return;
    if (error) { $('ordersBody').innerHTML = '<tr><td colspan="10" class="empty-state">Erro: ' + esc(error.message) + '</td></tr>'; return; }
    st.orders = data || [];
    st.items = {};
    const ids = st.orders.map(function (o) { return o.id; });
    for (let i = 0; i < ids.length; i += 150) {
      const res = await App.sb.from('purchase_order_items').select('*').in('order_id', ids.slice(i, i + 150));
      if (res.error) break;
      (res.data || []).forEach(function (it) { (st.items[it.order_id] = st.items[it.order_id] || []).push(it); });
    }
    renderOrders();
  }

  function sum(list, f) { return list.reduce(function (a, x) { return a + (Number(x[f]) || 0); }, 0); }

  function renderOrders() {
    const f = st.statusFilter;
    const list = st.orders.filter(function (o) {
      if (f === 'all') return true;
      if (f === 'open') return o.status === 'emitido' || o.status === 'parcial';
      return o.status === f;
    });
    if (!list.length) {
      $('ordersBody').innerHTML = '<tr><td colspan="10" class="empty-state">' +
        (st.orders.length ? 'Nenhum pedido nesta situação.' : 'Nenhum pedido registrado nesta unidade ainda. Clique em <strong>+ Novo pedido</strong>.') + '</td></tr>';
      return;
    }
    $('ordersBody').innerHTML = list.map(function (o) {
      const items = st.items[o.id] || [];
      const s = STATUS[o.status] || STATUS.emitido;
      const received = items.some(function (i) { return i.qty_received != null; }) ? fmt(sum(items, 'qty_received')) : '—';
      const actions = ['<button class="hist-btn" type="button" data-act="open" data-id="' + o.id + '">' +
        (o.status === 'emitido' || o.status === 'parcial' ? 'receber' : 'ver') + '</button>'];
      if (App.isAdmin) actions.push('<button class="hist-btn danger" type="button" data-act="delete" data-id="' + o.id + '">excluir</button>');
      return '<tr>' +
        '<td class="mono">#' + o.id + '</td>' +
        '<td>' + fmtDate(o.created_at) + '</td>' +
        '<td>' + esc(App.monthLabel(o.month)) + '</td>' +
        '<td class="num">' + items.length + '</td>' +
        '<td class="num">' + fmt(sum(items, 'qty_ordered')) + '</td>' +
        '<td class="num">' + received + '</td>' +
        '<td><span class="badge ' + s.badge + '">' + s.label + '</span></td>' +
        '<td>' + esc(o.created_by_name || '—') + '</td>' +
        '<td>' + fmtDate(o.received_at) + '</td>' +
        '<td><div class="actions">' + actions.join('') + '</div></td></tr>';
    }).join('');
  }

  async function onOrdersClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const o = st.orders.find(function (x) { return String(x.id) === b.dataset.id; });
    if (!o) return;
    if (b.dataset.act === 'open') { openReceive(o); return; }
    if (!window.confirm('Excluir definitivamente o pedido nº ' + o.id + '? Ele deixa de contar nos relatórios. Para só anular, prefira "Cancelar pedido".')) return;
    const { error } = await App.sb.from('purchase_orders').delete().eq('id', o.id);
    if (error) { feedback('ordersFeedback', 'Não foi possível excluir: ' + error.message); return; }
    feedback('ordersFeedback', 'Pedido nº ' + o.id + ' excluído.');
    loadOrders();
  }

  // ---------- receber ----------

  function openReceive(o) {
    st.open = o;
    const items = (st.items[o.id] || []).slice().sort(function (a, b) {
      return (a.category + a.code).localeCompare(b.category + b.code);
    });
    const editable = o.status === 'emitido' || o.status === 'parcial';
    const s = STATUS[o.status] || STATUS.emitido;
    $('rcvTitle').textContent = 'Pedido nº ' + o.id;
    $('rcvSub').innerHTML = esc(App.unitLabel(o.unit_id)) + ' · emitido em ' + fmtDate(o.created_at) + ' por ' + esc(o.created_by_name || '—') +
      ' · contagem de ' + esc(App.monthLabel(o.month)) + ' · <span class="badge ' + s.badge + '">' + s.label + '</span>' +
      (o.received_at ? ' · recebido em ' + fmtDate(o.received_at) + (o.received_by_name ? ' por ' + esc(o.received_by_name) : '') : '');
    $('rcvBody').innerHTML =
      (editable ? '<p class="cfg-help" style="margin:10px 0 4px">Informe quanto chegou de cada item. Deixe 0 no que não chegou. Você pode salvar um recebimento parcial e completar depois.</p>' : '') +
      '<div class="po-table-wrap"><table class="po-table"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Pedido</th><th>Recebido</th></tr></thead><tbody>' +
      items.map(function (it) {
        const val = it.qty_received != null ? it.qty_received : (editable ? it.qty_ordered : '');
        return '<tr><td class="mono">' + esc(it.code) + '</td><td class="desc">' + esc(it.name) + '</td><td>' + esc(it.unit) + '</td>' +
          '<td class="num mono">' + fmt(Number(it.qty_ordered)) + '</td>' +
          '<td class="num">' + (editable
            ? '<input class="num-input qty rcv-qty" type="number" min="0" step="any" value="' + val + '" data-code="' + esc(it.code) + '" data-ordered="' + it.qty_ordered + '">'
            : '<span class="mono">' + fmt(it.qty_received == null ? null : Number(it.qty_received)) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (editable ? '<input class="rcv-note" id="rcvNote" type="text" maxlength="300" placeholder="Observação (opcional): nota fiscal, fornecedor, falta de item…" value="' + esc(o.notes || '') + '">'
        : (o.notes ? '<p class="cfg-help" style="margin-top:10px">Obs.: ' + esc(o.notes) + '</p>' : ''));
    $('rcvSaveBtn').hidden = !editable;
    $('rcvAllBtn').hidden = !editable;
    $('rcvCancelOrderBtn').hidden = o.status !== 'emitido';
    $('rcvFeedback').textContent = '';
    updateReceiveTotal();
    $('rcvOverlay').hidden = false;
  }

  function updateReceiveTotal() {
    const o = st.open;
    if (!o) return;
    const items = st.items[o.id] || [];
    const inputs = document.querySelectorAll('#rcvBody .rcv-qty');
    let rec = 0;
    if (inputs.length) inputs.forEach(function (i) { rec += parseFloat(i.value) || 0; });
    else rec = sum(items, 'qty_received');
    $('rcvTotal').textContent = items.length + ' itens · pedido ' + fmt(sum(items, 'qty_ordered')) + ' · recebido ' + fmt(rec);
  }

  function closeReceive() { $('rcvOverlay').hidden = true; st.open = null; }

  async function saveReceive() {
    const o = st.open;
    if (!o) return;
    const items = st.items[o.id] || [];
    const byCode = {};
    items.forEach(function (it) { byCode[it.code] = it; });
    const rows = [];
    let bad = false;
    document.querySelectorAll('#rcvBody .rcv-qty').forEach(function (i) {
      const n = i.value === '' ? 0 : parseFloat(i.value);
      if (isNaN(n) || n < 0) bad = true;
      const it = byCode[i.dataset.code];
      rows.push(Object.assign({}, it, { qty_received: n }));
    });
    if (bad) { $('rcvFeedback').textContent = 'Há quantidades inválidas.'; return; }
    const totalRec = rows.reduce(function (a, r) { return a + r.qty_received; }, 0);
    if (totalRec === 0 && !window.confirm('Nada foi marcado como recebido. Salvar mesmo assim?')) return;
    const complete = rows.every(function (r) { return r.qty_received >= Number(r.qty_ordered); });
    const status = totalRec === 0 ? 'emitido' : (complete ? 'recebido' : 'parcial');
    $('rcvSaveBtn').disabled = true;
    $('rcvFeedback').textContent = 'Salvando…';
    const r1 = await App.sb.from('purchase_order_items').upsert(rows, { onConflict: 'order_id,code' });
    const r2 = r1.error ? null : await App.sb.from('purchase_orders').update({
      status: status,
      notes: ($('rcvNote') && $('rcvNote').value.trim()) || '',
      received_at: totalRec > 0 ? new Date().toISOString() : null,
      received_by: totalRec > 0 ? App.userId : null,
      received_by_name: totalRec > 0 ? (App.myName || null) : null,
    }).eq('id', o.id);
    $('rcvSaveBtn').disabled = false;
    const err = r1.error || (r2 && r2.error);
    if (err) { $('rcvFeedback').textContent = 'Não foi possível salvar: ' + err.message; return; }
    if (totalRec > 0) App.logActivity(o.unit_id, 'receive', '#' + o.id, (complete ? 'completo' : 'parcial') + ', ' + fmt(totalRec) + ' un.', '');
    closeReceive();
    feedback('ordersFeedback', 'Recebimento do pedido nº ' + o.id + ' salvo (' + STATUS[status].label + ').');
    loadOrders();
  }

  async function cancelOrder() {
    const o = st.open;
    if (!o || !window.confirm('Cancelar o pedido nº ' + o.id + '? Ele fica no histórico como cancelado.')) return;
    const { error } = await App.sb.from('purchase_orders').update({ status: 'cancelado' }).eq('id', o.id);
    if (error) { $('rcvFeedback').textContent = 'Não foi possível cancelar: ' + error.message; return; }
    closeReceive();
    feedback('ordersFeedback', 'Pedido nº ' + o.id + ' cancelado.');
    loadOrders();
  }

  window.EstoqueOrders = { registerFromModal: registerFromModal };
  window.EstoquePages = window.EstoquePages || {};
  window.EstoquePages.pedidos = open;
})();
