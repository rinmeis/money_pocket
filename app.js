/* ══════════════════════════
   DATA
══════════════════════════ */
const VERSION = 'ver.1.0.0';
const TODAY = new Date();
TODAY.setHours(0,0,0,0);

const DEFAULT_CATEGORIES = [
  // 支出
  { id: 'c1', name: '食費',   type: 'expense' },
  { id: 'c2', name: '日用品', type: 'expense' },
  { id: 'c3', name: '交通',   type: 'expense' },
  { id: 'c4', name: '娯楽',   type: 'expense' },
  { id: 'c5', name: '固定費', type: 'expense' },
  { id: 'c6', name: '医療',   type: 'expense' },
  { id: 'c7', name: 'その他（支出）', type: 'expense' },
  // 収入
  { id: 'c8',  name: '給料', type: 'income' },
  { id: 'c9',  name: '副業', type: 'income' },
  { id: 'c10', name: 'その他（収入）', type: 'income' },
];

let transactions = [];
let categories = [];
let budgets = {};

try { transactions = JSON.parse(localStorage.getItem('mp_transactions') || '[]'); } catch(e) { transactions = []; }
try {
  const raw = localStorage.getItem('mp_categories');
  categories = raw ? JSON.parse(raw) : DEFAULT_CATEGORIES.slice();
} catch(e) { categories = DEFAULT_CATEGORIES.slice(); }
try { budgets = JSON.parse(localStorage.getItem('mp_budgets') || '{}'); } catch(e) { budgets = {}; }

function persist() {
  try {
    localStorage.setItem('mp_transactions', JSON.stringify(transactions));
    localStorage.setItem('mp_categories',   JSON.stringify(categories));
    localStorage.setItem('mp_budgets',      JSON.stringify(budgets));
  } catch(e) {}
}

/* ══════════════════════════
   HELPERS
══════════════════════════ */
function fmt(d) {
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function parseDateStr(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function dayLabel(dateStr) {
  const d = parseDateStr(dateStr);
  const DOW = ['日','月','火','水','木','金','土'];
  const p = dateStr.split('-');
  return p[0]+'年'+parseInt(p[1])+'月'+parseInt(p[2])+'日('+DOW[d.getDay()]+')';
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function yen(n) {
  // 表示用：丸めて3桁カンマ区切り
  const r = Math.round(Number(n) || 0);
  return r.toLocaleString('ja-JP');
}
function lockScroll()   { document.body.style.overflow = 'hidden'; }
function unlockScroll() { document.body.style.overflow = ''; }

function findCategory(name, type) {
  // 同名カテゴリが収入/支出両方に存在する可能性は低いが、type指定があれば絞る
  return categories.find(c => c.name === name && (!type || c.type === type));
}
function categoryType(name) {
  const c = categories.find(c => c.name === name);
  return c ? c.type : 'expense';
}

/* ══════════════════════════
   STATE
══════════════════════════ */
let currentView = 'month';   // 'month' | 'day'
let calCursor   = new Date(TODAY);  // 月表示用カーソル
let dayCursor   = new Date(TODAY);  // 日表示用カーソル
let statsCursor = new Date(TODAY);  // 集計画面用カーソル
let statsType   = 'expense';        // 'expense' | 'income'
let editingTxnId = null;            // 編集中の取引id（nullなら新規）
let newCatType   = 'expense';       // 新規カテゴリ追加時のトグル状態(txn-modal内)
let catAddType   = 'expense';       // カテゴリ管理画面の追加トグル状態

function dayCursorStr() { return fmt(dayCursor); }

/* ══════════════════════════
   TAB SWITCHING
══════════════════════════ */
function switchTab(t) {
  ['calendar','stats','budget'].forEach(s => {
    document.getElementById('screen-'+s).classList.toggle('active', s===t);
  });
  document.querySelectorAll('.tab').forEach((el,i) => {
    el.classList.toggle('active', ['calendar','stats','budget'][i]===t);
  });
  document.getElementById('header-title').textContent = {calendar:'カレンダー',stats:'集計',budget:'予算'}[t];
  if (t==='calendar') renderCurrentView();
  if (t==='stats')    renderStats();
  if (t==='budget')   renderBudget();
}

/* ══════════════════════════
   VIEW SWITCHING (月/日)
══════════════════════════ */
function setView(v) {
  currentView = v;
  ['month','day'].forEach(x => {
    document.getElementById('vbtn-'+x).classList.toggle('active', x===v);
  });
  document.getElementById('view-month').style.display = v==='month' ? 'flex' : 'none';
  document.getElementById('view-day').style.display   = v==='day'   ? 'flex' : 'none';
  renderCurrentView();
}
function navBack() {
  if (currentView==='month') calCursor.setMonth(calCursor.getMonth()-1);
  else dayCursor.setDate(dayCursor.getDate()-1);
  renderCurrentView();
}
function navFwd() {
  if (currentView==='month') calCursor.setMonth(calCursor.getMonth()+1);
  else dayCursor.setDate(dayCursor.getDate()+1);
  renderCurrentView();
}
function renderCurrentView() {
  if (currentView==='month') renderMonth();
  else renderDay();
}

/* ══════════════════════════
   月別データ集計
══════════════════════════ */
function txnsOn(dateStr) {
  return transactions.filter(t => t.date === dateStr);
}
function txnsInMonth(y, m) {
  // m は 0-indexed
  const prefix = y+'-'+String(m+1).padStart(2,'0');
  return transactions.filter(t => t.date.startsWith(prefix));
}
function sumByType(list, type) {
  return list.filter(t => t.type===type).reduce((s,t) => s + (Number(t.amount)||0), 0);
}

/* ══════════════════════════
   MONTHLY VIEW
══════════════════════════ */
function renderMonth() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  document.getElementById('cal-nav-label').textContent = y+'年'+(m+1)+'月';
  const fd = new Date(y, m, 1).getDay();
  const ld = new Date(y, m+1, 0).getDate();
  const pl = new Date(y, m, 0).getDate();
  let h = '';
  for (let i = 0; i < fd; i++) {
    const d = pl - fd + 1 + i;
    const pm = m === 0 ? 12 : m;
    const py = m === 0 ? y-1 : y;
    const k = py+'-'+String(pm).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    h += monthCell(d, k, true);
  }
  for (let d = 1; d <= ld; d++) {
    const k = y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dw = (fd+d-1)%7;
    const isT = fmt(TODAY)===k;
    const cls = [isT?'today':'', dw===0?'sun':dw===6?'sat':''].filter(Boolean).join(' ');
    h += monthCell(d, k, false, cls);
  }
  const rem = (7-((fd+ld)%7))%7;
  for (let i = 1; i <= rem; i++) {
    const nm = m === 11 ? 1 : m+2;
    const ny = m === 11 ? y+1 : y;
    const k = ny+'-'+String(nm).padStart(2,'0')+'-'+String(i).padStart(2,'0');
    h += monthCell(i, k, true);
  }
  document.getElementById('cal-body-month').innerHTML = h;
  bindCellPressHandlers();
  renderMonthSummary(y, m);
}

function monthCell(d, k, other, extra='') {
  const list = txnsOn(k);
  const inc = sumByType(list, 'income');
  const exp = sumByType(list, 'expense');
  let amtHtml = '';
  if (inc > 0) amtHtml += `<div class="cal-amt income">+${yen(inc)}</div>`;
  if (exp > 0) amtHtml += `<div class="cal-amt expense">-${yen(exp)}</div>`;
  const cls = ['cal-cell', other?'other':'', extra].filter(Boolean).join(' ');
  return `<div class="${cls}" data-date="${k}">
    <div class="dnum">${d}</div>${amtHtml}
  </div>`;
}

function renderMonthSummary(y, m) {
  const list = txnsInMonth(y, m);
  const inc = sumByType(list, 'income');
  const exp = sumByType(list, 'expense');
  const diff = inc - exp;
  const diffCls = diff < 0 ? 'minus' : 'plus';
  document.getElementById('month-summary-panel').innerHTML = `
    <div class="today-panel-title">月の合計</div>
    <div class="summary-card">
      <div class="summary-item">
        <div class="summary-item-label">収入</div>
        <div class="summary-item-val income">¥${yen(inc)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-item-label">支出</div>
        <div class="summary-item-val expense">¥${yen(exp)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-item-label">収支</div>
        <div class="summary-item-val ${diffCls}">${diff<0?'-':'+'}¥${yen(Math.abs(diff))}</div>
      </div>
    </div>`;
}

/* ══════════════════════════
   日付セルの 短タップ/長押し 判定
   pointerdown→pointerup の経過時間で判定。
   500ms以上＝長押し→日表示へ。未満＝短タップ→入力モーダル。
   pointermoveで一定距離動いたらキャンセル(スクロール誤爆防止)。
══════════════════════════ */
const LONGPRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

function bindCellPressHandlers() {
  document.querySelectorAll('#cal-body-month .cal-cell').forEach(cell => {
    let timer = null;
    let startX = 0, startY = 0;
    let longPressed = false;
    let canceled = false;

    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

    cell.addEventListener('pointerdown', (e) => {
      longPressed = false;
      canceled = false;
      startX = e.clientX; startY = e.clientY;
      cell.classList.add('pressing');
      timer = setTimeout(() => {
        longPressed = true;
        cell.classList.remove('pressing');
        const k = cell.getAttribute('data-date');
        dayCursor = parseDateStr(k);
        setView('day');
      }, LONGPRESS_MS);
    });

    cell.addEventListener('pointermove', (e) => {
      if (canceled) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.sqrt(dx*dx + dy*dy) > MOVE_CANCEL_PX) {
        canceled = true;
        clearTimer();
        cell.classList.remove('pressing');
      }
    });

    cell.addEventListener('pointerup', () => {
      clearTimer();
      cell.classList.remove('pressing');
      if (!longPressed && !canceled) {
        const k = cell.getAttribute('data-date');
        openAddModal(k);
      }
    });

    cell.addEventListener('pointercancel', () => {
      clearTimer();
      cell.classList.remove('pressing');
    });
    cell.addEventListener('pointerleave', () => {
      clearTimer();
      cell.classList.remove('pressing');
    });
  });
}

/* ══════════════════════════
   DAILY VIEW
══════════════════════════ */
function renderDay() {
  const dStr = fmt(dayCursor);
  document.getElementById('cal-nav-label').textContent = dayLabel(dStr);
  document.getElementById('day-head-label').textContent = dayLabel(dStr);

  const list = txnsOn(dStr).slice().sort((a,b) => (b.id||'').localeCompare(a.id||''));
  const listEl = document.getElementById('day-list');
  if (!list.length) {
    listEl.innerHTML = `<div class="day-empty">この日の記録はありません</div>`;
  } else {
    listEl.innerHTML = list.map(t => {
      const sign = t.type === 'income' ? '+' : '-';
      return `<div class="day-row-item" onclick="openEditModal('${t.id}')">
        <div class="day-row-cat">${escHtml(t.category)}</div>
        <div class="day-row-memo">${escHtml(t.memo || '')}</div>
        <div class="day-row-amt ${t.type}">${sign}¥${yen(t.amount)}</div>
      </div>`;
    }).join('');
  }

  const inc = sumByType(list, 'income');
  const exp = sumByType(list, 'expense');
  document.getElementById('day-summary-panel').innerHTML = `
    <div class="summary-item">
      <div class="summary-item-label">収入小計</div>
      <div class="summary-item-val income">¥${yen(inc)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-item-label">支出小計</div>
      <div class="summary-item-val expense">¥${yen(exp)}</div>
    </div>`;
}

/* ══════════════════════════
   取引 入力/編集 モーダル
══════════════════════════ */
function buildCategorySelectOptions(selectedName) {
  const expenseCats = categories.filter(c => c.type === 'expense');
  const incomeCats  = categories.filter(c => c.type === 'income');
  let h = '';
  h += `<optgroup label="支出">`;
  expenseCats.forEach(c => {
    h += `<option value="${escHtml(c.name)}"${c.name===selectedName?' selected':''}>${escHtml(c.name)}</option>`;
  });
  h += `</optgroup>`;
  h += `<optgroup label="収入">`;
  incomeCats.forEach(c => {
    h += `<option value="${escHtml(c.name)}"${c.name===selectedName?' selected':''}>${escHtml(c.name)}</option>`;
  });
  h += `</optgroup>`;
  h += `<option value="__new__">＋ 新しいカテゴリを追加</option>`;
  return h;
}

function openAddModal(dateStr) {
  editingTxnId = null;
  document.getElementById('txn-modal-title').textContent = '記録を追加';
  document.getElementById('txn-date').value = dateStr || fmt(TODAY);
  document.getElementById('txn-memo').value = '';
  document.getElementById('txn-amount').value = '';
  document.getElementById('txn-category').innerHTML = buildCategorySelectOptions(null);
  hideNewCatRow();
  renderTxnModalActions();
  lockScroll();
  document.getElementById('txn-modal').classList.add('open');
}

function openEditModal(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  editingTxnId = id;
  document.getElementById('txn-modal-title').textContent = '記録を編集';
  document.getElementById('txn-date').value = t.date;
  document.getElementById('txn-memo').value = t.memo || '';
  document.getElementById('txn-amount').value = t.amount;
  document.getElementById('txn-category').innerHTML = buildCategorySelectOptions(t.category);
  hideNewCatRow();
  renderTxnModalActions();
  lockScroll();
  document.getElementById('txn-modal').classList.add('open');
}

function renderTxnModalActions() {
  const actions = document.getElementById('txn-modal-actions');
  if (editingTxnId) {
    actions.innerHTML = `
      <button class="btn-delete" onclick="deleteTxn()">削除</button>
      <button class="btn-cancel" onclick="closeTxnModal()">キャンセル</button>
      <button class="btn-save" onclick="saveTxn()">保存</button>`;
  } else {
    actions.innerHTML = `
      <button class="btn-cancel" onclick="closeTxnModal()">キャンセル</button>
      <button class="btn-save" onclick="saveTxn()">保存</button>`;
  }
}

function closeTxnModal() {
  document.getElementById('txn-modal').classList.remove('open');
  unlockScroll();
  editingTxnId = null;
  hideNewCatRow();
}

function onCategorySelectChange() {
  const sel = document.getElementById('txn-category');
  if (sel.value === '__new__') {
    showNewCatRow();
  } else {
    hideNewCatRow();
  }
}

function showNewCatRow() {
  newCatType = 'expense';
  document.getElementById('new-cat-name').value = '';
  document.getElementById('new-cat-toggle').classList.remove('on');
  document.getElementById('new-cat-row').style.display = 'block';
}
function hideNewCatRow() {
  document.getElementById('new-cat-row').style.display = 'none';
}
function toggleNewCatType() {
  newCatType = newCatType === 'expense' ? 'income' : 'expense';
  document.getElementById('new-cat-toggle').classList.toggle('on', newCatType === 'income');
}
function cancelNewCat() {
  hideNewCatRow();
  document.getElementById('txn-category').value = categories.find(c=>c.type==='expense') ? categories.find(c=>c.type==='expense').name : '';
}
function confirmNewCat() {
  const name = document.getElementById('new-cat-name').value.trim();
  if (!name) { alert('カテゴリ名を入力してください'); return; }
  if (categories.some(c => c.name === name)) { alert('同じ名前のカテゴリが既にあります'); return; }
  const cat = { id: 'c' + Date.now(), name, type: newCatType };
  categories.push(cat);
  persist();
  const sel = document.getElementById('txn-category');
  sel.innerHTML = buildCategorySelectOptions(name);
  hideNewCatRow();
}

function saveTxn() {
  const date = document.getElementById('txn-date').value;
  const memo = document.getElementById('txn-memo').value.trim();
  const amountRaw = document.getElementById('txn-amount').value;
  const category = document.getElementById('txn-category').value;

  if (!date) { alert('日付を入力してください'); return; }
  if (category === '__new__' || !category) { alert('カテゴリを選択してください'); return; }
  const amount = Math.round(Number(amountRaw));
  if (!amount || amount <= 0 || isNaN(amount)) { alert('金額を正しく入力してください'); return; }

  const type = categoryType(category);

  if (editingTxnId) {
    const t = transactions.find(x => x.id === editingTxnId);
    if (t) {
      t.date = date; t.memo = memo; t.amount = amount; t.category = category; t.type = type;
    }
  } else {
    transactions.push({
      id: 't' + Date.now() + Math.random().toString(36).slice(2,7),
      date, amount, type, category, memo
    });
  }
  persist();
  closeTxnModal();
  renderCurrentView();
}

function deleteTxn() {
  if (!editingTxnId) return;
  if (!confirm('この記録を削除しますか？')) return;
  transactions = transactions.filter(t => t.id !== editingTxnId);
  persist();
  closeTxnModal();
  renderCurrentView();
}

/* ══════════════════════════
   集計画面（カテゴリ別 横棒グラフ）
══════════════════════════ */
function setStatsType(t) {
  statsType = t;
  document.getElementById('stats-btn-expense').classList.toggle('active', t==='expense');
  document.getElementById('stats-btn-income').classList.toggle('active', t==='income');
  renderStats();
}
function statsNavBack() { statsCursor.setMonth(statsCursor.getMonth()-1); renderStats(); }
function statsNavFwd()  { statsCursor.setMonth(statsCursor.getMonth()+1); renderStats(); }

function renderStats() {
  const y = statsCursor.getFullYear(), m = statsCursor.getMonth();
  document.getElementById('stats-nav-label').textContent = y+'年'+(m+1)+'月';

  const list = txnsInMonth(y, m);
  const totalInc = sumByType(list, 'income');
  const totalExp = sumByType(list, 'expense');
  document.getElementById('stats-total-card').innerHTML = `
    <div class="summary-item">
      <div class="summary-item-label">総収入</div>
      <div class="summary-item-val income">¥${yen(totalInc)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-item-label">総支出</div>
      <div class="summary-item-val expense">¥${yen(totalExp)}</div>
    </div>`;

  const targetList = list.filter(t => t.type === statsType);
  const byCat = {};
  targetList.forEach(t => { byCat[t.category] = (byCat[t.category]||0) + (Number(t.amount)||0); });
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const total = entries.reduce((s,[,v]) => s+v, 0);

  const barsEl = document.getElementById('stats-bars');
  if (!entries.length) {
    barsEl.innerHTML = `<div class="stats-empty">この月の${statsType==='expense'?'支出':'収入'}記録はありません</div>`;
    return;
  }
  barsEl.innerHTML = entries.map(([name, amt]) => {
    const pct = total > 0 ? (amt/total*100) : 0;
    return `<div class="bar-row">
      <div class="bar-row-top">
        <span class="bar-row-name">${escHtml(name)}</span>
        <span class="bar-row-amt">¥${yen(amt)}（${pct.toFixed(1)}%）</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${statsType}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

/* ══════════════════════════
   予算画面
══════════════════════════ */
function renderBudget() {
  const now = new Date();
  document.getElementById('budget-month-label').textContent = now.getFullYear()+'年'+(now.getMonth()+1)+'月の予算';

  const list = txnsInMonth(now.getFullYear(), now.getMonth()).filter(t => t.type === 'expense');
  const usedByCat = {};
  list.forEach(t => { usedByCat[t.category] = (usedByCat[t.category]||0) + (Number(t.amount)||0); });

  const expenseCats = categories.filter(c => c.type === 'expense');
  const listEl = document.getElementById('budget-list');
  if (!expenseCats.length) {
    listEl.innerHTML = `<div class="cat-empty">支出カテゴリがありません</div>`;
    return;
  }
  listEl.innerHTML = expenseCats.map(c => {
    const limit = budgets[c.name];
    const used = usedByCat[c.name] || 0;
    let statusHtml, fillPct, fillCls = '';
    if (limit === undefined || limit === null || limit === '' || isNaN(limit) || Number(limit) <= 0) {
      statusHtml = `<span class="budget-status unset">上限が未設定です。設定すると進捗が表示されます</span>`;
      fillPct = 0;
    } else {
      const lim = Number(limit);
      const remain = lim - used;
      fillPct = Math.min(100, (used/lim*100));
      if (remain < 0) {
        fillCls = 'over';
        statusHtml = `<span class="budget-status over">超過 ¥${yen(Math.abs(remain))}</span>`;
      } else {
        statusHtml = `<span class="budget-status">あと ¥${yen(remain)}</span>`;
      }
    }
    return `<div class="budget-card">
      <div class="budget-card-top">
        <span class="budget-card-name">${escHtml(c.name)}</span>
        <span style="font-size:12px;color:var(--text2)">¥${yen(used)} 使用</span>
      </div>
      <div class="budget-input-row">
        <span class="yen-prefix">¥</span>
        <input class="form-input" type="number" inputmode="numeric" placeholder="上限額を設定"
          value="${limit !== undefined && limit !== null ? limit : ''}"
          onchange="setBudget('${c.id}', this.value)">
      </div>
      <div class="budget-track"><div class="budget-fill ${fillCls}" style="width:${fillPct}%"></div></div>
      ${statusHtml}
    </div>`;
  }).join('');
}

function setBudget(catId, value) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  const num = Number(value);
  if (value === '' || isNaN(num) || num < 0) {
    delete budgets[cat.name];
  } else {
    budgets[cat.name] = Math.round(num);
  }
  persist();
  renderBudget();
}

/* ══════════════════════════
   設定モーダル
══════════════════════════ */
function openSettings() {
  lockScroll();
  document.getElementById('settings-modal').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
  unlockScroll();
}

/* ══════════════════════════
   カテゴリ管理モーダル
══════════════════════════ */
function openCategoryManager() {
  renderCategoryManager();
  document.getElementById('category-modal').classList.add('open');
}
function closeCategoryManager() {
  document.getElementById('category-modal').classList.remove('open');
}

function renderCategoryManager() {
  const expenseCats = categories.filter(c => c.type === 'expense');
  const incomeCats  = categories.filter(c => c.type === 'income');

  const cardHtml = (c) => `
    <div class="cat-card">
      <span class="cat-card-name">${escHtml(c.name)}</span>
      <button class="cat-card-del" onclick="deleteCategory('${c.id}')" title="削除"><i class="ti ti-x"></i></button>
    </div>`;

  document.getElementById('cat-list-expense').innerHTML = expenseCats.length
    ? expenseCats.map(cardHtml).join('')
    : `<div class="cat-empty">支出カテゴリがありません</div>`;
  document.getElementById('cat-list-income').innerHTML = incomeCats.length
    ? incomeCats.map(cardHtml).join('')
    : `<div class="cat-empty">収入カテゴリがありません</div>`;

  document.getElementById('cat-add-name').value = '';
  catAddType = 'expense';
  document.getElementById('cat-add-toggle').classList.remove('on');
}

function toggleCatAddType() {
  catAddType = catAddType === 'expense' ? 'income' : 'expense';
  document.getElementById('cat-add-toggle').classList.toggle('on', catAddType === 'income');
}

function addCategoryFromManager() {
  const name = document.getElementById('cat-add-name').value.trim();
  if (!name) { alert('カテゴリ名を入力してください'); return; }
  if (categories.some(c => c.name === name)) { alert('同じ名前のカテゴリが既にあります'); return; }
  categories.push({ id: 'c' + Date.now(), name, type: catAddType });
  persist();
  renderCategoryManager();
}

function deleteCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  // 過去取引はカテゴリ名を文字列で保持しているため、削除しても記録・集計は壊れない
  if (!confirm('「'+cat.name+'」を削除しますか？\n過去の記録は名前として残ります')) return;
  categories = categories.filter(c => c.id !== id);
  delete budgets[cat.name];
  persist();
  renderCategoryManager();
}

/* ══════════════════════════
   データ エクスポート/インポート
══════════════════════════ */
function exportData() {
  const data = { transactions, categories, budgets, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'money_pocket-backup-' + fmt(new Date()) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('現在のデータを上書きしてインポートしますか？\n※この操作は元に戻せません')) return;
      if (Array.isArray(data.transactions)) transactions = data.transactions;
      if (Array.isArray(data.categories))   categories   = data.categories;
      if (data.budgets && typeof data.budgets === 'object') budgets = data.budgets;
      persist();
      renderCurrentView();
      closeSettings();
      alert('インポートが完了しました');
    } catch(err) {
      alert('ファイルの読み込みに失敗しました。正しいバックアップファイルか確認してください。');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

/* ══════════════════════════
   INIT
══════════════════════════ */
document.getElementById('header-ver').textContent = VERSION;
renderMonth();
