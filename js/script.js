const $ = s => document.querySelector(s);
const num = v => parseFloat(String(v).trim().replace(/\./g, m => (String(v).includes(",") ? "" : m)).replace(",", "."));

// APIs sem chave: AwesomeAPI (cotações em R$ e criptos) e Frankfurter (câmbio do Banco Central Europeu).
const AWESOME = "https://economia.awesomeapi.com.br/json/";
const FRANKFURTER = ["https://api.frankfurter.dev/v1/latest?base=BRL", "https://api.frankfurter.app/latest?from=BRL"];

const FIAT_CARDS = { USD: "Dólar americano", EUR: "Euro", GBP: "Libra esterlina", ARS: "Peso argentino" };
const CRYPTO = { BTC: "Bitcoin", ETH: "Ethereum", LTC: "Litecoin", XRP: "XRP", DOGE: "Dogecoin" };

const brl = { BRL: 1 };   // quantos reais vale 1 unidade de cada moeda
const quotes = {};        // { USD: { bid, pct } }
let updated = null;
const dn = (() => { try { return new Intl.DisplayNames(["pt-BR"], { type: "currency" }); } catch { return null; } })();
const nome = c => CRYPTO[c] || (dn && dn.of(c)) || c;

/* ---------- formatação ---------- */
function money(code, v) {
  if (CRYPTO[code]) return v.toLocaleString("pt-BR", { maximumFractionDigits: 8 }) + " " + code;
  try { return v.toLocaleString("pt-BR", { style: "currency", currency: code }); }
  catch { return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + " " + code; }
}
const plain = v => v.toLocaleString("pt-BR", { maximumFractionDigits: v < 1 ? 8 : 4 });

/* ---------- dados ---------- */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function getFx() {
  for (const u of FRANKFURTER) {
    try {
      const d = await getJSON(u);
      Object.entries(d.rates).forEach(([k, v]) => (brl[k] = 1 / v));
      return;
    } catch {}
  }
  throw new Error("fx");
}

async function getAwesome(map) {
  const d = await getJSON(AWESOME + "last/" + Object.keys(map).map(c => c + "-BRL").join(","));
  Object.keys(map).forEach(c => {
    const q = d[c + "BRL"];
    if (!q) return;
    brl[c] = +q.bid;
    quotes[c] = { bid: +q.bid, pct: +q.pctChange };
    updated = Math.max(updated || 0, +q.timestamp * 1000);
  });
}

async function loadRates() {
  const r = await Promise.allSettled([getFx(), getAwesome(FIAT_CARDS), getAwesome(CRYPTO)]);
  if (r.every(x => x.status === "rejected")) {
    try { Object.assign(brl, JSON.parse(localStorage.getItem("fx-cache"))); $("#lastUpdate").textContent = "Sem conexão: usando as últimas cotações salvas."; }
    catch { $("#result").textContent = "Não foi possível carregar as cotações. Verifique sua conexão."; return; }
  } else {
    try { localStorage.setItem("fx-cache", JSON.stringify(brl)); } catch {}
    if (updated) $("#lastUpdate").textContent = "Atualizado em " + new Date(updated).toLocaleString("pt-BR");
  }
  fillSelects();
  renderQuotes();
  convert();
}

/* ---------- conversor ---------- */
function fillSelects() {
  const from = $("#fromCurrency"), to = $("#toCurrency");
  if (from.options.length) return;
  const fiat = Object.keys(brl).filter(c => !CRYPTO[c]).sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR"));
  const html = `<optgroup label="Moedas">${fiat.map(c => `<option value="${c}">${c} · ${nome(c)}</option>`).join("")}</optgroup>
    <optgroup label="Criptomoedas">${Object.keys(CRYPTO).filter(c => brl[c]).map(c => `<option value="${c}">${c} · ${CRYPTO[c]}</option>`).join("")}</optgroup>`;
  from.innerHTML = to.innerHTML = html;
  let s = {};
  try { s = JSON.parse(localStorage.getItem("fx-last")) || {}; } catch {}
  from.value = brl[s.from] ? s.from : "USD";
  to.value = brl[s.to] ? s.to : "BRL";
  if (s.amount) $("#amount").value = s.amount;
}

function convert() {
  const f = $("#fromCurrency").value, t = $("#toCurrency").value, raw = $("#amount").value;
  if (!f || !brl[f] || !brl[t]) return;
  const a = num(raw);
  try { localStorage.setItem("fx-last", JSON.stringify({ from: f, to: t, amount: raw })); } catch {}
  if (!(a >= 0)) { $("#result").textContent = "Digite um valor válido"; $("#rateLine").textContent = ""; return; }
  $("#result").textContent = `${money(f, a)} = ${money(t, (a * brl[f]) / brl[t])}`;
  $("#rateLine").textContent = `1 ${f} = ${plain(brl[f] / brl[t])} ${t}`;
}

["amount", "fromCurrency", "toCurrency"].forEach(id => $("#" + id).addEventListener("input", convert));
$("#swap").onclick = () => {
  const f = $("#fromCurrency"), t = $("#toCurrency");
  [f.value, t.value] = [t.value, f.value];
  convert();
};

/* ---------- cards de cotação ---------- */
function card(c, nm) {
  const q = quotes[c];
  if (!q) return "";
  const cls = q.pct >= 0 ? "up" : "down";
  return `<button class="q" data-c="${c}"><span>${nm} (${c})</span><strong>${money("BRL", q.bid)}</strong>
    <em class="${cls}">${q.pct >= 0 ? "▲" : "▼"} ${Math.abs(q.pct).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%</em></button>`;
}
function renderQuotes() {
  $("#fiat").innerHTML = Object.entries(FIAT_CARDS).map(([c, n]) => card(c, n)).join("") || '<p class="mute">Cotações indisponíveis no momento.</p>';
  $("#crypto").innerHTML = Object.entries(CRYPTO).map(([c, n]) => card(c, n)).join("") || '<p class="mute">Cotações indisponíveis no momento.</p>';
}
document.addEventListener("click", e => {
  const q = e.target.closest(".q");
  if (!q) return;
  $("#fromCurrency").value = q.dataset.c;
  $("#toCurrency").value = "BRL";
  convert();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- gráfico do dólar (30 dias) ---------- */
async function loadChart() {
  try {
    const d = (await getJSON(AWESOME + "daily/USD-BRL/30")).reverse();
    const v = d.map(x => +x.bid), lo = Math.min(...v), hi = Math.max(...v), W = 300, H = 100;
    const pts = v.map((y, i) => `${(i / (v.length - 1)) * W},${H - 8 - ((y - lo) / (hi - lo || 1)) * (H - 16)}`);
    const ch = ((v.at(-1) / v[0] - 1) * 100);
    const fmt = x => new Date(x.timestamp * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cotação do dólar nos últimos 30 dias">
      <polygon points="0,${H} ${pts.join(" ")} ${W},${H}" fill="var(--brand)" opacity=".12"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="var(--brand)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="lbl"><span>${fmt(d[0])}</span><span>mín ${money("BRL", lo)} · máx ${money("BRL", hi)}</span><span>${fmt(d.at(-1))}</span></div>`;
    $("#chartInfo").innerHTML = `<b class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</b>`;
  } catch { $("#chart").innerHTML = '<p class="mute">Gráfico indisponível no momento.</p>'; }
}

/* ---------- artigos ---------- */
const ARTIGOS = [
  { t: "Reserva de emergência: por onde começar", m: 3,
    r: "O colchão financeiro que evita dívidas quando a vida muda de planos.",
    h: `<p>Reserva de emergência é um dinheiro separado para imprevistos: perda de renda, problema de saúde, conserto urgente.</p>
    <ul><li><b>Quanto:</b> a regra mais comum é de 3 a 6 meses do seu custo de vida. Autônomos e quem tem renda variável costumam mirar mais.</li>
    <li><b>Onde:</b> priorize segurança e liquidez (poder sacar rápido), não rentabilidade. Opções comuns são Tesouro Selic e CDBs com liquidez diária.</li>
    <li><b>Como começar:</b> defina um valor mensal, automatize a transferência no dia do pagamento e comece pequeno.</li></ul>
    <p>Sem reserva, qualquer imprevisto vira cartão de crédito ou empréstimo, que costumam ter juros altos.</p>` },
  { t: "Como funciona o câmbio e por que a cotação muda", m: 3,
    r: "Oferta, demanda e juros: entenda o que move o dólar.",
    h: `<p>A cotação é o preço de uma moeda em outra, definido pela oferta e pela demanda no mercado.</p>
    <ul><li><b>Juros:</b> juros mais altos no país tendem a atrair investidores estrangeiros e fortalecer a moeda local.</li>
    <li><b>Economia e política:</b> expectativa de crescimento, inflação e contas públicas influenciam a confiança.</li>
    <li><b>Cenário externo:</b> decisões de grandes bancos centrais e preços de commodities também pesam.</li></ul>
    <p>Por isso o câmbio sobe e desce todos os dias. Evite decisões por impulso: para gastos futuros em moeda estrangeira, comprar aos poucos reduz o risco de pagar no pior momento.</p>` },
  { t: "Viajando ao exterior: dicas de câmbio", m: 4,
    r: "Cartão, dinheiro em espécie ou conta global? Compare antes de embarcar.",
    h: `<ul><li><b>Compare o valor final:</b> além da cotação, existe o <i>spread</i> (diferença entre compra e venda) e a incidência de IOF, cuja alíquota é definida por decreto. Confira o valor vigente.</li>
    <li><b>Combine meios de pagamento:</b> uma parte em espécie para pequenas despesas e cartão ou conta global para o resto.</li>
    <li><b>Pague na moeda local:</b> ao usar o cartão fora do país, escolha ser cobrado na moeda local, não em reais. A conversão do estabelecimento costuma sair mais cara.</li>
    <li><b>Evite casas de câmbio de aeroporto</b> quando possível; as taxas costumam ser piores.</li>
    <li><b>Leve um plano B:</b> um segundo cartão guardado em local separado.</li></ul>` },
  { t: "Orçamento 50/30/20 na prática", m: 3,
    r: "Um método simples para organizar o salário sem planilhas complicadas.",
    h: `<p>A ideia é dividir a renda líquida em três grupos:</p>
    <ul><li><b>50% necessidades:</b> moradia, contas, mercado, transporte, saúde.</li>
    <li><b>30% desejos:</b> lazer, delivery, assinaturas, compras não essenciais.</li>
    <li><b>20% futuro:</b> reserva de emergência, investimentos e quitação de dívidas.</li></ul>
    <p>As proporções são um ponto de partida. Se seu custo fixo é maior, ajuste: o importante é gastar menos do que ganha e direcionar uma parte para o futuro. Anote os gastos por 30 dias para descobrir para onde o dinheiro realmente vai.</p>` },
  { t: "Criptomoedas: oportunidade ou risco?", m: 4,
    r: "Volatilidade alta exige estudo, limite de valor e cabeça fria.",
    h: `<p>Criptomoedas, como Bitcoin e Ethereum, têm preço muito volátil: podem subir ou cair dezenas de por cento em pouco tempo.</p>
    <ul><li><b>Invista só o que pode perder</b> sem comprometer contas e a sua reserva de emergência.</li>
    <li><b>Entenda o que está comprando:</b> desconfie de promessas de retorno garantido, que são sinal clássico de golpe.</li>
    <li><b>Use corretoras confiáveis</b> e proteja suas contas com autenticação em dois fatores.</li>
    <li><b>Diversifique:</b> não concentre todo o patrimônio em um único ativo.</li></ul>
    <p>Ganhos com criptoativos podem ter regras de declaração e de imposto de renda. Consulte a Receita Federal ou um contador.</p>` },
  { t: "Inflação: por que seu dinheiro rende menos", m: 3,
    r: "Como o aumento de preços corrói o poder de compra e como se proteger.",
    h: `<p>Inflação é o aumento geral dos preços. Se ela é de 5% ao ano e seu dinheiro rende 3%, você perde poder de compra mesmo vendo o saldo crescer.</p>
    <ul><li><b>Compare o ganho real:</b> o que importa é o rendimento acima da inflação.</li>
    <li><b>Conheça opções atreladas à inflação,</b> como títulos do Tesouro IPCA+, para objetivos de longo prazo.</li>
    <li><b>Evite deixar dinheiro parado</b> por longos períodos em contas sem rendimento.</li>
    <li><b>Reveja contratos e assinaturas</b> todo ano para cortar o que não usa.</li></ul>` },
];

$("#articles").innerHTML = ARTIGOS.map((a, i) => `<div class="art"><h3>${a.t}</h3><p>${a.r}</p>
  <button data-i="${i}">Ler artigo (${a.m} min)</button></div>`).join("");

const dlg = $("#artigo");
$("#articles").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  const a = ARTIGOS[b.dataset.i];
  $("#artigoConteudo").innerHTML = `<h2>${a.t}</h2><p class="meta">Leitura de ${a.m} min</p>${a.h}
    <p class="nota">Conteúdo educativo, sem caráter de recomendação de investimento. Para decisões financeiras, consulte um profissional habilitado.</p>`;
  dlg.showModal();
};
$("#fechar").onclick = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

/* ---------- tema ---------- */
function tema(t, persist) {
  document.documentElement.dataset.theme = t;
  $("#toggleMode").textContent = t === "dark" ? "☀️" : "🌙";
  if (persist) try { localStorage.setItem("fx-theme", t); } catch {}
}
tema(document.documentElement.dataset.theme || "light");
$("#toggleMode").onclick = () => tema(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);

loadRates();
loadChart();
setInterval(loadRates, 60000);
