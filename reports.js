// Relatórios: fechamento do mês, evolução, consumo real, pedidos, comparativo de
// unidades e movimentações. Cada relatório é uma lista de tabelas que alimenta a
// tela, o CSV, o Excel e o "Pacote para IA". Usa window.EstoqueApp.
(function () {
  const App = window.EstoqueApp;
  const esc = App.escapeHtml;
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const PAGE = 1000; // limite de linhas por consulta do Supabase

  const ACTION_LABEL = {
    count: 'contagem', add: 'item cadastrado', edit: 'item editado', delete: 'item excluído',
    import: 'importação de planilha', copy: 'cópia de catálogo', order: 'pedido registrado', receive: 'recebimento',
  };
  const ORDER_STATUS = { emitido: 'emitido', parcial: 'recebido parcial', recebido: 'recebido', cancelado: 'cancelado' };

  const st = { wired: false, loadedFilters: false, tab: 'resumo', report: null, running: false };

  function $(id) { return document.getElementById(id); }

  // ---------- utilidades ----------

  function addMonths(m, k) {
    const p = m.split('-');
    const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + k, 1);
    return App.currentMonthStr(d);
  }
  function monthRange(a, b) { const out = []; let m = a; while (m <= b) { out.push(m); m = addMonths(m, 1); } return out; }
  function monthStartIso(m) { const p = m.split('-'); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1).toISOString(); }
  function monthOf(iso) { return App.currentMonthStr(new Date(iso)); }
  function round(n, d) { if (n == null || !isFinite(n)) return null; const f = Math.pow(10, d == null ? 1 : d); return Math.round(n * f) / f; }
  function fmtBR(n, d) {
    if (n == null || !isFinite(n)) return '';
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: 0 });
  }
  function pct(a, b) { return b ? (a / b) * 100 : null; }
  function avg(list) { const v = list.filter(function (x) { return x != null && isFinite(x); }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; }
  function sumv(list) { return list.reduce(function (s, x) { return s + (Number(x) || 0); }, 0); }
  function catRank(c) { const i = App.catOrder.indexOf(c); return i === -1 ? 99 : i; }
  function nowStr() { return new Date().toLocaleString('pt-BR'); }
  function fileStamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }

  async function fetchAll(build) {
    let out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) return out;
    }
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }
  function feedback(msg, keep) {
    const el = $('repFeedback'); el.textContent = msg || '';
    if (msg && !keep) setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 5000);
  }

  // Situação de um item num mês (mesma regra do painel).
  function situation(p, q) {
    if (q == null) return { key: 'warn', label: 'sem contagem' };
    const cov = p.avg > 0 ? q / p.avg : null;
    if (q === 0) return { key: 'crit', label: 'zerado' };
    if (q < p.min) return { key: 'crit', label: 'abaixo da segurança' };
    if (cov != null && cov < 1) return { key: 'crit', label: 'cobertura < 1 mês' };
    if (cov != null && cov < 2) return { key: 'warn', label: 'cobertura < 2 meses' };
    return { key: 'ok', label: 'ok' };
  }

  // ---------- filtros ----------

  async function open() {
    wire();
    if (!st.loadedFilters) {
      await loadFilters();
      st.loadedFilters = true;
      run();
    }
  }

  function wire() {
    if (st.wired) return;
    st.wired = true;
    $('repRunBtn').addEventListener('click', run);
    $('repTabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-rtab]');
      if (b) { st.tab = b.dataset.rtab; renderTab(); }
    });
    $('repFrom').addEventListener('change', function () { if ($('repTo').value < $('repFrom').value) $('repTo').value = $('repFrom').value; });
    $('repTo').addEventListener('change', function () { if ($('repFrom').value > $('repTo').value) $('repFrom').value = $('repTo').value; });
    $('repCsvBtn').addEventListener('click', exportCsv);
    $('repXlsxBtn').addEventListener('click', exportXlsx);
    $('repAiBtn').addEventListener('click', openAi);
    document.addEventListener('click', function (e) { if (e.target.closest('[data-ai-close]')) $('aiOverlay').hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('aiOverlay').hidden = true; });
    ['aiIncEvolution', 'aiIncConsumo', 'aiIncPedidos', 'aiIncMov'].forEach(function (id) { $(id).addEventListener('change', buildAiText); });
    $('aiFocus').addEventListener('input', debounce(buildAiText, 300));
    $('aiCopyBtn').addEventListener('click', copyAi);
    $('aiDownloadBtn').addEventListener('click', function () {
      download('relatorio-estoque-ia-' + fileStamp() + '.md', $('aiText').value, 'text/markdown;charset=utf-8');
    });
  }

  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  async function loadFilters() {
    $('repUnit').innerHTML = '<option value="*">Todas as unidades</option>' + App.units.map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.label) + '</option>';
    }).join('');
    $('repUnit').value = App.currentUnit;

    const cur = App.currentMonthStr();
    const [first, lastCounted, cats] = await Promise.all([
      App.sb.from('counts').select('month').order('month', { ascending: true }).limit(1),
      App.sb.from('counts').select('month').not('qty', 'is', null).order('month', { ascending: false }).limit(1),
      App.sb.from('products').select('category'),
    ]);
    const firstM = first.data && first.data[0] ? first.data[0].month : cur;
    const lastM = lastCounted.data && lastCounted.data[0] ? lastCounted.data[0].month : cur;
    const start = addMonths(firstM < cur ? firstM : cur, -1);
    const end = addMonths(lastM > cur ? lastM : cur, 1);
    const opts = monthRange(start, end).reverse().map(function (m) { return '<option value="' + m + '">' + esc(App.monthLabel(m)) + '</option>'; }).join('');
    $('repFrom').innerHTML = opts; $('repTo').innerHTML = opts;
    $('repTo').value = lastM;
    const from = addMonths(lastM, -5);
    $('repFrom').value = from < start ? start : from;

    const catSet = Array.from(new Set((cats.data || []).map(function (r) { return r.category; }))).filter(Boolean)
      .sort(function (a, b) { return catRank(a) - catRank(b) || a.localeCompare(b); });
    $('repCategory').innerHTML = '<option value="all">Todas</option>' + catSet.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  // ---------- coleta e cálculo ----------

  async function run() {
    if (st.running) return;
    st.running = true;
    $('repRunBtn').disabled = true;
    ['repAiBtn', 'repXlsxBtn', 'repCsvBtn'].forEach(function (id) { $(id).disabled = true; });
    $('repContent').innerHTML = '<div class="empty-state">Buscando dados…</div>';
    try {
      const f = {
        unit: $('repUnit').value, from: $('repFrom').value, to: $('repTo').value, category: $('repCategory').value,
      };
      f.units = f.unit === '*' ? App.units.map(function (u) { return u.id; }) : [f.unit];
      f.months = monthRange(f.from, f.to);
      f.prev = addMonths(f.from, -1);
      const data = await collect(f);
      st.report = buildReport(f, data);
      renderTab();
      ['repAiBtn', 'repXlsxBtn', 'repCsvBtn'].forEach(function (id) { $(id).disabled = false; });
    } catch (e) {
      console.error(e);
      $('repContent').innerHTML = '<div class="item-error">Não foi possível gerar o relatório: ' + esc(e.message || String(e)) + '</div>';
    } finally {
      st.running = false;
      $('repRunBtn').disabled = false;
    }
  }

  async function collect(f) {
    const sb = App.sb;
    const endIso = monthStartIso(addMonths(f.to, 1));
    const [products, counts, orders, activity] = await Promise.all([
      fetchAll(function () { return sb.from('products').select('*').in('unit_id', f.units).order('unit_id').order('code'); }),
      fetchAll(function () { return sb.from('counts').select('unit_id, code, month, qty, updated_at').in('unit_id', f.units).gte('month', f.prev).lte('month', f.to).order('unit_id').order('code').order('month'); }),
      fetchAll(function () { return sb.from('purchase_orders').select('*').in('unit_id', f.units).lt('created_at', endIso).order('id'); }),
      fetchAll(function () { return sb.from('activity').select('*').in('unit_id', f.units).gte('created_at', monthStartIso(f.from)).lt('created_at', endIso).order('id'); }),
    ]);
    const ids = orders.map(function (o) { return o.id; });
    let items = [];
    for (let i = 0; i < ids.length; i += 150) {
      const part = await fetchAll(function () { return sb.from('purchase_order_items').select('*').in('order_id', ids.slice(i, i + 150)).order('order_id').order('code'); });
      items = items.concat(part);
    }
    return { products: products, counts: counts, orders: orders, items: items, activity: activity };
  }

  function buildReport(f, d) {
    const catOk = function (c) { return f.category === 'all' || c === f.category; };
    const products = d.products.filter(function (p) { return catOk(p.category); }).map(function (p) {
      return { unit: p.unit_id, code: p.code, name: p.name, category: p.category, un: p.unit || '', min: Number(p.min_stock) || 0, avg: Number(p.avg_consumption) || 0, key: p.unit_id + '|' + p.code };
    }).sort(function (a, b) { return a.unit.localeCompare(b.unit) || catRank(a.category) - catRank(b.category) || a.category.localeCompare(b.category) || a.code.localeCompare(b.code); });
    const pkeys = {}; products.forEach(function (p) { pkeys[p.key] = p; });

    const qty = {}, upd = {};
    d.counts.forEach(function (c) {
      const k = c.unit_id + '|' + c.code;
      (qty[k] = qty[k] || {})[c.month] = c.qty == null ? null : Number(c.qty);
      (upd[k] = upd[k] || {})[c.month] = c.updated_at;
    });
    const q = function (k, m) { return qty[k] && qty[k][m] != null ? qty[k][m] : null; };

    // pedidos relevantes: emitidos ou recebidos dentro do período
    const pStart = monthStartIso(f.from), pEnd = monthStartIso(addMonths(f.to, 1));
    const inPeriod = function (iso) { return iso && iso >= pStart && iso < pEnd; };
    const itemsByOrder = {};
    d.items.forEach(function (it) { (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it); });
    const orders = d.orders.filter(function (o) { return inPeriod(o.created_at) || inPeriod(o.received_at); });

    // recebido por item: por mês do calendário (coluna "Recebido no mês") e lista datada
    // (para o consumo real, que usa o intervalo entre as duas contagens)
    const rec = {}, ord = {}, recList = {};
    d.orders.forEach(function (o) {
      if (o.status === 'cancelado') return;
      (itemsByOrder[o.id] || []).forEach(function (it) {
        const k = o.unit_id + '|' + it.code;
        if (o.received_at && it.qty_received != null) {
          const m = monthOf(o.received_at);
          (rec[k] = rec[k] || {})[m] = ((rec[k] || {})[m] || 0) + Number(it.qty_received);
          (recList[k] = recList[k] || []).push({ at: o.received_at, qty: Number(it.qty_received) });
        }
        const mo = monthOf(o.created_at);
        (ord[k] = ord[k] || {})[mo] = ((ord[k] || {})[mo] || 0) + Number(it.qty_ordered);
      });
    });
    const r = function (k, m) { return rec[k] && rec[k][m] ? rec[k][m] : 0; };
    // Consumo real = contagem anterior + recebido entre as duas contagens − contagem atual.
    // Sem a data de alguma contagem, cai no recebido do mês do calendário.
    const receivedBetween = function (k, m) {
      const pm = addMonths(m, -1);
      const t0 = upd[k] && upd[k][pm], t1 = upd[k] && upd[k][m];
      if (!t0 || !t1) return r(k, m);
      return sumv((recList[k] || []).filter(function (x) { return x.at > t0 && x.at <= t1; }).map(function (x) { return x.qty; }));
    };
    const consumo = function (k, m) {
      const a = q(k, addMonths(m, -1)), b = q(k, m);
      return a == null || b == null ? null : a + receivedBetween(k, m) - b;
    };

    const M = f.to;
    const units = f.units;
    const unitName = function (id) { return App.unitLabel(id); };
    const monthShort = App.monthShort;
    const tables = {};
    const meta = {
      unitsLabel: f.unit === '*' ? 'Todas as unidades (' + units.map(unitName).join(', ') + ')' : unitName(f.unit),
      period: App.monthLabel(f.from) + ' a ' + App.monthLabel(f.to),
      category: f.category === 'all' ? 'Todas' : f.category,
      generatedAt: nowStr(), by: App.myName || '', months: f.months, multiUnit: units.length > 1, finalMonth: M,
    };

    // ----- Resumo -----
    function monthStats(m, subset) {
      const list = subset || products;
      let counted = 0, below = 0, zero = 0, covLow = 0, crit = 0, warn = 0, ok = 0;
      const covs = [], cons = [];
      list.forEach(function (p) {
        const v = q(p.key, m);
        const s = situation(p, v);
        if (s.key === 'crit') crit++; else if (s.key === 'warn') warn++; else ok++;
        if (v != null) {
          counted++;
          if (v < p.min) below++;
          if (v === 0) zero++;
          if (p.avg > 0) { covs.push(v / p.avg); if (v / p.avg < 1) covLow++; }
        }
        const c = consumo(p.key, m); if (c != null) cons.push(c);
      });
      const recv = sumv(list.map(function (p) { return r(p.key, m); }));
      const scopeUnits = subset ? Array.from(new Set(list.map(function (p) { return p.unit; }))) : units;
      const ordEm = orders.filter(function (o) { return scopeUnits.indexOf(o.unit_id) !== -1 && o.status !== 'cancelado' && monthOf(o.created_at) === m; }).length;
      const ordRc = orders.filter(function (o) { return scopeUnits.indexOf(o.unit_id) !== -1 && o.received_at && monthOf(o.received_at) === m && o.status !== 'cancelado'; }).length;
      return { total: list.length, counted: counted, below: below, zero: zero, covLow: covLow, crit: crit, warn: warn, ok: ok,
        covAvg: avg(covs), consTotal: cons.length ? sumv(cons) : null, consN: cons.length, recv: recv, ordEm: ordEm, ordRc: ordRc };
    }
    const last = monthStats(M);
    st.kpis = last;

    tables.kpi = { id: 'kpi', title: 'Indicadores de ' + App.monthLabel(M), cols: [['Indicador', 's'], ['Valor', 's']], rows: [
      ['Itens no catálogo', String(last.total)],
      ['Itens contados', last.counted + ' (' + fmtBR(pct(last.counted, last.total), 0) + '%)'],
      ['Abaixo do estoque de segurança', String(last.below)],
      ['Zerados', String(last.zero)],
      ['Cobertura menor que 1 mês', String(last.covLow)],
      ['Cobertura média (meses)', fmtBR(last.covAvg, 1)],
      ['Situação: crítico / atenção / saudável', last.crit + ' / ' + last.warn + ' / ' + last.ok],
      ['Consumo real total no mês (un.)', last.consTotal == null ? 'sem dado (precisa de contagem no mês anterior)' : fmtBR(last.consTotal, 1) + ' (' + last.consN + ' itens com dado)'],
      ['Recebido no mês (un.)', fmtBR(last.recv, 1)],
      ['Pedidos emitidos / recebidos no mês', last.ordEm + ' / ' + last.ordRc],
    ] };

    tables.trend = { id: 'trend', title: 'Evolução mensal dos indicadores',
      cols: [['Mês', 's'], ['Itens', 'n', 0], ['Contados', 'n', 0], ['% contados', 'n', 0], ['Abaixo da segurança', 'n', 0], ['Zerados', 'n', 0], ['Cobertura < 1 mês', 'n', 0], ['Cobertura média (meses)', 'n', 1], ['Consumo real total', 'n', 1], ['Recebido (un.)', 'n', 1], ['Pedidos emitidos', 'n', 0], ['Pedidos recebidos', 'n', 0]],
      rows: f.months.map(function (m) {
        const s = monthStats(m);
        return [App.monthLabel(m), s.total, s.counted, pct(s.counted, s.total), s.below, s.zero, s.covLow, s.covAvg, s.consTotal, s.recv, s.ordEm, s.ordRc];
      }) };

    const finalRows = products.map(function (p) {
      const v = q(p.key, M);
      const cov = v != null && p.avg > 0 ? v / p.avg : null;
      const s = situation(p, v);
      return { p: p, v: v, cov: cov, s: s, sug: v != null ? Math.max(0, p.min - v) : null, rec: r(p.key, M), cons: consumo(p.key, M), upd: upd[p.key] && upd[p.key][M] };
    });

    tables.critical = { id: 'critical', title: 'Itens mais críticos em ' + App.monthLabel(M) + ' (menor cobertura primeiro)',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Contado', 'n', 1], ['Segurança', 'n', 1], ['Consumo/mês', 'n', 1], ['Cobertura (meses)', 'n', 1], ['Situação', 's'], ['Sugestão de pedido', 'n', 1]],
      rows: finalRows.filter(function (x) { return x.s.key === 'crit'; })
        .sort(function (a, b) { return (a.cov == null ? -1 : a.cov) - (b.cov == null ? -1 : b.cov) || (a.v || 0) - (b.v || 0); })
        .slice(0, 20).map(function (x) { return [x.p.unit, x.p.code, x.p.name, x.v, x.p.min, x.p.avg, x.cov, x.s.label, x.sug]; }),
      tone: 'crit' };

    const consRows = products.map(function (p) {
      const vals = f.months.map(function (m) { return consumo(p.key, m); });
      const real = avg(vals);
      const neg = f.months.filter(function (m, i) { return vals[i] != null && vals[i] < 0; });
      return { p: p, vals: vals, real: real, n: vals.filter(function (v) { return v != null; }).length, diff: real != null && p.avg > 0 ? pct(real - p.avg, p.avg) : null, neg: neg };
    });
    tables.diverge = { id: 'diverge', title: 'Consumo real x consumo cadastrado — maiores diferenças',
      note: 'Diferença % = (consumo real médio − consumo cadastrado) ÷ consumo cadastrado. Valores grandes indicam que o consumo médio e o estoque de segurança cadastrados talvez precisem de ajuste.',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Consumo cadastrado', 'n', 1], ['Consumo real médio', 'n', 1], ['Diferença %', 'n', 0], ['Meses com dado', 'n', 0]],
      rows: consRows.filter(function (x) { return x.diff != null; }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); })
        .slice(0, 20).map(function (x) { return [x.p.unit, x.p.code, x.p.name, x.p.avg, x.real, x.diff, x.n]; }) };

    const uncounted = finalRows.filter(function (x) { return x.v == null; });
    tables.uncounted = { id: 'uncounted', title: 'Itens sem contagem em ' + App.monthLabel(M) + ' (' + uncounted.length + ')',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Categoria', 's']],
      rows: uncounted.slice(0, 200).map(function (x) { return [x.p.unit, x.p.code, x.p.name, x.p.category]; }) };

    // ----- Fechamento -----
    tables.closing = { id: 'closing', title: 'Fechamento de ' + App.monthLabel(M) + ' — todos os itens',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Categoria', 's'], ['Un.', 's'], ['Segurança', 'n', 1], ['Consumo cadastrado', 'n', 1], ['Contado', 'n', 1], ['Cobertura (meses)', 'n', 1], ['Situação', 's'], ['Sugestão de pedido', 'n', 1], ['Recebido no mês', 'n', 1], ['Consumo real no mês', 'n', 1], ['Data da contagem', 's']],
      rows: finalRows.map(function (x) {
        return [x.p.unit, x.p.code, x.p.name, x.p.category, x.p.un, x.p.min, x.p.avg, x.v, x.cov, x.s.label, x.sug, x.rec || null, x.cons, x.upd ? new Date(x.upd).toLocaleDateString('pt-BR') : ''];
      }),
      tones: finalRows.map(function (x) { return x.s.key; }) };

    // ----- Evolução -----
    tables.evolution = { id: 'evolution', title: 'Quantidade contada por mês',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Categoria', 's'], ['Segurança', 'n', 1]]
        .concat(f.months.map(function (m) { return [monthShort(m), 'n', 1]; })).concat([['Variação no período', 'n', 1]]),
      rows: products.map(function (p) {
        const vals = f.months.map(function (m) { return q(p.key, m); });
        const got = vals.filter(function (v) { return v != null; });
        return [p.unit, p.code, p.name, p.category, p.min].concat(vals).concat([got.length >= 2 ? got[got.length - 1] - got[0] : null]);
      }) };

    // ----- Consumo real -----
    tables.consumption = { id: 'consumption', title: 'Consumo real por mês (contagem anterior + recebido entre as contagens − contagem atual)',
      note: 'Só é calculado quando o item tem contagem no mês e no mês anterior. Valores negativos indicam erro de contagem ou recebimento não registrado.',
      cols: [['Unidade', 's'], ['Código', 's'], ['Descrição', 'w'], ['Consumo cadastrado', 'n', 1]]
        .concat(f.months.map(function (m) { return [monthShort(m), 'n', 1]; }))
        .concat([['Média real', 'n', 1], ['Diferença %', 'n', 0], ['Alerta', 'w']]),
      rows: consRows.map(function (x) {
        const alert = x.neg.length ? 'consumo negativo em ' + x.neg.map(monthShort).join(', ') : (x.n === 0 ? 'sem dado suficiente' : '');
        return [x.p.unit, x.p.code, x.p.name, x.p.avg].concat(x.vals).concat([x.real, x.diff, alert]);
      }) };

    // ----- Pedidos -----
    const orderRows = orders.map(function (o) {
      const its = (itemsByOrder[o.id] || []).filter(function (it) { return catOk(it.category); });
      const ordered = sumv(its.map(function (i) { return i.qty_ordered; }));
      const received = its.some(function (i) { return i.qty_received != null; }) ? sumv(its.map(function (i) { return i.qty_received; })) : null;
      const lead = o.received_at ? (new Date(o.received_at) - new Date(o.created_at)) / 86400000 : null;
      return { o: o, its: its, ordered: ordered, received: received, fill: received != null ? pct(received, ordered) : null, lead: lead };
    }).filter(function (x) { return x.its.length; });
    const valid = orderRows.filter(function (x) { return x.o.status !== 'cancelado'; });
    const leadAvg = avg(valid.map(function (x) { return x.lead; }));
    const fillAvg = avg(valid.map(function (x) { return x.fill; }));
    tables.orders = { id: 'orders', title: 'Pedidos emitidos ou recebidos no período (' + orderRows.length + ')',
      note: 'Prazo médio de entrega: ' + (leadAvg == null ? 'sem recebimentos' : fmtBR(leadAvg, 1) + ' dias') + ' · atendimento médio: ' + (fillAvg == null ? '—' : fmtBR(fillAvg, 0) + '%') + ' · cancelados: ' + (orderRows.length - valid.length) + '.',
      cols: [['Nº', 's'], ['Unidade', 's'], ['Emitido em', 's'], ['Contagem de', 's'], ['Situação', 's'], ['Itens', 'n', 0], ['Qtd. pedida', 'n', 1], ['Qtd. recebida', 'n', 1], ['% atendido', 'n', 0], ['Prazo (dias)', 'n', 1], ['Emitido por', 's'], ['Recebido por', 's'], ['Observação', 'w']],
      rows: orderRows.map(function (x) {
        return ['#' + x.o.id, x.o.unit_id, new Date(x.o.created_at).toLocaleDateString('pt-BR'), App.monthLabel(x.o.month), ORDER_STATUS[x.o.status] || x.o.status,
          x.its.length, x.ordered, x.received, x.fill, x.lead, x.o.created_by_name || '', x.o.received_by_name || '', x.o.notes || ''];
      }) };
    tables.orderItems = { id: 'orderItems', title: 'Itens dos pedidos',
      cols: [['Nº', 's'], ['Unidade', 's'], ['Situação', 's'], ['Código', 's'], ['Descrição', 'w'], ['Contado ao pedir', 'n', 1], ['Segurança', 'n', 1], ['Pedido', 'n', 1], ['Recebido', 'n', 1], ['Faltou', 'n', 1]],
      rows: [].concat.apply([], orderRows.map(function (x) {
        return x.its.map(function (it) {
          const got = it.qty_received == null ? null : Number(it.qty_received);
          return ['#' + x.o.id, x.o.unit_id, ORDER_STATUS[x.o.status] || x.o.status, it.code, it.name, it.qty_current == null ? null : Number(it.qty_current), Number(it.min_stock), Number(it.qty_ordered), got, got == null ? null : Math.max(0, Number(it.qty_ordered) - got)];
        });
      })) };

    // ----- Comparativo de unidades -----
    tables.units = { id: 'units', title: 'Comparativo de unidades em ' + App.monthLabel(M),
      cols: [['Unidade', 's'], ['Itens', 'n', 0], ['Contados', 'n', 0], ['% contados', 'n', 0], ['Abaixo da segurança', 'n', 0], ['Zerados', 'n', 0], ['Críticos', 'n', 0], ['Cobertura média (meses)', 'n', 1], ['Consumo real no mês', 'n', 1], ['Pedidos no período', 'n', 0], ['Prazo médio (dias)', 'n', 1], ['Atendimento médio %', 'n', 0]],
      rows: units.map(function (u) {
        const sub = products.filter(function (p) { return p.unit === u; });
        const s = monthStats(M, sub);
        const uo = valid.filter(function (x) { return x.o.unit_id === u; });
        return [unitName(u), s.total, s.counted, pct(s.counted, s.total), s.below, s.zero, s.crit, s.covAvg, s.consTotal, uo.length, avg(uo.map(function (x) { return x.lead; })), avg(uo.map(function (x) { return x.fill; }))];
      }) };

    // ----- Movimentações -----
    const acts = d.activity.slice().sort(function (a, b) { return b.created_at.localeCompare(a.created_at); })
      .filter(function (a) {
        // com filtro de categoria: mantém movimentos dos itens da categoria e os gerais (pedidos, importações, cópias)
        return f.category === 'all' || !!pkeys[a.unit_id + '|' + a.code] || !a.code || a.code.charAt(0) === '#' || a.code === '*';
      });
    tables.activity = { id: 'activity', title: 'Movimentações no período (' + acts.length + ')',
      cols: [['Data e hora', 's'], ['Unidade', 's'], ['Pessoa', 's'], ['Ação', 's'], ['Código', 's'], ['Descrição', 'w'], ['Detalhe', 'w'], ['Mês da contagem', 's']],
      rows: acts.map(function (a) {
        return [new Date(a.created_at).toLocaleString('pt-BR'), a.unit_id, a.actor_name || a.actor_email || '', ACTION_LABEL[a.type] || a.type,
          a.code === '*' ? '' : a.code, a.name || '', a.detail || '', a.month ? App.monthLabel(a.month) : ''];
      }) };

    return {
      meta: meta, tables: tables,
      tabs: {
        resumo: ['kpi', 'trend', 'critical', 'diverge', 'uncounted'],
        fechamento: ['closing'], evolucao: ['evolution'], consumo: ['consumption'],
        pedidos: ['orders', 'orderItems'], unidades: ['units'], movimentacoes: ['activity'],
      },
    };
  }

  // ---------- tela ----------

  function cellHtml(v, col) {
    if (v == null || v === '') return '<td' + (col[1] === 'n' ? ' class="n"' : '') + '>' + (col[1] === 'n' ? '—' : '') + '</td>';
    if (col[1] === 'n') return '<td class="n">' + esc(fmtBR(v, col[2])) + '</td>';
    return '<td' + (col[1] === 'w' ? ' class="wrap"' : '') + '>' + esc(String(v)) + '</td>';
  }

  function tableHtml(t) {
    if (!t.rows.length) {
      return '<div class="rep-block"><h3>' + esc(t.title) + '</h3>' + (t.note ? '<div class="rep-note">' + esc(t.note) + '</div>' : '') + '<div class="empty-state">Sem dados para este filtro.</div></div>';
    }
    return '<div class="rep-block"><h3>' + esc(t.title) + '</h3>' + (t.note ? '<div class="rep-note">' + esc(t.note) + '</div>' : '') +
      '<div class="rep-scroll"><table class="rep-table"><thead><tr>' +
      t.cols.map(function (c) { return '<th' + (c[1] === 'n' ? ' class="n"' : '') + '>' + esc(c[0]) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      t.rows.map(function (row, i) {
        const tone = t.tones ? t.tones[i] : t.tone;
        return '<tr' + (tone === 'crit' ? ' class="tone-crit"' : tone === 'warn' ? ' class="tone-warn"' : '') + '>' +
          row.map(function (v, j) { return cellHtml(v, t.cols[j]); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function renderTab() {
    document.querySelectorAll('#repTabs .tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.rtab === st.tab ? 'true' : 'false'); });
    const rep = st.report;
    if (!rep) return;
    const m = rep.meta;
    let html = '<div class="rep-note">Escopo: <strong>' + esc(m.unitsLabel) + '</strong> · período <strong>' + esc(m.period) + '</strong> · categoria <strong>' + esc(m.category) + '</strong> · gerado em ' + esc(m.generatedAt) + '</div>';
    if (st.tab === 'resumo') {
      const k = st.kpis;
      html += '<div class="rep-kpis">' +
        kpi(k.total, 'Itens no catálogo') + kpi(k.counted, 'Contados em ' + App.monthShort(m.finalMonth)) +
        kpi(k.below, 'Abaixo da segurança', k.below > 0) + kpi(k.zero, 'Zerados', k.zero > 0) +
        kpi(k.covLow, 'Cobertura < 1 mês', k.covLow > 0) + kpi(k.covAvg == null ? '—' : fmtBR(k.covAvg, 1), 'Cobertura média (meses)') +
        kpi(k.consTotal == null ? '—' : fmtBR(k.consTotal, 0), 'Consumo real no mês') + kpi(fmtBR(k.recv, 0) || '0', 'Recebido no mês') +
        '</div>';
    }
    if (st.tab === 'unidades' && !m.multiUnit) html += '<div class="rep-note">Dica: escolha <strong>Todas as unidades</strong> no filtro para comparar as unidades lado a lado.</div>';
    rep.tabs[st.tab].forEach(function (id) { if (!(st.tab === 'resumo' && id === 'kpi')) html += tableHtml(rep.tables[id]); });
    $('repContent').innerHTML = html;
  }

  function kpi(v, label, warn) {
    return '<div class="kpi' + (warn ? ' warn' : '') + '"><div class="num mono">' + esc(String(v)) + '</div><div class="label">' + esc(label) + '</div></div>';
  }

  // ---------- exportação ----------

  function csvCell(v, col) {
    if (v == null) return '';
    let s = col && col[1] === 'n' ? fmtBR(v, col[2] == null ? 2 : col[2]).replace(/\./g, '') : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function tableCsv(t) {
    return [t.cols.map(function (c) { return csvCell(c[0]); }).join(';')].concat(t.rows.map(function (row) {
      return row.map(function (v, j) { return csvCell(v, t.cols[j]); }).join(';');
    })).join('\r\n');
  }

  function exportCsv() {
    const rep = st.report; if (!rep) return;
    const ids = rep.tabs[st.tab];
    const body = ids.map(function (id) { const t = rep.tables[id]; return (ids.length > 1 ? csvCell(t.title) + '\r\n' : '') + tableCsv(t); }).join('\r\n\r\n');
    download('relatorio-' + st.tab + '-' + fileStamp() + '.csv', '﻿' + body, 'text/csv;charset=utf-8');
    feedback('CSV baixado.');
  }

  function definitionsLines(meta) {
    return [
      'Escopo: ' + meta.unitsLabel,
      'Período: ' + meta.period + ' (mês final do fechamento: ' + App.monthLabel(meta.finalMonth) + ')',
      'Categoria: ' + meta.category,
      'Gerado em: ' + meta.generatedAt + (meta.by ? ' por ' + meta.by : ''),
      '',
      'Definições:',
      '- Contagem: quantidade física contada no mês (uma por item e mês). Vazio = sem contagem.',
      '- Estoque de segurança: quantidade mínima desejada do item. Consumo cadastrado: consumo médio mensal informado no catálogo (valores atuais, sem histórico).',
      '- Cobertura (meses) = contado ÷ consumo cadastrado.',
      '- Situação: crítico = zerado, abaixo da segurança ou cobertura < 1 mês; atenção = sem contagem ou cobertura < 2 meses; ok = demais.',
      '- Sugestão de pedido = estoque de segurança − contado (quando positivo).',
      '- Consumo real do mês = contagem do mês anterior + recebido entre a data da contagem anterior e a data da contagem do mês − contagem do mês. Negativo = provável erro de contagem ou recebimento não registrado.',
      '- Recebido no mês = recebimentos registrados no mês do calendário (pode incluir entregas feitas depois da contagem, que entram no consumo do mês seguinte).',
      '- Pedido: registrado a partir da contagem; situação emitido → recebido parcial → recebido (ou cancelado). Prazo = dias entre emissão e registro do recebimento. % atendido = recebido ÷ pedido.',
    ];
  }

  async function exportXlsx() {
    const rep = st.report; if (!rep) return;
    feedback('Gerando Excel…', true);
    try { if (!window.XLSX) await loadScript(XLSX_URL); } catch (e) { feedback('Não foi possível carregar o gerador de Excel.', true); return; }
    const X = window.XLSX;
    const wb = X.utils.book_new();
    const readme = X.utils.aoa_to_sheet([['Relatório de estoque — Facilities Wap']].concat(definitionsLines(rep.meta).map(function (l) { return [l]; })));
    readme['!cols'] = [{ wch: 140 }];
    X.utils.book_append_sheet(wb, readme, 'Leia-me');
    const sheets = [['kpi', 'Indicadores'], ['trend', 'Evolução indicadores'], ['critical', 'Críticos'], ['diverge', 'Consumo x cadastrado'],
      ['uncounted', 'Sem contagem'], ['closing', 'Fechamento'], ['evolution', 'Evolução contagens'], ['consumption', 'Consumo real'],
      ['orders', 'Pedidos'], ['orderItems', 'Pedidos - itens'], ['units', 'Unidades'], ['activity', 'Movimentações']];
    sheets.forEach(function (s) {
      const t = rep.tables[s[0]];
      const aoa = [t.cols.map(function (c) { return c[0]; })].concat(t.rows.map(function (row) {
        return row.map(function (v, j) { return v == null ? null : (t.cols[j][1] === 'n' ? round(v, t.cols[j][2] == null ? 2 : Math.max(t.cols[j][2], 1)) : v); });
      }));
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = t.cols.map(function (c) { return { wch: c[1] === 'w' ? 40 : Math.max(10, Math.min(28, c[0].length + 2)) }; });
      X.utils.book_append_sheet(wb, ws, s[1]);
    });
    X.writeFile(wb, 'relatorio-estoque-' + fileStamp() + '.xlsx');
    feedback('Excel baixado.');
  }

  // ---------- pacote para IA ----------

  function mdCell(v, col) {
    if (v == null || v === '') return '';
    const s = col && col[1] === 'n' ? fmtBR(v, col[2]) : String(v);
    return s.replace(/\|/g, '/').replace(/\n/g, ' ');
  }
  function mdTable(t) {
    if (!t.rows.length) return '_Sem dados._';
    return '| ' + t.cols.map(function (c) { return c[0]; }).join(' | ') + ' |\n|' + t.cols.map(function (c) { return c[1] === 'n' ? ' ---: ' : ' --- '; }).join('|') + '|\n' +
      t.rows.map(function (row) { return '| ' + row.map(function (v, j) { return mdCell(v, t.cols[j]); }).join(' | ') + ' |'; }).join('\n');
  }
  function csvSection(t) {
    if (!t.rows.length) return '_Sem dados._';
    return '```csv\n' + tableCsv(t).replace(/\r\n/g, '\n') + '\n```';
  }

  function openAi() {
    if (!st.report) return;
    $('aiOverlay').hidden = false;
    buildAiText();
  }

  function buildAiText() {
    const rep = st.report; if (!rep) return;
    const T = rep.tables, m = rep.meta;
    const focus = $('aiFocus').value.trim();
    const out = [];
    out.push('# Relatório de estoque — Facilities Wap');
    out.push('');
    out.push('## Sua tarefa');
    out.push('Você é um analista de suprimentos e facilities. Analise os dados de estoque abaixo e escreva, em português do Brasil, uma análise clara e prática para o responsável pelo estoque. Use apenas os dados fornecidos; quando algo não puder ser concluído, diga qual dado falta.');
    if (focus) { out.push(''); out.push('**Foco pedido:** ' + focus); }
    out.push('');
    out.push('Estruture a resposta assim:');
    out.push('1. **Situação geral** no mês final (' + App.monthLabel(m.finalMonth) + '): principais números e o que eles significam.');
    out.push('2. **Prioridades de compra**: itens mais urgentes, com a quantidade sugerida e o porquê.');
    out.push('3. **Tendência no período**: o estoque melhorou, piorou ou ficou estável? Em quais categorias ou itens?');
    out.push('4. **Parâmetros a ajustar**: itens cujo consumo real difere muito do consumo cadastrado — proponha novos valores de consumo médio e estoque de segurança.');
    out.push('5. **Pedidos e fornecimento**: prazos, atendimento parcial, itens que faltaram com frequência.');
    out.push('6. **Qualidade dos dados**: itens sem contagem, consumos negativos, inconsistências que precisam ser verificadas.');
    if (m.multiUnit) out.push('7. **Comparação entre unidades**: quais estão melhor ou pior e possíveis causas.');
    out.push((m.multiUnit ? '8' : '7') + '. **Plano de ação** para o próximo mês, em ordem de prioridade.');
    out.push('');
    out.push('## Escopo e definições');
    definitionsLines(m).forEach(function (l) { out.push(l.indexOf('- ') === 0 || !l ? l : '- ' + l); });
    out.push('- Nos blocos CSV o separador é ";" e o decimal é ",".');
    out.push('');
    out.push('## ' + T.kpi.title); out.push(mdTable(T.kpi)); out.push('');
    out.push('## ' + T.trend.title); out.push(mdTable(T.trend)); out.push('');
    if (m.multiUnit) { out.push('## ' + T.units.title); out.push(mdTable(T.units)); out.push(''); }
    out.push('## ' + T.closing.title); out.push(csvSection(T.closing)); out.push('');
    if ($('aiIncEvolution').checked) { out.push('## Evolução das contagens — ' + T.evolution.title); out.push(csvSection(T.evolution)); out.push(''); }
    if ($('aiIncConsumo').checked) {
      out.push('## ' + T.consumption.title); out.push(T.consumption.note); out.push(csvSection(T.consumption)); out.push('');
    }
    if ($('aiIncPedidos').checked) {
      out.push('## ' + T.orders.title); out.push(T.orders.note); out.push(csvSection(T.orders)); out.push('');
      out.push('## ' + T.orderItems.title); out.push(csvSection(T.orderItems)); out.push('');
    }
    if ($('aiIncMov').checked) { out.push('## ' + T.activity.title); out.push(csvSection(T.activity)); out.push(''); }
    const text = out.join('\n');
    $('aiText').value = text;
    const kb = Math.round(new Blob([text]).size / 1024);
    $('aiSize').textContent = text.length.toLocaleString('pt-BR') + ' caracteres (~' + kb + ' KB)' + (kb > 400 ? ' · grande: prefira baixar o .md e anexar' : '');
  }

  function copyAi() {
    const t = $('aiText').value;
    const fb = $('aiFeedback');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { fb.textContent = 'Copiado! Cole numa conversa com o Claude.'; setTimeout(function () { fb.textContent = ''; }, 4000); })
        .catch(function () { $('aiText').select(); fb.textContent = 'Selecionei o texto: use Ctrl+C.'; });
    } else { $('aiText').select(); fb.textContent = 'Selecionei o texto: use Ctrl+C.'; }
  }

  window.EstoquePages = window.EstoquePages || {};
  window.EstoquePages.relatorios = open;
})();
