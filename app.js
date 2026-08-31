/* =========================================================
   LEDGER — app.js
   Plain JS, no build step, no external runtime deps.
   Everything persists to localStorage under STORAGE_KEY.
   ========================================================= */

const STORAGE_KEY = 'ledger_data_v1';

const EXPENSE_CATEGORIES = [
  'Food & Dining','Fuel & Transport','Groceries','Bills & Utilities','Rent',
  'Shopping','Entertainment','Health & Medical','Travel','Education',
  'Personal Care','EMI & Loan','Shared Expense','Gifts & Donations','Others'
];

const DEFAULT_INCOME_SOURCES = ['Salary','Dividend','Rapido / Cab','Freelance','Interest','Rental','Others'];

function defaultState(){
  return {
    accounts: [],          // {id,name,type:'bank'|'cash',bankName,balance}
    creditCards: [],       // {id,name,bankName,limit,currentDue,billDate,dueDate}
    incomeSources: [...DEFAULT_INCOME_SOURCES],
    transactions: [],      // {id,type:'income'|'expense',amount,category,description,date,accountRef,sourceOrNote}
    loans: [],             // {id,name,principal,emiAmount,emiDay,tenureMonths,remainingMonths,rate}
    investments: {
      stocks: [],          // {id,name,ticker,qty,buyPrice,currentPrice}
      mf: [],              // {id,name,invested,current,sipAmount,sipDay}
      fd: [],              // {id,bankName,principal,rate,startDate,maturityDate}
      bonds: [],           // {id,name,invested,rate,maturityDate}
      pf: { balance:0, monthly:0, uan:'' },
      pan: ''
    },
    splitGroups: [],       // {id,title,total,paidFrom,date,people:[{id,name,phone,share,paid}]}
    budgets: {},           // {category: monthlyLimit}
    recurring: [],         // {id,type,amount,category,description,ref,day,lastRunMonth}
    netWorthHistory: []    // [{date, value}]
  };
}

const CATEGORY_ICONS = {
  'Food & Dining':'🍽️','Fuel & Transport':'⛽','Groceries':'🛒','Bills & Utilities':'💡',
  'Rent':'🏠','Shopping':'🛍️','Entertainment':'🎬','Health & Medical':'⚕️','Travel':'✈️',
  'Education':'🎓','Personal Care':'🧴','EMI & Loan':'🏦','Shared Expense':'🤝',
  'Gifts & Donations':'🎁','Others':'•',
  'Salary':'💼','Dividend':'📈','Rapido / Cab':'🚕','Freelance':'🧑‍💻','Interest':'🏦',
  'Rental':'🏠','Split Settlement':'🤝'
};
function categoryIcon(cat){ return CATEGORY_ICONS[cat] || '•'; }

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const d = defaultState();
    // shallow-merge to survive schema growth across versions
    return {
      ...d, ...parsed,
      investments: { ...d.investments, ...(parsed.investments||{}) },
      budgets: { ...(parsed.budgets||{}) },
      recurring: parsed.recurring || [],
      netWorthHistory: parsed.netWorthHistory || []
    };
  }catch(e){
    console.error('Failed to load state, starting fresh', e);
    return defaultState();
  }
}

function saveState(){
  recordNetWorthSnapshot();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function recordNetWorthSnapshot(){
  const today = todayISO();
  const value = netWorth();
  const hist = state.netWorthHistory;
  const last = hist[hist.length-1];
  if(last && last.date===today){ last.value = value; }
  else{ hist.push({date: today, value}); }
  if(hist.length>400) hist.shift();
}

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayISO(){ return new Date().toISOString().slice(0,10); }

function formatCurrency(n){
  n = Number(n)||0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-IN', {maximumFractionDigits:0});
  return (neg?'−':'') + '₹' + s;
}
function formatDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}
function formatDateShort(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short'});
}
function monthKey(iso){ return iso.slice(0,7); } // YYYY-MM
function monthLabel(key){
  const [y,m] = key.split('-');
  const d = new Date(Number(y), Number(m)-1, 1);
  return d.toLocaleDateString('en-IN', {month:'long', year:'numeric'});
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ---------------- ACCOUNT / CARD HELPERS ---------------- */
function getAccount(id){ return state.accounts.find(a=>a.id===id); }
function getCard(id){ return state.creditCards.find(c=>c.id===id); }

function payerLabel(ref){
  // ref like {kind:'account'|'card', id}
  if(!ref) return '—';
  if(ref.kind==='account'){ const a = getAccount(ref.id); return a? a.name : 'Deleted account'; }
  if(ref.kind==='card'){ const c = getCard(ref.id); return c? c.name + ' card' : 'Deleted card'; }
  return '—';
}

function applyExpensePayment(ref, amount){
  if(ref.kind==='account'){
    const a = getAccount(ref.id);
    if(a) a.balance -= amount;
  } else if(ref.kind==='card'){
    const c = getCard(ref.id);
    if(c) c.currentDue += amount;
  }
}
function reverseExpensePayment(ref, amount){
  if(ref.kind==='account'){
    const a = getAccount(ref.id);
    if(a) a.balance += amount;
  } else if(ref.kind==='card'){
    const c = getCard(ref.id);
    if(c) c.currentDue -= amount;
  }
}

function deleteTransaction(id){
  const t = state.transactions.find(x=>x.id===id);
  if(!t) return;
  if(!confirm('Delete this transaction? This will also undo its effect on your balance.')) return;

  if(t.type==='expense'){ reverseExpensePayment(t.ref, t.amount); }
  else if(t.type==='income'){ const a = getAccount(t.ref.id); if(a) a.balance -= t.amount; }

  if(t.meta){
    if(t.meta.loanId){
      const l = state.loans.find(x=>x.id===t.meta.loanId);
      if(l) l.remainingMonths = Math.min(l.tenureMonths, l.remainingMonths+1);
    }
    if(t.meta.cardId){
      const c = getCard(t.meta.cardId);
      if(c) c.currentDue += t.amount;
    }
    if(t.meta.recurringId){
      const r = state.recurring.find(x=>x.id===t.meta.recurringId);
      if(r && r.lastRunMonth===monthKey(t.date)) r.lastRunMonth = '';
    }
    if(t.meta.splitGroupId){
      const g = state.splitGroups.find(x=>x.id===t.meta.splitGroupId);
      if(g){
        if(t.meta.role==='create'){ state.splitGroups = state.splitGroups.filter(x=>x.id!==g.id); }
        else if(t.meta.role==='settle'){ const p = g.people.find(p=>p.id===t.meta.personId); if(p) p.paid = false; }
      }
    }
  }

  state.transactions = state.transactions.filter(x=>x.id!==id);
  saveState();
  toast('Transaction deleted');
}

function bindTxnDelete(container, rerender){
  bindOnce(container, 'click', (e)=>{
    const del = e.target.closest('[data-del-txn]');
    if(del){ deleteTransaction(del.dataset.delTxn); rerender(); }
  });
}

/* ---------------- INVESTMENT VALUATION ---------------- */
function fdValue(fd){
  const start = new Date(fd.startDate);
  const mat = new Date(fd.maturityDate);
  const now = new Date();
  const totalDays = Math.max(1, (mat-start)/86400000);
  const years = totalDays/365;
  const maturityAmount = fd.principal * Math.pow(1 + (fd.rate/100), years);
  const elapsed = Math.min(totalDays, Math.max(0, (now-start)/86400000));
  const currentValue = fd.principal + (maturityAmount - fd.principal) * (elapsed/totalDays);
  const daysLeft = Math.max(0, Math.ceil((mat-now)/86400000));
  return { maturityAmount, currentValue, daysLeft };
}

function totalInvestedValue(){
  const inv = state.investments;
  let total = 0;
  inv.stocks.forEach(s=> total += s.qty * s.currentPrice);
  inv.mf.forEach(m=> total += Number(m.current)||0);
  inv.fd.forEach(f=> total += fdValue(f).currentValue);
  inv.bonds.forEach(b=> total += Number(b.invested)||0);
  total += Number(inv.pf.balance)||0;
  return total;
}

function totalLoanOutstanding(){
  return state.loans.reduce((sum,l)=> sum + (l.emiAmount * l.remainingMonths), 0);
}

function netWorth(){
  const bank = state.accounts.reduce((s,a)=>s+a.balance,0);
  const cardDue = state.creditCards.reduce((s,c)=>s+c.currentDue,0);
  return bank + totalInvestedValue() - cardDue - totalLoanOutstanding();
}

function splitPendingTotal(){
  let total = 0;
  state.splitGroups.forEach(g=> g.people.forEach(p=>{ if(!p.paid) total += p.share; }));
  return total;
}

/* ---------------- ROUTER ---------------- */
const pages = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('.nav-btn');
const topbarTitle = document.getElementById('topbarTitle');
const PAGE_TITLES = {
  dashboard:'Ledger', expense:'Spend', income:'Income', analytics:'Analytics',
  more:'More', accounts:'Accounts & cards', loans:'Loans & EMIs',
  investments:'Investments & PF', split:'Split with friends', budgets:'Budgets',
  recurring:'Recurring', settings:'Settings'
};

function goTo(pageName){
  pages.forEach(p=> p.classList.toggle('active', p.dataset.page===pageName));
  navBtns.forEach(b=> b.classList.toggle('active', b.dataset.nav===pageName));
  topbarTitle.textContent = PAGE_TITLES[pageName] || 'Ledger';
  renderPage(pageName);
  document.getElementById('pages').scrollTop = 0;
  window.scrollTo(0,0);
}

document.addEventListener('click', (e)=>{
  const navEl = e.target.closest('[data-nav]');
  if(navEl){ goTo(navEl.dataset.nav); }
});

function renderPage(name){
  switch(name){
    case 'dashboard': renderDashboard(); break;
    case 'expense': renderExpensePage(); break;
    case 'income': renderIncomePage(); break;
    case 'analytics': renderAnalytics(); break;
    case 'accounts': renderAccountsPage(); break;
    case 'loans': renderLoansPage(); break;
    case 'investments': renderInvestmentsPage(); break;
    case 'split': renderSplitPage(); break;
    case 'budgets': renderBudgetsPage(); break;
    case 'recurring': renderRecurringPage(); break;
  }
}

/* ---------------- MODAL SYSTEM ---------------- */
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

function openModal(title, html, onMount){
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalBackdrop.classList.add('open');
  if(onMount) onMount(modalBody);
}
function closeModal(){
  modalBackdrop.classList.remove('open');
  modalBody.innerHTML = '';
}
document.getElementById('modalClose').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e)=>{ if(e.target===modalBackdrop) closeModal(); });

function accountCardOptions(includeCards){
  let opts = state.accounts.map(a=>`<option value="account:${a.id}">${a.name} (${formatCurrency(a.balance)})</option>`).join('');
  if(includeCards){
    opts += state.creditCards.map(c=>`<option value="card:${c.id}">${c.name} card — due ${formatCurrency(c.currentDue)}</option>`).join('');
  }
  return opts;
}
function accountOptionsOnly(){
  return state.accounts.map(a=>`<option value="${a.id}">${a.name} (${formatCurrency(a.balance)})</option>`).join('');
}

/* ================= DASHBOARD ================= */
function renderDashboard(){
  document.getElementById('netWorth').textContent = formatCurrency(netWorth());
  document.getElementById('totalBalance').textContent = formatCurrency(state.accounts.reduce((s,a)=>s+a.balance,0));
  document.getElementById('totalCardDue').textContent = formatCurrency(state.creditCards.reduce((s,c)=>s+c.currentDue,0));
  document.getElementById('totalInvested').textContent = formatCurrency(totalInvestedValue());

  const thisMonth = monthKey(todayISO());
  const monthTxns = state.transactions.filter(t=>monthKey(t.date)===thisMonth);
  document.getElementById('monthIncome').textContent = formatCurrency(monthTxns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0));
  document.getElementById('monthExpense').textContent = formatCurrency(monthTxns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0));

  renderAccountsGlance();

  // alerts: upcoming EMIs within 5 days + split pending
  const alerts = [];
  const today = new Date();
  state.loans.forEach(l=>{
    const next = nextEmiDate(l);
    const diffDays = Math.ceil((next-today)/86400000);
    if(diffDays>=0 && diffDays<=5){
      alerts.push(`<b>${l.name}</b> EMI of ${formatCurrency(l.emiAmount)} is due ${diffDays===0?'today':'in '+diffDays+' day'+(diffDays>1?'s':'')} (${formatDateShort(next.toISOString().slice(0,10))})`);
    }
  });
  const pending = splitPendingTotal();
  if(pending>0){ alerts.push(`You're owed <b>${formatCurrency(pending)}</b> from friends across your split groups`); }

  const spentByCat = categorySpendThisMonth();
  Object.entries(state.budgets).forEach(([cat,limit])=>{
    if(!limit) return;
    const spent = spentByCat[cat]||0;
    const pct = spent/limit;
    if(pct>=1) alerts.push(`You've gone <b>${formatCurrency(spent-limit)} over</b> your ${escapeHtml(cat)} budget this month`);
    else if(pct>=0.9) alerts.push(`You're at <b>${Math.round(pct*100)}%</b> of your ${escapeHtml(cat)} budget this month`);
  });
  const alertsBlock = document.getElementById('alertsBlock');
  alertsBlock.innerHTML = alerts.map(a=>`<div class="alert-card">${a}</div>`).join('');

  // recent activity
  const recent = [...state.transactions].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0,6);
  const list = document.getElementById('recentTxns');
  list.innerHTML = recent.length ? recent.map(txnRow).join('') : emptyNote('No activity yet — add an expense or income to get started.');
  bindTxnDelete(list, renderDashboard);
}

function renderAccountsGlance(){
  const el = document.getElementById('accountsGlance');
  const rows = [];
  state.accounts.forEach(a=> rows.push(`
    <div class="people-row">
      <div class="people-name">${escapeHtml(a.name)}<small>${escapeHtml(a.bankName || (a.type==='cash'?'Cash':''))}</small></div>
      <span class="lr-amount credit" style="font-size:14px;">${formatCurrency(a.balance)}</span>
    </div>`));
  state.creditCards.forEach(c=> rows.push(`
    <div class="people-row">
      <div class="people-name">${escapeHtml(c.name)} card<small>${escapeHtml(c.bankName || '')}</small></div>
      <span class="lr-amount debit" style="font-size:14px;">${formatCurrency(c.currentDue)} due</span>
    </div>`));
  el.innerHTML = rows.length ? `<div class="item-card">${rows.join('')}</div>` : emptyNote('Add an account or card, under More → Accounts & cards, to see balances here.');
}

function nextEmiDate(loan){
  const today = new Date();
  let d = new Date(today.getFullYear(), today.getMonth(), loan.emiDay);
  if(d < today) d = new Date(today.getFullYear(), today.getMonth()+1, loan.emiDay);
  return d;
}

function txnRow(t){
  const sign = t.type==='income' ? 'credit' : 'debit';
  const symbol = t.type==='income' ? '+' : '−';
  return `
    <div class="ledger-row">
      <div class="lr-mid">
        <div class="lr-icon">${categoryIcon(t.category)}</div>
        <div class="lr-left">
          <div class="lr-title">${escapeHtml(t.category)} · ${escapeHtml(t.sourceOrNote || '')}</div>
          ${t.description ? `<div class="lr-sub">${escapeHtml(t.description)}</div>` : ''}
        </div>
      </div>
      <div class="lr-right">
        <div class="lr-amount ${sign}">${symbol}${formatCurrency(t.amount)}</div>
        <div class="lr-date">${formatDateShort(t.date)}</div>
      </div>
      <button class="lr-del" data-del-txn="${t.id}" title="Delete">✕</button>
    </div>`;
}
function emptyNote(msg){ return `<div class="empty-note">${msg}</div>`; }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ================= EXPENSE PAGE ================= */
function monthOptionsHtml(selected){
  const keys = Array.from(new Set(state.transactions.map(t=>monthKey(t.date))));
  if(!keys.includes(monthKey(todayISO()))) keys.push(monthKey(todayISO()));
  keys.sort().reverse();
  return keys.map(k=>`<option value="${k}" ${k===selected?'selected':''}>${monthLabel(k)}</option>`).join('');
}

function renderExpensePage(){
  const sel = document.getElementById('expenseMonthFilter');
  const current = sel.value || monthKey(todayISO());
  sel.innerHTML = monthOptionsHtml(current);
  sel.onchange = renderExpenseList;
  renderExpenseList();
}
function renderExpenseList(){
  const sel = document.getElementById('expenseMonthFilter');
  const mk = sel.value;
  const items = state.transactions.filter(t=>t.type==='expense' && monthKey(t.date)===mk)
    .sort((a,b)=> b.date.localeCompare(a.date));
  const total = items.reduce((s,t)=>s+t.amount,0);
  document.getElementById('expenseList').innerHTML =
    `<div class="ledger-row" style="border-bottom:2px solid var(--rule);"><div class="lr-left"><div class="lr-title">Total this month</div></div><div class="lr-right"><div class="lr-amount debit">${formatCurrency(total)}</div></div></div>` +
    (items.length ? items.map(t=>expenseRow(t)).join('') : emptyNote('Nothing logged this month.'));
  bindTxnDelete(document.getElementById('expenseList'), renderExpenseList);
}
function expenseRow(t){
  return `
    <div class="ledger-row">
      <div class="lr-mid">
        <div class="lr-icon">${categoryIcon(t.category)}</div>
        <div class="lr-left">
          <div class="lr-title">${escapeHtml(t.category)} · ${escapeHtml(payerLabel(t.ref))}</div>
          ${t.description ? `<div class="lr-sub">${escapeHtml(t.description)}</div>` : ''}
        </div>
      </div>
      <div class="lr-right">
        <div class="lr-amount debit">−${formatCurrency(t.amount)}</div>
        <div class="lr-date">${formatDateShort(t.date)}</div>
      </div>
      <button class="lr-del" data-del-txn="${t.id}" title="Delete">✕</button>
    </div>`;
}

document.getElementById('openAddExpense').addEventListener('click', openAddExpenseModal);
function openAddExpenseModal(){
  if(state.accounts.length===0 && state.creditCards.length===0){
    toast('Add a bank account or card first, under More → Accounts & cards');
    return;
  }
  const html = `
    <div class="field">
      <label>Amount</label>
      <input type="number" id="fExpAmount" placeholder="0" inputmode="decimal">
    </div>
    <div class="field">
      <label>Category</label>
      <select id="fExpCategory">${EXPENSE_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Description <span style="color:var(--text-faint)">(optional — say what happened)</span></label>
      <textarea id="fExpDesc" placeholder="e.g. Petrol while driving to Pondicherry"></textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Paid via</label>
        <select id="fExpPaidVia">${accountCardOptions(true)}</select>
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="fExpDate" value="${todayISO()}">
      </div>
    </div>

    <label class="checkbox-row"><input type="checkbox" id="fExpSplitToggle"> Split or lend this to friends</label>

    <div class="split-block" id="splitBlock" hidden>
      <div class="split-block-title">Who's involved</div>
      <div class="radio-group">
        <label><input type="radio" name="splitMode" value="split" checked> Split a bill</label>
        <label><input type="radio" name="splitMode" value="lend"> Lend money</label>
      </div>
      <p class="field-hint" id="splitModeHint" style="margin:-6px 0 12px;"></p>
      <div id="peopleRowsExp"></div>
      <button class="link-btn" id="addPersonRowExp" type="button">+ Add a friend</button>
    </div>

    <button class="btn-block" id="fExpSubmit">Add spend</button>
  `;
  openModal('Add spend', html, (body)=>{
    const amountField = body.querySelector('#fExpAmount');
    const splitToggle = body.querySelector('#fExpSplitToggle');
    const splitBlock = body.querySelector('#splitBlock');
    const rows = body.querySelector('#peopleRowsExp');
    const hint = body.querySelector('#splitModeHint');

    function currentMode(){ return body.querySelector('input[name="splitMode"]:checked').value; }

    function addPersonRow(){
      const row = document.createElement('div');
      row.className = 'people-input-row';
      row.innerHTML = `<input type="text" placeholder="Name" class="pName" style="max-width:none;">
        <input type="text" placeholder="Phone" class="pPhone" style="max-width:96px;">
        <input type="number" placeholder="₹" class="pShare" style="max-width:84px;">
        <button type="button" class="removeRow">✕</button>`;
      row.querySelector('.removeRow').addEventListener('click', ()=>{ row.remove(); recalcShares(); });
      row.querySelector('.pShare').addEventListener('input', ()=>{ row.dataset.touched='1'; recalcLendTotal(); });
      rows.appendChild(row);
      recalcShares();
    }

    function friendRows(){ return Array.from(rows.querySelectorAll('.people-input-row')); }

    function recalcShares(){
      const mode = currentMode();
      const list = friendRows();
      if(mode==='split'){
        amountField.readOnly = false;
        hint.textContent = 'The bill amount above is split evenly between you and your friends below (editable per person).';
        const total = Number(amountField.value)||0;
        const each = list.length ? Math.round((total/(list.length+1))*100)/100 : 0;
        list.forEach(r=>{ if(!r.dataset.touched) r.querySelector('.pShare').value = each || ''; });
      } else {
        hint.textContent = 'Enter what each friend owes you — the total below updates automatically and leaves your account.';
        recalcLendTotal();
      }
    }
    function recalcLendTotal(){
      if(currentMode()!=='lend') return;
      const sum = friendRows().reduce((s,r)=> s + (Number(r.querySelector('.pShare').value)||0), 0);
      amountField.value = sum || '';
      amountField.readOnly = true;
    }

    splitToggle.addEventListener('change', ()=>{
      splitBlock.hidden = !splitToggle.checked;
      if(splitToggle.checked && friendRows().length===0) addPersonRow();
      if(!splitToggle.checked) amountField.readOnly = false;
      else recalcShares();
    });
    body.querySelectorAll('input[name="splitMode"]').forEach(r=> r.addEventListener('change', ()=>{
      friendRows().forEach(row=> delete row.dataset.touched);
      recalcShares();
    }));
    amountField.addEventListener('input', ()=>{ if(splitToggle.checked && currentMode()==='split') recalcShares(); });
    body.querySelector('#addPersonRowExp').addEventListener('click', addPersonRow);

    body.querySelector('#fExpSubmit').addEventListener('click', ()=>{
      const category = body.querySelector('#fExpCategory').value;
      const description = body.querySelector('#fExpDesc').value.trim();
      const date = body.querySelector('#fExpDate').value || todayISO();
      const [kind,refId] = body.querySelector('#fExpPaidVia').value.split(':');
      const ref = { kind, id: refId };

      if(splitToggle.checked){
        const mode = currentMode();
        const friends = friendRows().map(r=>({
          name: r.querySelector('.pName').value.trim(),
          phone: r.querySelector('.pPhone').value.trim(),
          share: Number(r.querySelector('.pShare').value)||0
        })).filter(f=>f.name);
        if(friends.length===0){ toast('Add at least one friend'); return; }
        const total = mode==='split' ? Number(amountField.value) : friends.reduce((s,f)=>s+f.share,0);
        if(!total || total<=0){ toast('Enter a valid amount'); return; }

        const groupId = uid();
        const t = {
          id: uid(), type:'expense', amount: total, category, description: description || (mode==='split'?'Shared expense':'Lent to friends'),
          date, ref, sourceOrNote: payerLabel(ref), meta:{ splitGroupId: groupId, role:'create' }
        };
        state.transactions.push(t);
        applyExpensePayment(ref, total);

        state.splitGroups.push({
          id: groupId, title: description || category, total, mode,
          paidFromRef: ref, date,
          people: friends.map(f=>({ id: uid(), name:f.name, phone:f.phone, share:f.share, paid:false }))
        });

        saveState(); closeModal(); toast(mode==='split'?'Split added':'Lending recorded'); goTo('expense');
        return;
      }

      const amount = Number(amountField.value);
      if(!amount || amount<=0){ toast('Enter a valid amount'); return; }
      const t = { id: uid(), type:'expense', amount, category, description, date, ref, sourceOrNote: payerLabel(ref) };
      state.transactions.push(t);
      applyExpensePayment(ref, amount);
      saveState(); closeModal(); toast('Spend added'); goTo('expense');
    });
  });
}

/* ================= INCOME PAGE ================= */
function renderIncomePage(){
  const sel = document.getElementById('incomeMonthFilter');
  const current = sel.value || monthKey(todayISO());
  sel.innerHTML = monthOptionsHtml(current);
  sel.onchange = renderIncomeList;
  renderIncomeList();
}
function renderIncomeList(){
  const sel = document.getElementById('incomeMonthFilter');
  const mk = sel.value;
  const items = state.transactions.filter(t=>t.type==='income' && monthKey(t.date)===mk)
    .sort((a,b)=> b.date.localeCompare(a.date));
  const total = items.reduce((s,t)=>s+t.amount,0);
  document.getElementById('incomeList').innerHTML =
    `<div class="ledger-row" style="border-bottom:2px solid var(--rule);"><div class="lr-left"><div class="lr-title">Total this month</div></div><div class="lr-right"><div class="lr-amount credit">${formatCurrency(total)}</div></div></div>` +
    (items.length ? items.map(incomeRow).join('') : emptyNote('No income logged this month.'));
  bindTxnDelete(document.getElementById('incomeList'), renderIncomeList);
}
function incomeRow(t){
  return `
    <div class="ledger-row">
      <div class="lr-mid">
        <div class="lr-icon">${categoryIcon(t.category)}</div>
        <div class="lr-left">
          <div class="lr-title">${escapeHtml(t.category)} · ${escapeHtml(payerLabel(t.ref))}</div>
          ${t.description ? `<div class="lr-sub">${escapeHtml(t.description)}</div>` : ''}
        </div>
      </div>
      <div class="lr-right">
        <div class="lr-amount credit">+${formatCurrency(t.amount)}</div>
        <div class="lr-date">${formatDateShort(t.date)}</div>
      </div>
      <button class="lr-del" data-del-txn="${t.id}" title="Delete">✕</button>
    </div>`;
}

document.getElementById('openAddIncome').addEventListener('click', openAddIncomeModal);
function openAddIncomeModal(){
  if(state.accounts.length===0){
    toast('Add a bank account first, under More → Accounts & cards');
    return;
  }
  const html = `
    <div class="field">
      <label>Amount</label>
      <input type="number" id="fIncAmount" placeholder="0" inputmode="decimal">
    </div>
    <div class="field">
      <label>Source</label>
      <select id="fIncSource">${state.incomeSources.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
      <button class="link-btn" id="fIncNewSource" type="button">+ Add a new source</button>
    </div>
    <div class="field">
      <label>Note <span style="color:var(--text-faint)">(optional)</span></label>
      <input type="text" id="fIncNote" placeholder="e.g. August salary">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Credit to</label>
        <select id="fIncAccount">${accountOptionsOnly()}</select>
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="fIncDate" value="${todayISO()}">
      </div>
    </div>
    <button class="btn-block" id="fIncSubmit">Add income</button>
  `;
  openModal('Add income', html, (body)=>{
    body.querySelector('#fIncNewSource').addEventListener('click', ()=>{
      const name = prompt('New income source name');
      if(name && name.trim()){
        state.incomeSources.push(name.trim());
        saveState();
        const sel = body.querySelector('#fIncSource');
        sel.innerHTML = state.incomeSources.map(s=>`<option value="${s}">${s}</option>`).join('');
        sel.value = name.trim();
      }
    });
    body.querySelector('#fIncSubmit').addEventListener('click', ()=>{
      const amount = Number(body.querySelector('#fIncAmount').value);
      if(!amount || amount<=0){ toast('Enter a valid amount'); return; }
      const accId = body.querySelector('#fIncAccount').value;
      const ref = { kind:'account', id: accId };
      const t = {
        id: uid(), type:'income', amount,
        category: body.querySelector('#fIncSource').value,
        description: body.querySelector('#fIncNote').value.trim(),
        date: body.querySelector('#fIncDate').value || todayISO(),
        ref, sourceOrNote: payerLabel(ref)
      };
      state.transactions.push(t);
      const a = getAccount(accId); if(a) a.balance += amount;
      saveState();
      closeModal();
      toast('Income added');
      goTo('income');
    });
  });
}

/* ================= ANALYTICS ================= */
function renderAnalytics(){
  const sel = document.getElementById('analyticsMonthFilter');
  const current = sel.value || monthKey(todayISO());
  sel.innerHTML = monthOptionsHtml(current);
  sel.onchange = renderAnalyticsCharts;
  renderAnalyticsCharts();
}
const CHART_COLORS = ['#C9A24B','#6FBF8B','#C9694A','#7C93AE','#A96BC9','#6BC0C9','#C9B36B','#8FA396','#B98CC9','#C98F6B','#6B9FC9','#8FC96B'];

function renderAnalyticsCharts(){
  const mk = document.getElementById('analyticsMonthFilter').value;
  const items = state.transactions.filter(t=>t.type==='expense' && monthKey(t.date)===mk);
  const byCategory = {};
  items.forEach(t=>{ byCategory[t.category] = (byCategory[t.category]||0) + t.amount; });
  const entries = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,e)=>s+e[1],0);

  document.getElementById('donutChart').innerHTML = total? drawDonut(entries, total) : '';
  document.getElementById('categoryLegend').innerHTML = entries.length ? entries.map((e,i)=>`
    <div class="legend-row">
      <div class="legend-left"><span class="legend-dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>${escapeHtml(e[0])}</div>
      <span class="legend-amt">${formatCurrency(e[1])}</span>
    </div>`).join('') : emptyNote('No spending recorded for this month.');

  document.getElementById('barChart').innerHTML = drawBarChart();
  document.getElementById('netWorthChart').innerHTML = drawNetWorthLine();
  renderCardDuesAnalytics();
  renderInvestmentAnalytics();
  renderLoanAnalytics();
}

function renderCardDuesAnalytics(){
  const el = document.getElementById('cardDuesAnalytics');
  if(state.creditCards.length===0){ el.innerHTML = emptyNote('No credit cards added.'); return; }
  const totalDue = state.creditCards.reduce((s,c)=>s+c.currentDue,0);
  const totalLimit = state.creditCards.reduce((s,c)=>s+c.limit,0);
  el.innerHTML = `
    <div class="ic-top" style="margin-bottom:14px;">
      <div><div class="ic-name">Total across cards</div></div>
      <div><div class="ic-amount debit">${formatCurrency(totalDue)}</div><div class="ic-meta">of ${formatCurrency(totalLimit)} limit</div></div>
    </div>
    <div class="ic-rule"></div>
    ${state.creditCards.map(c=>{
      const pct = c.limit ? Math.min(100, Math.round((c.currentDue/c.limit)*100)) : 0;
      const cls = pct>=90?'over':(pct>=70?'warn':'');
      return `
        <div class="ic-top" style="margin-top:12px;">
          <div><div class="ic-name">${escapeHtml(c.name)}</div><div class="ic-sub">${escapeHtml(c.bankName||'')} · due day ${c.dueDate}${ordSuffix(c.dueDate)}</div></div>
          <div><div class="ic-amount debit">${formatCurrency(c.currentDue)}</div><div class="ic-meta">of ${formatCurrency(c.limit)}</div></div>
        </div>
        <div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
      `;
    }).join('')}
  `;
}

function investmentBreakdown(){
  const inv = state.investments;
  const rows = [];
  if(inv.stocks.length){
    rows.push({ name:'Stocks', invested: inv.stocks.reduce((s,x)=>s+x.qty*x.buyPrice,0), current: inv.stocks.reduce((s,x)=>s+x.qty*x.currentPrice,0) });
  }
  if(inv.mf.length){
    rows.push({ name:'Mutual funds', invested: inv.mf.reduce((s,x)=>s+(Number(x.invested)||0),0), current: inv.mf.reduce((s,x)=>s+(Number(x.current)||0),0) });
  }
  if(inv.fd.length){
    rows.push({ name:'Fixed deposits', invested: inv.fd.reduce((s,x)=>s+x.principal,0), current: inv.fd.reduce((s,x)=>s+fdValue(x).currentValue,0) });
  }
  if(inv.bonds.length){
    const bondTotal = inv.bonds.reduce((s,x)=>s+(Number(x.invested)||0),0);
    rows.push({ name:'Bonds', invested: bondTotal, current: bondTotal });
  }
  if(inv.pf.balance){
    rows.push({ name:'Provident fund', invested: inv.pf.balance, current: inv.pf.balance });
  }
  return rows;
}

function renderInvestmentAnalytics(){
  const el = document.getElementById('investmentAnalytics');
  const rows = investmentBreakdown();
  if(rows.length===0){ el.innerHTML = emptyNote('No investments added yet — add stocks, mutual funds, FDs, bonds or PF under More → Investments.'); return; }
  const totalInvested = rows.reduce((s,r)=>s+r.invested,0);
  const totalCurrent = rows.reduce((s,r)=>s+r.current,0);
  const totalReturn = totalCurrent - totalInvested;
  const totalPct = totalInvested ? (totalReturn/totalInvested*100) : 0;
  el.innerHTML = `
    <div class="hero-stats" style="margin-bottom:14px;">
      <div class="hero-stat"><span class="hs-label">Invested</span><span class="hs-value">${formatCurrency(totalInvested)}</span></div>
      <div class="hero-stat"><span class="hs-label">Current value</span><span class="hs-value">${formatCurrency(totalCurrent)}</span></div>
      <div class="hero-stat"><span class="hs-label">Return</span><span class="hs-value ${totalReturn>=0?'credit':'debit'}">${totalReturn>=0?'+':''}${formatCurrency(totalReturn)} (${totalPct.toFixed(1)}%)</span></div>
    </div>
    <div class="ic-rule"></div>
    ${rows.map(r=>{
      const ret = r.current - r.invested;
      const pct = r.invested ? (ret/r.invested*100) : 0;
      return `
        <div class="people-row">
          <div class="people-name">${escapeHtml(r.name)}<small>invested ${formatCurrency(r.invested)}</small></div>
          <div style="text-align:right;">
            <div class="lr-amount" style="font-size:13px;">${formatCurrency(r.current)}</div>
            <div class="ic-meta ${ret>=0?'credit':'debit'}">${ret>=0?'+':''}${formatCurrency(ret)} (${pct.toFixed(1)}%)</div>
          </div>
        </div>`;
    }).join('')}
  `;
}

function renderLoanAnalytics(){
  const el = document.getElementById('loanAnalytics');
  if(state.loans.length===0){ el.innerHTML = emptyNote('No loans added yet.'); return; }
  const totalOutstanding = totalLoanOutstanding();
  const totalMonthlyEmi = state.loans.reduce((s,l)=>s+l.emiAmount,0);
  el.innerHTML = `
    <div class="hero-stats" style="margin-bottom:14px;">
      <div class="hero-stat"><span class="hs-label">Outstanding</span><span class="hs-value debit">${formatCurrency(totalOutstanding)}</span></div>
      <div class="hero-stat"><span class="hs-label">Monthly EMI total</span><span class="hs-value">${formatCurrency(totalMonthlyEmi)}</span></div>
    </div>
    <div class="ic-rule"></div>
    ${state.loans.map(l=>{
      const outstanding = l.emiAmount * l.remainingMonths;
      const pct = l.tenureMonths ? Math.round(((l.tenureMonths-l.remainingMonths)/l.tenureMonths)*100) : 0;
      return `
        <div class="people-row">
          <div class="people-name">${escapeHtml(l.name)}<small>${l.remainingMonths} of ${l.tenureMonths} EMIs left · ${pct}% paid off</small></div>
          <div style="text-align:right;">
            <div class="lr-amount debit" style="font-size:13px;">${formatCurrency(outstanding)}</div>
            <div class="ic-meta">EMI ${formatCurrency(l.emiAmount)}</div>
          </div>
        </div>`;
    }).join('')}
  `;
}

function drawNetWorthLine(){
  const hist = state.netWorthHistory.slice(-60);
  if(hist.length<2){
    const v = hist.length? hist[0].value : netWorth();
    return `<svg width="260" height="110" viewBox="0 0 260 110">
      <text x="130" y="55" text-anchor="middle" fill="var(--text-faint)" font-family="Inter" font-size="11">${formatCurrency(v)} so far</text>
    </svg>`;
  }
  const w = 260, h = 90, pad = 6;
  const values = hist.map(p=>p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max-min) || 1;
  const pts = hist.map((p,i)=>{
    const x = pad + (i/(hist.length-1))*(w-pad*2);
    const y = h - pad - ((p.value-min)/range)*(h-pad*2);
    return `${x},${y}`;
  }).join(' ');
  const last = hist[hist.length-1].value;
  const first = hist[0].value;
  const color = last>=first ? 'var(--credit)' : 'var(--debit)';
  return `<svg width="${w}" height="${h+24}" viewBox="0 0 ${w} ${h+24}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="0" y="${h+18}" fill="var(--text-faint)" font-family="Inter" font-size="9">${formatDateShort(hist[0].date)}</text>
    <text x="${w}" y="${h+18}" text-anchor="end" fill="var(--text-faint)" font-family="Inter" font-size="9">${formatDateShort(hist[hist.length-1].date)}</text>
  </svg>`;
}

function drawDonut(entries, total){
  const r = 70, cx=90, cy=90, sw=26;
  let angle = -90;
  const circumference = 2*Math.PI*r;
  let paths = '';
  entries.forEach((e,i)=>{
    const frac = e[1]/total;
    const dash = frac*circumference;
    paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${CHART_COLORS[i%CHART_COLORS.length]}"
      stroke-width="${sw}" stroke-dasharray="${dash} ${circumference-dash}"
      transform="rotate(${angle} ${cx} ${cy})" />`;
    angle += frac*360;
  });
  return `<svg width="180" height="180" viewBox="0 0 180 180">
    ${paths}
    <text x="90" y="86" text-anchor="middle" fill="var(--text)" font-family="IBM Plex Mono" font-size="15" font-weight="600">${formatCurrency(total)}</text>
    <text x="90" y="104" text-anchor="middle" fill="var(--text-faint)" font-family="Inter" font-size="10">total spend</text>
  </svg>`;
}

function drawBarChart(){
  const months = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(d.toISOString().slice(0,7));
  }
  const data = months.map(mk=>{
    const items = state.transactions.filter(t=>monthKey(t.date)===mk);
    return {
      mk,
      income: items.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0),
      expense: items.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)
    };
  });
  const maxVal = Math.max(1, ...data.flatMap(d=>[d.income,d.expense]));
  const chartH = 140, barW = 12, gap = 26, groupW = barW*2+6;
  const width = data.length*(groupW+gap);
  let bars = '';
  data.forEach((d,i)=>{
    const x = i*(groupW+gap) + gap/2;
    const hIncome = (d.income/maxVal)*chartH;
    const hExpense = (d.expense/maxVal)*chartH;
    bars += `<rect x="${x}" y="${chartH-hIncome}" width="${barW}" height="${hIncome}" fill="var(--credit-svg)" rx="2"/>`;
    bars += `<rect x="${x+barW+6}" y="${chartH-hExpense}" width="${barW}" height="${hExpense}" fill="var(--debit-svg)" rx="2"/>`;
    bars += `<text x="${x+barW}" y="${chartH+16}" text-anchor="middle" fill="var(--text-faint)" font-family="Inter" font-size="9">${monthLabel(d.mk).split(' ')[0].slice(0,3)}</text>`;
  });
  return `<svg width="${Math.max(width,260)}" height="170" viewBox="0 0 ${Math.max(width,260)} 170" style="--credit-svg:#6FBF8B;--debit-svg:#C9694A;">${bars}</svg>`;
}

/* ================= ACCOUNTS & CARDS ================= */
function renderAccountsPage(){
  document.getElementById('accountsList').innerHTML = state.accounts.length ? state.accounts.map(a=>`
    <div class="item-card accent-green">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(a.name)}</div><div class="ic-sub">${escapeHtml(a.bankName||'')} · ${a.type==='bank'?'Bank':'Cash'}</div></div>
        <div><div class="ic-amount">${formatCurrency(a.balance)}</div></div>
      </div>
      <div class="ic-actions">
        <button data-edit-acc="${a.id}">Edit</button>
        <button class="rust" data-del-acc="${a.id}">Delete</button>
      </div>
    </div>`).join('') : emptyNote('No accounts yet.');

  document.getElementById('cardsList').innerHTML = state.creditCards.length ? state.creditCards.map(c=>`
    <div class="item-card accent-rust">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(c.name)}</div><div class="ic-sub">${escapeHtml(c.bankName||'')} · limit ${formatCurrency(c.limit)}</div></div>
        <div><div class="ic-amount debit">${formatCurrency(c.currentDue)}</div><div class="ic-meta">due ${c.dueDate}${ordSuffix(c.dueDate)}</div></div>
      </div>
      <div class="ic-actions">
        <button class="gold" data-pay-card="${c.id}">Pay bill</button>
        <button data-edit-card="${c.id}">Edit</button>
        <button class="rust" data-del-card="${c.id}">Delete</button>
      </div>
    </div>`).join('') : emptyNote('No credit cards yet.');

  bindOnce(document.getElementById('accountsList'), 'click', (e)=>{
    const ed = e.target.closest('[data-edit-acc]'); if(ed) return openAccountModal(getAccount(ed.dataset.editAcc));
    const del = e.target.closest('[data-del-acc]');
    if(del){
      if(confirm('Delete this account? Its past transactions stay in your history.')){
        state.accounts = state.accounts.filter(a=>a.id!==del.dataset.delAcc);
        saveState(); renderAccountsPage();
      }
    }
  });
  bindOnce(document.getElementById('cardsList'), 'click', (e)=>{
    const ed = e.target.closest('[data-edit-card]'); if(ed) return openCardModal(getCard(ed.dataset.editCard));
    const pay = e.target.closest('[data-pay-card]'); if(pay) return openPayCardModal(getCard(pay.dataset.payCard));
    const del = e.target.closest('[data-del-card]');
    if(del){
      if(confirm('Delete this card?')){
        state.creditCards = state.creditCards.filter(c=>c.id!==del.dataset.delCard);
        saveState(); renderAccountsPage();
      }
    }
  });
}
function ordSuffix(n){ n=Number(n); if(n>10&&n<20) return 'th'; const l=n%10; return l===1?'st':l===2?'nd':l===3?'rd':'th'; }

function bindOnce(el, evt, handler){
  const key = '_bound_'+evt;
  if(el[key]) el.removeEventListener(evt, el[key]);
  el.addEventListener(evt, handler);
  el[key] = handler;
}

document.getElementById('openAddAccount').addEventListener('click', ()=>openAccountModal());
function openAccountModal(existing){
  const html = `
    <div class="field"><label>Account name</label><input id="fAccName" placeholder="e.g. HDFC Savings" value="${existing?escapeHtml(existing.name):''}"></div>
    <div class="field"><label>Bank name <span style="color:var(--text-faint)">(optional)</span></label><input id="fAccBank" placeholder="e.g. HDFC Bank" value="${existing?escapeHtml(existing.bankName||''):''}"></div>
    <div class="field-row">
      <div class="field"><label>Type</label>
        <select id="fAccType">
          <option value="bank" ${existing&&existing.type==='bank'?'selected':''}>Bank</option>
          <option value="cash" ${existing&&existing.type==='cash'?'selected':''}>Cash</option>
        </select>
      </div>
      <div class="field"><label>${existing?'Current balance':'Opening balance'}</label><input type="number" id="fAccBalance" value="${existing?existing.balance:''}" placeholder="0"></div>
    </div>
    <button class="btn-block" id="fAccSubmit">${existing?'Save changes':'Add account'}</button>
  `;
  openModal(existing?'Edit account':'Add account', html, (body)=>{
    body.querySelector('#fAccSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fAccName').value.trim();
      if(!name){ toast('Enter an account name'); return; }
      const balance = Number(body.querySelector('#fAccBalance').value)||0;
      if(existing){
        existing.name = name; existing.bankName = body.querySelector('#fAccBank').value.trim();
        existing.type = body.querySelector('#fAccType').value; existing.balance = balance;
      } else {
        state.accounts.push({ id:uid(), name, bankName: body.querySelector('#fAccBank').value.trim(), type: body.querySelector('#fAccType').value, balance });
      }
      saveState(); closeModal(); toast('Saved'); renderAccountsPage();
    });
  });
}

document.getElementById('openAddCard').addEventListener('click', ()=>openCardModal());
function openCardModal(existing){
  const html = `
    <div class="field"><label>Card name</label><input id="fCardName" placeholder="e.g. Regalia" value="${existing?escapeHtml(existing.name):''}"></div>
    <div class="field"><label>Bank</label><input id="fCardBank" placeholder="e.g. HDFC Bank" value="${existing?escapeHtml(existing.bankName||''):''}"></div>
    <div class="field-row">
      <div class="field"><label>Credit limit</label><input type="number" id="fCardLimit" value="${existing?existing.limit:''}" placeholder="0"></div>
      <div class="field"><label>Current due</label><input type="number" id="fCardDue" value="${existing?existing.currentDue:0}" placeholder="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Bill date (day of month)</label><input type="number" min="1" max="31" id="fCardBillDate" value="${existing?existing.billDate:''}" placeholder="e.g. 5"></div>
      <div class="field"><label>Due date (day of month)</label><input type="number" min="1" max="31" id="fCardDueDate" value="${existing?existing.dueDate:''}" placeholder="e.g. 25"></div>
    </div>
    <button class="btn-block" id="fCardSubmit">${existing?'Save changes':'Add card'}</button>
  `;
  openModal(existing?'Edit card':'Add credit card', html, (body)=>{
    body.querySelector('#fCardSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fCardName').value.trim();
      if(!name){ toast('Enter a card name'); return; }
      const data = {
        name, bankName: body.querySelector('#fCardBank').value.trim(),
        limit: Number(body.querySelector('#fCardLimit').value)||0,
        currentDue: Number(body.querySelector('#fCardDue').value)||0,
        billDate: Number(body.querySelector('#fCardBillDate').value)||1,
        dueDate: Number(body.querySelector('#fCardDueDate').value)||1
      };
      if(existing){ Object.assign(existing, data); }
      else { state.creditCards.push({ id: uid(), ...data }); }
      saveState(); closeModal(); toast('Saved'); renderAccountsPage();
    });
  });
}

function openPayCardModal(card){
  if(state.accounts.length===0){ toast('Add a bank account first'); return; }
  const html = `
    <p style="font-size:13px;color:var(--text-muted);margin-top:0;">Current due on <b>${escapeHtml(card.name)}</b>: ${formatCurrency(card.currentDue)}</p>
    <div class="field"><label>Amount to pay</label><input type="number" id="fPayAmount" value="${card.currentDue}"></div>
    <div class="field"><label>Pay from</label><select id="fPayFrom">${accountOptionsOnly()}</select></div>
    <button class="btn-block" id="fPaySubmit">Pay bill</button>
  `;
  openModal('Pay credit card bill', html, (body)=>{
    body.querySelector('#fPaySubmit').addEventListener('click', ()=>{
      const amount = Number(body.querySelector('#fPayAmount').value);
      if(!amount || amount<=0){ toast('Enter a valid amount'); return; }
      const accId = body.querySelector('#fPayFrom').value;
      const acc = getAccount(accId);
      acc.balance -= amount;
      card.currentDue -= amount;
      state.transactions.push({
        id: uid(), type:'expense', amount, category:'EMI & Loan',
        description: `Credit card bill payment — ${card.name}`,
        date: todayISO(), ref:{kind:'account', id:accId}, sourceOrNote: acc.name,
        meta: { cardId: card.id }
      });
      saveState(); closeModal(); toast('Bill paid'); renderAccountsPage();
    });
  });
}

/* ================= LOANS ================= */
function renderLoansPage(){
  document.getElementById('loansList').innerHTML = state.loans.length ? state.loans.map(l=>{
    const next = nextEmiDate(l);
    return `
    <div class="item-card accent-rust">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(l.name)}</div><div class="ic-sub">${l.remainingMonths} of ${l.tenureMonths} EMIs left · ${l.rate||0}% p.a.</div></div>
        <div><div class="ic-amount debit">${formatCurrency(l.emiAmount)}</div><div class="ic-meta">next ${formatDateShort(next.toISOString().slice(0,10))}</div></div>
      </div>
      <div class="ic-rule"></div>
      <div class="ic-sub">Outstanding ≈ ${formatCurrency(l.emiAmount*l.remainingMonths)}</div>
      <div class="ic-actions">
        <button class="gold" data-pay-emi="${l.id}">Mark EMI paid</button>
        <button data-edit-loan="${l.id}">Edit</button>
        <button class="rust" data-del-loan="${l.id}">Delete</button>
      </div>
    </div>`;
  }).join('') : emptyNote('No loans added yet.');

  bindOnce(document.getElementById('loansList'), 'click', (e)=>{
    const pay = e.target.closest('[data-pay-emi]'); if(pay) return openPayEmiModal(state.loans.find(l=>l.id===pay.dataset.payEmi));
    const ed = e.target.closest('[data-edit-loan]'); if(ed) return openLoanModal(state.loans.find(l=>l.id===ed.dataset.editLoan));
    const del = e.target.closest('[data-del-loan]');
    if(del){
      if(confirm('Delete this loan?')){
        state.loans = state.loans.filter(l=>l.id!==del.dataset.delLoan);
        saveState(); renderLoansPage();
      }
    }
  });
}

document.getElementById('openAddLoan').addEventListener('click', ()=>openLoanModal());
function openLoanModal(existing){
  const html = `
    <div class="field"><label>Loan name</label><input id="fLoanName" placeholder="e.g. Home loan" value="${existing?escapeHtml(existing.name):''}"></div>
    <div class="field-row">
      <div class="field"><label>Principal</label><input type="number" id="fLoanPrincipal" value="${existing?existing.principal:''}" placeholder="0"></div>
      <div class="field"><label>Interest rate % p.a.</label><input type="number" id="fLoanRate" value="${existing?existing.rate:''}" placeholder="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>EMI amount</label><input type="number" id="fLoanEmi" value="${existing?existing.emiAmount:''}" placeholder="0"></div>
      <div class="field"><label>EMI day of month</label><input type="number" min="1" max="31" id="fLoanDay" value="${existing?existing.emiDay:''}" placeholder="e.g. 5"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Total tenure (months)</label><input type="number" id="fLoanTenure" value="${existing?existing.tenureMonths:''}" placeholder="0"></div>
      <div class="field"><label>Months remaining</label><input type="number" id="fLoanRemaining" value="${existing?existing.remainingMonths:''}" placeholder="0"></div>
    </div>
    <button class="btn-block" id="fLoanSubmit">${existing?'Save changes':'Add loan'}</button>
  `;
  openModal(existing?'Edit loan':'Add loan', html, (body)=>{
    body.querySelector('#fLoanSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fLoanName').value.trim();
      if(!name){ toast('Enter a loan name'); return; }
      const data = {
        name,
        principal: Number(body.querySelector('#fLoanPrincipal').value)||0,
        rate: Number(body.querySelector('#fLoanRate').value)||0,
        emiAmount: Number(body.querySelector('#fLoanEmi').value)||0,
        emiDay: Math.min(31, Math.max(1, Number(body.querySelector('#fLoanDay').value)||1)),
        tenureMonths: Number(body.querySelector('#fLoanTenure').value)||0,
        remainingMonths: Number(body.querySelector('#fLoanRemaining').value)||0
      };
      if(existing){ Object.assign(existing, data); }
      else { state.loans.push({ id: uid(), ...data }); }
      saveState(); closeModal(); toast('Saved'); renderLoansPage();
    });
  });
}

function openPayEmiModal(loan){
  if(state.accounts.length===0){ toast('Add a bank account first'); return; }
  const html = `
    <p style="font-size:13px;color:var(--text-muted);margin-top:0;">EMI for <b>${escapeHtml(loan.name)}</b>: ${formatCurrency(loan.emiAmount)}</p>
    <div class="field"><label>Pay from</label><select id="fEmiFrom">${accountOptionsOnly()}</select></div>
    <button class="btn-block" id="fEmiSubmit">Mark as paid</button>
  `;
  openModal('Pay EMI', html, (body)=>{
    body.querySelector('#fEmiSubmit').addEventListener('click', ()=>{
      const accId = body.querySelector('#fEmiFrom').value;
      const acc = getAccount(accId);
      acc.balance -= loan.emiAmount;
      loan.remainingMonths = Math.max(0, loan.remainingMonths-1);
      state.transactions.push({
        id: uid(), type:'expense', amount: loan.emiAmount, category:'EMI & Loan',
        description: `EMI — ${loan.name}`, date: todayISO(),
        ref:{kind:'account', id:accId}, sourceOrNote: acc.name,
        meta: { loanId: loan.id }
      });
      saveState(); closeModal(); toast('EMI marked paid'); renderLoansPage();
    });
  });
}

/* ================= INVESTMENTS ================= */
function renderInvestmentsPage(){
  renderStocks(); renderMF(); renderFD(); renderBonds(); renderPF();
}

function renderStocks(){
  document.getElementById('stocksList').innerHTML = state.investments.stocks.length ? state.investments.stocks.map(s=>{
    const value = s.qty*s.currentPrice, invested = s.qty*s.buyPrice, pl = value-invested;
    return `
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(s.name)} ${s.ticker?`<span style="color:var(--text-faint)">(${escapeHtml(s.ticker)})</span>`:''}</div><div class="ic-sub">${s.qty} qty · avg ${formatCurrency(s.buyPrice)}</div></div>
        <div><div class="ic-amount">${formatCurrency(value)}</div><div class="ic-meta ${pl>=0?'credit':'debit'}">${pl>=0?'+':''}${formatCurrency(pl)}</div></div>
      </div>
      <div class="ic-actions"><button data-edit-stock="${s.id}">Edit</button><button class="rust" data-del-stock="${s.id}">Delete</button></div>
    </div>`;
  }).join('') : emptyNote('No stock holdings added.');
  bindOnce(document.getElementById('stocksList'),'click',(e)=>{
    const ed=e.target.closest('[data-edit-stock]'); if(ed) return openStockModal(state.investments.stocks.find(s=>s.id===ed.dataset.editStock));
    const del=e.target.closest('[data-del-stock]');
    if(del && confirm('Delete this holding?')){ state.investments.stocks = state.investments.stocks.filter(s=>s.id!==del.dataset.delStock); saveState(); renderStocks(); }
  });
}
document.getElementById('openAddStock').addEventListener('click', ()=>openStockModal());
function openStockModal(existing){
  const html = `
    <div class="field"><label>Company name</label><input id="fStName" value="${existing?escapeHtml(existing.name):''}" placeholder="e.g. Reliance Industries"></div>
    <div class="field"><label>Ticker <span style="color:var(--text-faint)">(optional)</span></label><input id="fStTicker" value="${existing?escapeHtml(existing.ticker||''):''}" placeholder="e.g. RELIANCE"></div>
    <div class="field-row">
      <div class="field"><label>Quantity</label><input type="number" id="fStQty" value="${existing?existing.qty:''}"></div>
      <div class="field"><label>Avg buy price</label><input type="number" id="fStBuy" value="${existing?existing.buyPrice:''}"></div>
    </div>
    <div class="field"><label>Current market price</label><input type="number" id="fStCurrent" value="${existing?existing.currentPrice:''}"></div>
    <button class="btn-block" id="fStSubmit">${existing?'Save changes':'Add holding'}</button>
  `;
  openModal(existing?'Edit stock':'Add stock', html, (body)=>{
    body.querySelector('#fStSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fStName').value.trim();
      if(!name){ toast('Enter a company name'); return; }
      const data = { name, ticker: body.querySelector('#fStTicker').value.trim(),
        qty: Number(body.querySelector('#fStQty').value)||0,
        buyPrice: Number(body.querySelector('#fStBuy').value)||0,
        currentPrice: Number(body.querySelector('#fStCurrent').value)||0 };
      if(existing){ Object.assign(existing,data); } else { state.investments.stocks.push({id:uid(), ...data}); }
      saveState(); closeModal(); toast('Saved'); renderStocks();
    });
  });
}

function renderMF(){
  document.getElementById('mfList').innerHTML = state.investments.mf.length ? state.investments.mf.map(m=>{
    const pl = m.current - m.invested;
    return `
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(m.name)}</div><div class="ic-sub">${m.sipAmount?`SIP ${formatCurrency(m.sipAmount)}/mo · day ${m.sipDay}`:'One-time'}</div></div>
        <div><div class="ic-amount">${formatCurrency(m.current)}</div><div class="ic-meta ${pl>=0?'credit':'debit'}">${pl>=0?'+':''}${formatCurrency(pl)}</div></div>
      </div>
      <div class="ic-actions"><button data-edit-mf="${m.id}">Edit</button><button class="rust" data-del-mf="${m.id}">Delete</button></div>
    </div>`;
  }).join('') : emptyNote('No mutual fund folios added.');
  bindOnce(document.getElementById('mfList'),'click',(e)=>{
    const ed=e.target.closest('[data-edit-mf]'); if(ed) return openMFModal(state.investments.mf.find(m=>m.id===ed.dataset.editMf));
    const del=e.target.closest('[data-del-mf]');
    if(del && confirm('Delete this folio?')){ state.investments.mf = state.investments.mf.filter(m=>m.id!==del.dataset.delMf); saveState(); renderMF(); }
  });
}
document.getElementById('openAddMF').addEventListener('click', ()=>openMFModal());
function openMFModal(existing){
  const html = `
    <div class="field"><label>Fund name</label><input id="fMfName" value="${existing?escapeHtml(existing.name):''}" placeholder="e.g. Parag Parikh Flexi Cap"></div>
    <div class="field-row">
      <div class="field"><label>Invested amount</label><input type="number" id="fMfInvested" value="${existing?existing.invested:''}"></div>
      <div class="field"><label>Current value</label><input type="number" id="fMfCurrent" value="${existing?existing.current:''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>SIP amount <span style="color:var(--text-faint)">(optional)</span></label><input type="number" id="fMfSip" value="${existing?existing.sipAmount||'':''}"></div>
      <div class="field"><label>SIP day</label><input type="number" min="1" max="31" id="fMfSipDay" value="${existing?existing.sipDay||'':''}"></div>
    </div>
    <button class="btn-block" id="fMfSubmit">${existing?'Save changes':'Add folio'}</button>
  `;
  openModal(existing?'Edit mutual fund':'Add mutual fund', html, (body)=>{
    body.querySelector('#fMfSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fMfName').value.trim();
      if(!name){ toast('Enter a fund name'); return; }
      const data = { name, invested: Number(body.querySelector('#fMfInvested').value)||0,
        current: Number(body.querySelector('#fMfCurrent').value)||0,
        sipAmount: Number(body.querySelector('#fMfSip').value)||0,
        sipDay: Number(body.querySelector('#fMfSipDay').value)||0 };
      if(existing){ Object.assign(existing,data); } else { state.investments.mf.push({id:uid(), ...data}); }
      saveState(); closeModal(); toast('Saved'); renderMF();
    });
  });
}

function renderFD(){
  document.getElementById('fdList').innerHTML = state.investments.fd.length ? state.investments.fd.map(f=>{
    const v = fdValue(f);
    return `
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(f.bankName)} FD</div><div class="ic-sub">${f.rate}% p.a. · matures ${formatDateShort(f.maturityDate)}</div></div>
        <div><div class="ic-amount">${formatCurrency(v.currentValue)}</div><div class="ic-meta">${v.daysLeft}d left</div></div>
      </div>
      <div class="ic-rule"></div>
      <div class="ic-sub">Principal ${formatCurrency(f.principal)} → matures at ${formatCurrency(v.maturityAmount)}</div>
      <div class="ic-actions"><button data-edit-fd="${f.id}">Edit</button><button class="rust" data-del-fd="${f.id}">Delete</button></div>
    </div>`;
  }).join('') : emptyNote('No fixed deposits added.');
  bindOnce(document.getElementById('fdList'),'click',(e)=>{
    const ed=e.target.closest('[data-edit-fd]'); if(ed) return openFDModal(state.investments.fd.find(f=>f.id===ed.dataset.editFd));
    const del=e.target.closest('[data-del-fd]');
    if(del && confirm('Delete this FD?')){ state.investments.fd = state.investments.fd.filter(f=>f.id!==del.dataset.delFd); saveState(); renderFD(); }
  });
}
document.getElementById('openAddFD').addEventListener('click', ()=>openFDModal());
function openFDModal(existing){
  const html = `
    <div class="field"><label>Bank name</label><input id="fFdBank" value="${existing?escapeHtml(existing.bankName):''}" placeholder="e.g. SBI"></div>
    <div class="field-row">
      <div class="field"><label>Principal</label><input type="number" id="fFdPrincipal" value="${existing?existing.principal:''}"></div>
      <div class="field"><label>Interest rate % p.a.</label><input type="number" id="fFdRate" value="${existing?existing.rate:''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="fFdStart" value="${existing?existing.startDate:todayISO()}"></div>
      <div class="field"><label>Maturity date</label><input type="date" id="fFdMaturity" value="${existing?existing.maturityDate:''}"></div>
    </div>
    <button class="btn-block" id="fFdSubmit">${existing?'Save changes':'Add FD'}</button>
  `;
  openModal(existing?'Edit fixed deposit':'Add fixed deposit', html, (body)=>{
    body.querySelector('#fFdSubmit').addEventListener('click', ()=>{
      const bankName = body.querySelector('#fFdBank').value.trim();
      if(!bankName){ toast('Enter a bank name'); return; }
      const data = { bankName, principal: Number(body.querySelector('#fFdPrincipal').value)||0,
        rate: Number(body.querySelector('#fFdRate').value)||0,
        startDate: body.querySelector('#fFdStart').value, maturityDate: body.querySelector('#fFdMaturity').value };
      if(!data.maturityDate){ toast('Set a maturity date'); return; }
      if(existing){ Object.assign(existing,data); } else { state.investments.fd.push({id:uid(), ...data}); }
      saveState(); closeModal(); toast('Saved'); renderFD();
    });
  });
}

function renderBonds(){
  document.getElementById('bondsList').innerHTML = state.investments.bonds.length ? state.investments.bonds.map(b=>`
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(b.name)}</div><div class="ic-sub">${b.rate}% p.a. · matures ${formatDateShort(b.maturityDate)}</div></div>
        <div><div class="ic-amount">${formatCurrency(b.invested)}</div></div>
      </div>
      <div class="ic-actions"><button data-edit-bond="${b.id}">Edit</button><button class="rust" data-del-bond="${b.id}">Delete</button></div>
    </div>`).join('') : emptyNote('No bonds added.');
  bindOnce(document.getElementById('bondsList'),'click',(e)=>{
    const ed=e.target.closest('[data-edit-bond]'); if(ed) return openBondModal(state.investments.bonds.find(b=>b.id===ed.dataset.editBond));
    const del=e.target.closest('[data-del-bond]');
    if(del && confirm('Delete this bond?')){ state.investments.bonds = state.investments.bonds.filter(b=>b.id!==del.dataset.delBond); saveState(); renderBonds(); }
  });
}
document.getElementById('openAddBond').addEventListener('click', ()=>openBondModal());
function openBondModal(existing){
  const html = `
    <div class="field"><label>Bond name</label><input id="fBondName" value="${existing?escapeHtml(existing.name):''}" placeholder="e.g. NHAI Tax-free bond"></div>
    <div class="field-row">
      <div class="field"><label>Invested amount</label><input type="number" id="fBondInvested" value="${existing?existing.invested:''}"></div>
      <div class="field"><label>Interest rate % p.a.</label><input type="number" id="fBondRate" value="${existing?existing.rate:''}"></div>
    </div>
    <div class="field"><label>Maturity date</label><input type="date" id="fBondMaturity" value="${existing?existing.maturityDate:''}"></div>
    <button class="btn-block" id="fBondSubmit">${existing?'Save changes':'Add bond'}</button>
  `;
  openModal(existing?'Edit bond':'Add bond', html, (body)=>{
    body.querySelector('#fBondSubmit').addEventListener('click', ()=>{
      const name = body.querySelector('#fBondName').value.trim();
      if(!name){ toast('Enter a bond name'); return; }
      const data = { name, invested: Number(body.querySelector('#fBondInvested').value)||0,
        rate: Number(body.querySelector('#fBondRate').value)||0, maturityDate: body.querySelector('#fBondMaturity').value };
      if(existing){ Object.assign(existing,data); } else { state.investments.bonds.push({id:uid(), ...data}); }
      saveState(); closeModal(); toast('Saved'); renderBonds();
    });
  });
}

function renderPF(){
  const pf = state.investments.pf;
  document.getElementById('pfBlock').innerHTML = `
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">Provident Fund</div><div class="ic-sub">UAN: ${escapeHtml(pf.uan||'—')}</div></div>
        <div><div class="ic-amount">${formatCurrency(pf.balance)}</div><div class="ic-meta">+${formatCurrency(pf.monthly)}/mo</div></div>
      </div>
    </div>
    <div class="item-card accent-gold">
      <div class="ic-top">
        <div><div class="ic-name">PAN</div><div class="ic-sub">Stored for your reference only</div></div>
        <div><div class="ic-amount" style="font-size:14px;">${escapeHtml(state.investments.pan||'—')}</div></div>
      </div>
    </div>
  `;
}
document.getElementById('openEditPF').addEventListener('click', ()=>{
  const pf = state.investments.pf;
  const html = `
    <div class="field"><label>UAN number</label><input id="fPfUan" value="${escapeHtml(pf.uan||'')}"></div>
    <div class="field-row">
      <div class="field"><label>Current PF balance</label><input type="number" id="fPfBalance" value="${pf.balance||''}"></div>
      <div class="field"><label>Monthly contribution</label><input type="number" id="fPfMonthly" value="${pf.monthly||''}"></div>
    </div>
    <div class="field"><label>PAN number</label><input id="fPfPan" value="${escapeHtml(state.investments.pan||'')}" style="text-transform:uppercase;"></div>
    <button class="btn-block" id="fPfSubmit">Save</button>
  `;
  openModal('Edit PF & PAN', html, (body)=>{
    body.querySelector('#fPfSubmit').addEventListener('click', ()=>{
      pf.uan = body.querySelector('#fPfUan').value.trim();
      pf.balance = Number(body.querySelector('#fPfBalance').value)||0;
      pf.monthly = Number(body.querySelector('#fPfMonthly').value)||0;
      state.investments.pan = body.querySelector('#fPfPan').value.trim().toUpperCase();
      saveState(); closeModal(); toast('Saved'); renderPF();
    });
  });
});

/* ---- investment tabs ---- */
document.getElementById('investTabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab-btn'); if(!btn) return;
  document.querySelectorAll('#investTabs .tab-btn').forEach(b=>b.classList.toggle('active', b===btn));
  document.querySelectorAll('.tab-panel').forEach(p=> p.hidden = p.dataset.panel!==btn.dataset.tab);
});

/* ================= SPLIT WITH FRIENDS ================= */
function renderSplitPage(){
  document.getElementById('splitPendingTotal').textContent = formatCurrency(splitPendingTotal());
  document.getElementById('splitList').innerHTML = state.splitGroups.length ? [...state.splitGroups].reverse().map(g=>{
    const pendingPeople = g.people.filter(p=>!p.paid).length;
    const modeLabel = g.mode==='lend' ? 'Lent' : 'Paid';
    const badge = g.mode==='lend' ? '🤝 Lending' : '🧾 Split bill';
    return `
    <div class="item-card ${g.mode==='lend'?'accent-gold':'accent-green'}">
      <div class="ic-top">
        <div><div class="ic-name">${escapeHtml(g.title)} <span style="font-size:11px;color:var(--text-faint);font-weight:400;">· ${badge}</span></div><div class="ic-sub">${modeLabel} ${formatCurrency(g.total)} from ${escapeHtml(payerLabel(g.paidFromRef))} · ${formatDateShort(g.date)}</div></div>
        <div><div class="ic-amount">${pendingPeople} pending</div></div>
      </div>
      <div class="ic-rule"></div>
      ${g.people.map(p=>`
        <div class="people-row">
          <div class="people-name">${escapeHtml(p.name)}${p.phone?`<small>${escapeHtml(p.phone)}</small>`:''}</div>
          <div style="display:flex;align-items:center;">
            <span class="lr-amount" style="font-size:13px;">${formatCurrency(p.share)}</span>
            <span class="pill-status ${p.paid?'paid':'pending'}">${p.paid?'Paid':'Pending'}</span>
            ${!p.paid?`<button class="btn-small" style="margin-left:8px;" data-settle="${g.id}:${p.id}">Settle</button>`:''}
          </div>
        </div>`).join('')}
      <div class="ic-actions"><button class="rust" data-del-split="${g.id}">Delete group</button></div>
    </div>`;
  }).join('') : emptyNote('No split groups yet. Add one from the Spend page.');

  bindOnce(document.getElementById('splitList'), 'click', (e)=>{
    const settle = e.target.closest('[data-settle]');
    if(settle){
      const [gid,pid] = settle.dataset.settle.split(':');
      return openSettleModal(gid,pid);
    }
    const del = e.target.closest('[data-del-split]');
    if(del && confirm('Delete this split group? This does not reverse account balances already settled.')){
      state.splitGroups = state.splitGroups.filter(g=>g.id!==del.dataset.delSplit);
      saveState(); renderSplitPage();
    }
  });
}

function openSettleModal(gid,pid){
  const g = state.splitGroups.find(g=>g.id===gid);
  const p = g.people.find(p=>p.id===pid);
  const html = `
    <p style="font-size:13px;color:var(--text-muted);margin-top:0;"><b>${escapeHtml(p.name)}</b> owes you ${formatCurrency(p.share)} for "${escapeHtml(g.title)}"</p>
    <div class="field"><label>Received into</label><select id="fSettleAcc">${accountOptionsOnly()}</select></div>
    <button class="btn-block" id="fSettleSubmit">Mark as paid</button>
  `;
  openModal('Settle up', html, (body)=>{
    body.querySelector('#fSettleSubmit').addEventListener('click', ()=>{
      const accId = body.querySelector('#fSettleAcc').value;
      const acc = getAccount(accId);
      acc.balance += p.share;
      p.paid = true;
      state.transactions.push({
        id: uid(), type:'income', amount: p.share, category:'Split Settlement',
        description: `${p.name} settled — ${g.title}`, date: todayISO(),
        ref:{kind:'account',id:accId}, sourceOrNote: acc.name,
        meta: { splitGroupId: g.id, personId: p.id, role:'settle' }
      });
      saveState(); closeModal(); toast('Marked as paid'); renderSplitPage();
    });
  });
}

/* ================= BUDGETS ================= */
function categorySpendThisMonth(){
  const mk = monthKey(todayISO());
  const out = {};
  state.transactions.filter(t=>t.type==='expense' && monthKey(t.date)===mk).forEach(t=>{
    out[t.category] = (out[t.category]||0) + t.amount;
  });
  return out;
}

function renderBudgetsPage(){
  document.getElementById('budgetMonthLabel').textContent = monthLabel(monthKey(todayISO()));
  const spent = categorySpendThisMonth();
  const cats = Object.keys(state.budgets);
  document.getElementById('budgetsList').innerHTML = cats.length ? cats.map(cat=>{
    const limit = state.budgets[cat];
    const used = spent[cat]||0;
    const pct = limit? Math.min(100, Math.round((used/limit)*100)) : 0;
    const cls = used>=limit ? 'over' : (used/limit>=0.9 ? 'warn' : '');
    return `
    <div class="item-card">
      <div class="ic-top">
        <div><div class="ic-name">${categoryIcon(cat)} ${escapeHtml(cat)}</div><div class="ic-sub">${formatCurrency(used)} of ${formatCurrency(limit)}</div></div>
        <div><div class="ic-amount ${used>=limit?'debit':''}">${pct}%</div></div>
      </div>
      <div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
      <div class="ic-actions"><button data-edit-budget="${escapeHtml(cat)}">Edit</button><button class="rust" data-del-budget="${escapeHtml(cat)}">Remove</button></div>
    </div>`;
  }).join('') : emptyNote('No budgets set yet. Add one to keep a category in check.');

  bindOnce(document.getElementById('budgetsList'),'click',(e)=>{
    const ed = e.target.closest('[data-edit-budget]'); if(ed) return openBudgetModal(ed.dataset.editBudget);
    const del = e.target.closest('[data-del-budget]');
    if(del){ delete state.budgets[del.dataset.delBudget]; saveState(); renderBudgetsPage(); }
  });
}

document.getElementById('openAddBudget').addEventListener('click', ()=>openBudgetModal());
function openBudgetModal(existingCat){
  const remaining = EXPENSE_CATEGORIES.filter(c=> existingCat ? c===existingCat : !(c in state.budgets));
  if(!existingCat && remaining.length===0){ toast('You already have a budget on every category'); return; }
  const html = `
    <div class="field">
      <label>Category</label>
      <select id="fBudgetCat" ${existingCat?'disabled':''}>${remaining.map(c=>`<option value="${c}" ${c===existingCat?'selected':''}>${categoryIcon(c)} ${c}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Monthly limit</label><input type="number" id="fBudgetLimit" value="${existingCat?state.budgets[existingCat]:''}" placeholder="0"></div>
    <button class="btn-block" id="fBudgetSubmit">${existingCat?'Save changes':'Set budget'}</button>
  `;
  openModal(existingCat?'Edit budget':'Set a budget', html, (body)=>{
    body.querySelector('#fBudgetSubmit').addEventListener('click', ()=>{
      const cat = existingCat || body.querySelector('#fBudgetCat').value;
      const limit = Number(body.querySelector('#fBudgetLimit').value);
      if(!limit || limit<=0){ toast('Enter a valid amount'); return; }
      state.budgets[cat] = limit;
      saveState(); closeModal(); toast('Saved'); renderBudgetsPage();
    });
  });
}

/* ================= RECURRING ================= */
function processRecurring(){
  const todayDay = new Date().getDate();
  const mk = monthKey(todayISO());
  let changed = false;
  state.recurring.forEach(r=>{
    if(r.lastRunMonth===mk) return;
    if(todayDay < r.day) return;
    if(r.type==='expense'){
      applyExpensePayment(r.ref, r.amount);
      state.transactions.push({
        id: uid(), type:'expense', amount:r.amount, category:r.category,
        description: (r.description?r.description+' ':'') + '(auto)', date: todayISO(),
        ref:r.ref, sourceOrNote: payerLabel(r.ref), meta:{ recurringId: r.id }
      });
    } else {
      const acc = getAccount(r.ref.id);
      if(acc){
        acc.balance += r.amount;
        state.transactions.push({
          id: uid(), type:'income', amount:r.amount, category:r.category,
          description: (r.description?r.description+' ':'') + '(auto)', date: todayISO(),
          ref:r.ref, sourceOrNote: payerLabel(r.ref), meta:{ recurringId: r.id }
        });
      }
    }
    r.lastRunMonth = mk;
    changed = true;
  });
  if(changed){ saveState(); toast('Recurring transactions for this month were added'); }
}

function renderRecurringPage(){
  document.getElementById('recurringList').innerHTML = state.recurring.length ? state.recurring.map(r=>`
    <div class="item-card">
      <div class="ic-top">
        <div><div class="ic-name">${categoryIcon(r.category)} ${escapeHtml(r.category)}</div><div class="ic-sub">${escapeHtml(r.description||'')} · day ${r.day} · ${escapeHtml(payerLabel(r.ref))}</div></div>
        <div><div class="ic-amount ${r.type==='income'?'credit':'debit'}">${r.type==='income'?'+':'−'}${formatCurrency(r.amount)}</div></div>
      </div>
      <div class="ic-actions"><button data-edit-rec="${r.id}">Edit</button><button class="rust" data-del-rec="${r.id}">Delete</button></div>
    </div>`).join('') : emptyNote('Nothing scheduled yet — add rent, SIPs, or subscriptions here.');

  bindOnce(document.getElementById('recurringList'),'click',(e)=>{
    const ed = e.target.closest('[data-edit-rec]'); if(ed) return openRecurringModal(state.recurring.find(r=>r.id===ed.dataset.editRec));
    const del = e.target.closest('[data-del-rec]');
    if(del && confirm('Delete this recurring item?')){ state.recurring = state.recurring.filter(r=>r.id!==del.dataset.delRec); saveState(); renderRecurringPage(); }
  });
}

document.getElementById('openAddRecurring').addEventListener('click', ()=>openRecurringModal());
function openRecurringModal(existing){
  if(state.accounts.length===0 && state.creditCards.length===0){ toast('Add a bank account or card first'); return; }
  const html = `
    <div class="field">
      <label>Type</label>
      <select id="fRecType">
        <option value="expense" ${existing&&existing.type==='expense'?'selected':''}>Expense</option>
        <option value="income" ${existing&&existing.type==='income'?'selected':''}>Income</option>
      </select>
    </div>
    <div class="field"><label>Category</label><select id="fRecCategory"></select></div>
    <div class="field"><label>Amount</label><input type="number" id="fRecAmount" value="${existing?existing.amount:''}" placeholder="0"></div>
    <div class="field"><label>Note <span style="color:var(--text-faint)">(optional)</span></label><input id="fRecDesc" value="${existing?escapeHtml(existing.description||''):''}" placeholder="e.g. Netflix"></div>
    <div class="field-row">
      <div class="field"><label id="fRecRefLabel">Account / card</label><select id="fRecRef"></select></div>
      <div class="field"><label>Day of month</label><input type="number" min="1" max="31" id="fRecDay" value="${existing?existing.day:''}" placeholder="e.g. 1"></div>
    </div>
    <button class="btn-block" id="fRecSubmit">${existing?'Save changes':'Add recurring'}</button>
  `;
  openModal(existing?'Edit recurring':'Add recurring', html, (body)=>{
    const typeSel = body.querySelector('#fRecType');
    const catSel = body.querySelector('#fRecCategory');
    const refSel = body.querySelector('#fRecRef');
    function refreshForType(){
      const isIncome = typeSel.value==='income';
      catSel.innerHTML = (isIncome? state.incomeSources : EXPENSE_CATEGORIES).map(c=>`<option value="${c}" ${existing&&existing.category===c?'selected':''}>${c}</option>`).join('');
      refSel.innerHTML = isIncome ? accountOptionsOnly() : accountCardOptions(true);
      if(existing && existing.ref){ refSel.value = `${existing.ref.kind}:${existing.ref.id}`; }
    }
    typeSel.addEventListener('change', refreshForType);
    refreshForType();

    body.querySelector('#fRecSubmit').addEventListener('click', ()=>{
      const amount = Number(body.querySelector('#fRecAmount').value);
      if(!amount || amount<=0){ toast('Enter a valid amount'); return; }
      const day = Math.min(31, Math.max(1, Number(body.querySelector('#fRecDay').value)||1));
      const type = typeSel.value;
      let ref;
      if(type==='income'){ ref = { kind:'account', id: refSel.value }; }
      else { const [kind,id] = refSel.value.split(':'); ref = { kind, id }; }
      const data = { type, amount, category: catSel.value, description: body.querySelector('#fRecDesc').value.trim(), ref, day };
      if(existing){ Object.assign(existing, data); }
      else { state.recurring.push({ id: uid(), lastRunMonth:'', ...data }); }
      saveState(); closeModal(); toast('Saved'); renderRecurringPage();
    });
  });
}

/* ================= SETTINGS ================= */
document.getElementById('exportBtn').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ledger-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
});
document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!confirm('This will replace all current data with the backup. Continue?')) return;
      state = { ...defaultState(), ...parsed, investments: { ...defaultState().investments, ...(parsed.investments||{}) } };
      saveState();
      toast('Backup restored');
      goTo('dashboard');
    }catch(err){ toast('That file could not be read as a backup'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
document.getElementById('resetBtn').addEventListener('click', ()=>{
  if(confirm('This permanently deletes everything in this app on this device. Continue?')){
    state = defaultState();
    saveState();
    toast('All data cleared');
    goTo('dashboard');
  }
});

/* ================= INIT ================= */
document.getElementById('settingsBtn').addEventListener('click', ()=> goTo('settings'));
processRecurring();
goTo('dashboard');
