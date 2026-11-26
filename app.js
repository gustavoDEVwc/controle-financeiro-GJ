import { auth, db, appId } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// =========================================================================
// CONFIGURAÇÕES PADRÃO (SINCRONIZADAS NO FIRESTORE)
// =========================================================================
const COLOR_PALETTE = [
  "#F97316", "#3B82F6", "#8B5CF6", "#EF4444", "#EC4899",
  "#06B6D4", "#F59E0B", "#6366F1", "#10B981", "#14B8A6",
  "#E11D48", "#84CC16", "#64748B"
];

const DEFAULT_CATEGORIES = [
  { name: "Alimentação", color: "#F97316", icon: "utensils" },
  { name: "Moradia", color: "#3B82F6", icon: "home" },
  { name: "Transporte", color: "#8B5CF6", icon: "car" },
  { name: "Saúde", color: "#EF4444", icon: "heart-pulse" },
  { name: "Lazer", color: "#EC4899", icon: "sparkles" },
  { name: "Educação", color: "#06B6D4", icon: "graduation-cap" },
  { name: "Compras", color: "#F59E0B", icon: "shopping-bag" },
  { name: "Contas/Assinaturas", color: "#6366F1", icon: "receipt" },
  { name: "Salário/Renda", color: "#10B981", icon: "banknote" },
  { name: "Outros", color: "#64748B", icon: "tag" }
];

const DEFAULT_SETTINGS = {
  categories: DEFAULT_CATEGORIES,
  paymentMethods: ["Pix", "Crédito", "Débito", "Dinheiro"],
  accountLabels: {
    Conjunta: "Conta Conjunta",
    Gustavo: "Conta Gustavo",
    Jessica: "Conta Jessica"
  },
  defaultAccount: "Conjunta",
  defaultPayment: "Pix"
};

// Referências Firestore
const getTransactionsCollection = () =>
  collection(db, "artifacts", appId, "public", "data", "couple_transactions");

const getSettingsDocRef = () =>
  doc(db, "artifacts", appId, "public", "data", "couple_settings", "config");

// =========================================================================
// ESTADO GLOBAL DO APLICATIVO
// =========================================================================
const state = {
  user: null,
 
  transactions: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth(),
  filterAccount: "Todas",
  filterCategory: "Todas",
  activeTab: "dashboard",
  hideValues: false,
  formType: "expense",
  formAccount: "Conjunta",
  formPayment: "Pix",
  pendingDeleteTx: null,
  pieChartInstance: null,
  unsubscribeTx: null,
  unsubscribeSettings: null
};

// =========================================================================
// AUTENTICAÇÃO
// =========================================================================
function initAuth() {
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    if (user) {
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("settings-user-email").textContent =
        user.email || user.displayName || "Sessão Ativa do Casal";
      subscribeToData();
    } else {
      if (state.unsubscribeTx) state.unsubscribeTx();
      if (state.unsubscribeSettings) state.unsubscribeSettings();
      document.getElementById("auth-screen").classList.remove("hidden");
    }
  });
}




window.handleAuthSubmit = async (e) => {
  e.preventDefault();

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errorBox = document.getElementById("auth-error");
  const btn = document.getElementById("auth-submit-btn");

  errorBox.classList.add("hidden");
  btn.disabled = true;
  btn.classList.add("opacity-70");

  try {
    await signInWithEmailAndPassword(auth, email, password);

    showToast("Bem-vindos ao controle financeiro!");

  } catch (error) {
    console.error("Erro auth:", error.code, error.message);

    let msg;

    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-email":
        msg = "E-mail ou senha incorretos.";
        break;

      case "auth/permission-denied-on-the-service":
      case "auth/unauthorized-domain":
      case "auth/app-not-authorized":
        msg = "Acesso bloqueado pela configuração de segurança.";
        break;

      case "auth/too-many-requests":
        msg = "Muitas tentativas. Tente novamente mais tarde.";
        break;

      case "auth/network-request-failed":
        msg = "Verifique sua conexão com a internet.";
        break;

      case "auth/user-disabled":
        msg = "Esta conta está desativada.";
        break;

      default:
        msg = `Não foi possível autenticar (${error.code || "erro"}).`;
    }

    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");

  } finally {
    btn.disabled = false;
    btn.classList.remove("opacity-70");
  }
};


window.handleLogout = async () => {
  await signOut(auth);
  showToast("Você saiu da conta.");
};

// =========================================================================
// SINCRONIZAÇÃO EM TEMPO REAL (TRANSAÇÕES + CONFIGURAÇÕES)
// =========================================================================
function subscribeToData() {
  if (!state.user) return;
  if (state.unsubscribeTx) state.unsubscribeTx();
  if (state.unsubscribeSettings) state.unsubscribeSettings();

  // 1. Transações
  state.unsubscribeTx = onSnapshot(
    getTransactionsCollection(),
    (snapshot) => {
      const list = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      list.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      state.transactions = list;
      renderApp();
    },
    (error) => {
      console.error("Erro ao sincronizar transações:", error);
      showToast("Erro de conexão com o banco de dados.");
    }
  );

  // 2. Configurações compartilhadas
  state.unsubscribeSettings = onSnapshot(
    getSettingsDocRef(),
    async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        state.settings = {
          categories: Array.isArray(data.categories) && data.categories.length
            ? data.categories
            : DEFAULT_CATEGORIES,
          paymentMethods: Array.isArray(data.paymentMethods) && data.paymentMethods.length
            ? data.paymentMethods
            : DEFAULT_SETTINGS.paymentMethods,
          accountLabels: {
            ...DEFAULT_SETTINGS.accountLabels,
            ...(data.accountLabels || {})
          },
          defaultAccount: data.defaultAccount || "Conjunta",
          defaultPayment: data.defaultPayment || "Pix"
        };
      } else {
        await setDoc(getSettingsDocRef(), DEFAULT_SETTINGS);
        state.settings = structuredClone(DEFAULT_SETTINGS);
      }
      syncSettingsToUI();
      renderApp();
    },
    (error) => {
      console.error("Erro ao sincronizar configurações:", error);
    }
  );
}

async function persistSettings() {
  try {
    await setDoc(getSettingsDocRef(), state.settings, { merge: true });
  } catch (err) {
    console.error("Erro ao salvar configurações:", err);
    showToast("Erro ao salvar ajustes.");
  }
}

// =========================================================================
// SINCRONIZAR CONFIGURAÇÕES NA INTERFACE
// =========================================================================
function syncSettingsToUI() {
  const { categories, paymentMethods, accountLabels, defaultAccount, defaultPayment } = state.settings;

  // Nomes das Contas nos Cards do Dashboard
  document.getElementById("label-card-Conjunta").textContent = accountLabels.Conjunta;
  document.getElementById("label-card-Gustavo").textContent = accountLabels.Gustavo;
  document.getElementById("label-card-Jessica").textContent = accountLabels.Jessica;

  // Nomes das Contas no Modal de Lançamento
  document.getElementById("form-acc-label-Conjunta").textContent = accountLabels.Conjunta.replace(/^Conta\s+/i, "");
  document.getElementById("form-acc-label-Gustavo").textContent = accountLabels.Gustavo.replace(/^Conta\s+/i, "");
  document.getElementById("form-acc-label-Jessica").textContent = accountLabels.Jessica.replace(/^Conta\s+/i, "");

  // Filtro de Conta no Extrato
  const accFilterSel = document.getElementById("filter-account-select");
  accFilterSel.innerHTML = `
    <option value="Todas">Conta: Todas</option>
    <option value="Conjunta">${escapeHtml(accountLabels.Conjunta)}</option>
    <option value="Gustavo">${escapeHtml(accountLabels.Gustavo)}</option>
    <option value="Jessica">${escapeHtml(accountLabels.Jessica)}</option>
  `;
  accFilterSel.value = state.filterAccount;

  // Selects de Categorias (Formulário + Extrato)
  const formCatSel = document.getElementById("tx-category");
  const prevFormCat = formCatSel.value;
  formCatSel.innerHTML = categories
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
    .join("");
  if (categories.some((c) => c.name === prevFormCat)) {
    formCatSel.value = prevFormCat;
  }

  const filterCatSel = document.getElementById("filter-category-select");
  filterCatSel.innerHTML =
    `<option value="Todas">Categoria: Todas</option>` +
    categories.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  if (state.filterCategory !== "Todas" && !categories.some((c) => c.name === state.filterCategory)) {
    state.filterCategory = "Todas";
  }
  filterCatSel.value = state.filterCategory;

  renderCategoryChips();

  // Botões de Forma de Pagamento no Modal
  renderPaymentMethodButtons();

  // Inputs da Aba Configurações
  document.getElementById("cfg-label-Conjunta").value = accountLabels.Conjunta;
  document.getElementById("cfg-label-Gustavo").value = accountLabels.Gustavo;
  document.getElementById("cfg-label-Jessica").value = accountLabels.Jessica;

  const cfgDefAcc = document.getElementById("cfg-default-account");
  cfgDefAcc.innerHTML = `
    <option value="Conjunta">${escapeHtml(accountLabels.Conjunta)}</option>
    <option value="Gustavo">${escapeHtml(accountLabels.Gustavo)}</option>
    <option value="Jessica">${escapeHtml(accountLabels.Jessica)}</option>
  `;
  cfgDefAcc.value = defaultAccount;

  const cfgDefPay = document.getElementById("cfg-default-payment");
  cfgDefPay.innerHTML = paymentMethods
    .map((pm) => `<option value="${escapeHtml(pm)}">${escapeHtml(pm)}</option>`)
    .join("");
  cfgDefPay.value = paymentMethods.includes(defaultPayment) ? defaultPayment : paymentMethods[0];

  // Chips de Gerenciamento na Aba Configurações
  renderSettingsManagerChips();
  lucide.createIcons();
}

function renderSettingsManagerChips() {
  const catContainer = document.getElementById("settings-categories-chips");
  catContainer.innerHTML = state.settings.categories
    .map(
      (cat, idx) => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/80">
        <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${cat.color || "#64748B"}"></span>
        <span>${escapeHtml(cat.name)}</span>
        <button type="button" onclick="handleRemoveCategory(${idx})" aria-label="Remover"
          class="ml-0.5 w-4 h-4 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center font-bold">
          ×
        </button>
      </span>
    `
    )
    .join("");

  const payContainer = document.getElementById("settings-payments-chips");
  payContainer.innerHTML = state.settings.paymentMethods
    .map(
      (pm, idx) => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/80">
        <span>${escapeHtml(pm)}</span>
        <button type="button" onclick="handleRemovePaymentMethod(${idx})" aria-label="Remover"
          class="ml-0.5 w-4 h-4 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center font-bold">
          ×
        </button>
      </span>
    `
    )
    .join("");
}

// =========================================================================
// AÇÕES DA ABA DE CONFIGURAÇÕES
// =========================================================================
window.handleAddCategory = async () => {
  const input = document.getElementById("new-category-input");
  const name = input.value.trim();
  if (!name) return;

  const exists = state.settings.categories.some(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    showToast("Essa categoria já existe.");
    return;
  }

  const nextColor = COLOR_PALETTE[state.settings.categories.length % COLOR_PALETTE.length];
  state.settings.categories.push({ name, color: nextColor, icon: "tag" });
  input.value = "";
  await persistSettings();
  showToast("Categoria adicionada!");
};

window.handleRemoveCategory = async (index) => {
  if (state.settings.categories.length <= 1) {
    showToast("Mantenha pelo menos 1 categoria.");
    return;
  }
  state.settings.categories.splice(index, 1);
  await persistSettings();
  showToast("Categoria removida.");
};

window.handleAddPaymentMethod = async () => {
  const input = document.getElementById("new-payment-input");
  const name = input.value.trim();
  if (!name) return;

  const exists = state.settings.paymentMethods.some(
    (p) => p.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    showToast("Essa forma de pagamento já existe.");
    return;
  }

  state.settings.paymentMethods.push(name);
  input.value = "";
  await persistSettings();
  showToast("Forma de pagamento adicionada!");
};

window.handleRemovePaymentMethod = async (index) => {
  if (state.settings.paymentMethods.length <= 1) {
    showToast("Mantenha pelo menos 1 forma de pagamento.");
    return;
  }
  state.settings.paymentMethods.splice(index, 1);
  if (!state.settings.paymentMethods.includes(state.settings.defaultPayment)) {
    state.settings.defaultPayment = state.settings.paymentMethods[0];
  }
  await persistSettings();
  showToast("Forma de pagamento removida.");
};

window.handleSaveGeneralSettings = async (e) => {
  e.preventDefault();
  state.settings.accountLabels = {
    Conjunta: document.getElementById("cfg-label-Conjunta").value.trim() || "Conta Conjunta",
    Gustavo: document.getElementById("cfg-label-Gustavo").value.trim() || "Conta Gustavo",
    Jessica: document.getElementById("cfg-label-Jessica").value.trim() || "Conta Jessica"
  };
  state.settings.defaultAccount = document.getElementById("cfg-default-account").value;
  state.settings.defaultPayment = document.getElementById("cfg-default-payment").value;

  await persistSettings();
  showToast("Preferências salvas!");
};

window.exportTransactionsCSV = () => {
  if (state.transactions.length === 0) {
    showToast("Nenhum lançamento para exportar.");
    return;
  }

  const header = "Data;Tipo;Conta;Categoria;Descricao;Valor;FormaPagamento;Parcela\n";
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const accName = state.settings.accountLabels[t.account] || t.account;
      const tipoLabel = t.type === "income" ? "Entrada" : "Despesa";
      const val = Number(t.amount || 0).toFixed(2).replace(".", ",");
      const parc = t.installmentTotal > 1 ? `${t.installmentCurrent}/${t.installmentTotal}` : "1/1";
      return `${t.date};${tipoLabel};"${accName}";"${t.category}";"${(t.description || "").replace(/"/g, '""')}";${val};"${t.paymentMethod || "Pix"}";${parc}`;
    })
    .join("\n");

  const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `financas-casal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Planilha baixada!");
};

// =========================================================================
// CONTROLE DE NAVEGAÇÃO, DATAS E FILTROS
// =========================================================================
window.switchTab = (tabName) => {
  state.activeTab = tabName;
  document.getElementById("view-dashboard").classList.toggle("hidden", tabName !== "dashboard");
  document.getElementById("view-transactions").classList.toggle("hidden", tabName !== "transactions");
  document.getElementById("view-settings").classList.toggle("hidden", tabName !== "settings");

  const navIds = ["dashboard", "transactions", "settings"];
  navIds.forEach((id) => {
    const btn = document.getElementById(`nav-btn-${id}`);
    if (!btn) return;
    if (id === tabName) {
      btn.className = "flex flex-col items-center justify-center py-1 text-[#103D82] transition-colors font-bold";
    } else {
      btn.className = "flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-600 transition-colors font-semibold";
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
  renderApp();
};

window.changeMonth = (delta) => {
  let m = state.selectedMonth + delta;
  let y = state.selectedYear;
  if (m > 11) { m = 0; y++; }
  if (m < 0) { m = 11; y--; }
  state.selectedMonth = m;
  state.selectedYear = y;
  renderApp();
};

window.goToCurrentMonth = () => {
  const now = new Date();
  state.selectedYear = now.getFullYear();
  state.selectedMonth = now.getMonth();
  renderApp();
  showToast("Mês atual selecionado");
};

window.selectAccountFilter = (account) => {
  state.filterAccount = account;
  const filterSel = document.getElementById("filter-account-select");
  if (filterSel) filterSel.value = account;

  ["Todas", "Conjunta", "Gustavo", "Jessica"].forEach((acc) => {
    const card = document.getElementById(`acc-card-${acc}`);
    if (!card) return;
    if (acc === account) {
      card.classList.remove("border-transparent");
      card.classList.add("border-[#103D82]", "bg-blue-50/30");
    } else {
      card.classList.add("border-transparent");
      card.classList.remove("border-[#103D82]", "bg-blue-50/30");
    }
  });

  renderApp();
};

window.selectCategoryFilter = (category) => {
  state.filterCategory = category;
  const filterSel = document.getElementById("filter-category-select");
  if (filterSel) filterSel.value = category;
  document.getElementById("clear-cat-btn").classList.toggle("hidden", category === "Todas");
  renderCategoryChips();
  renderApp();
};

window.togglePrivacy = () => {
  state.hideValues = !state.hideValues;
  const icon = document.getElementById("privacy-icon");
  icon.setAttribute("data-lucide", state.hideValues ? "eye-off" : "eye");
  lucide.createIcons();
  renderApp();
};

// =========================================================================
// FORMATADORES E HELPERS
// =========================================================================
function formatCurrency(value) {
  if (state.hideValues) return "R$ •••••";
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function getMonthYearPrefix(year, monthIndex) {
  const mm = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${mm}`;
}

function addMonthsToDateStr(dateStr, monthsToAdd) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetMonthIndex = m - 1 + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDaysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const validDay = Math.min(d, maxDaysInTargetMonth);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(validDay).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function getCategoryMeta(catName) {
  return (
    state.settings.categories.find((c) => c.name === catName) || {
      name: catName || "Outros",
      color: "#64748B",
      icon: "tag"
    }
  );
}

function getAccountBadgeStyle(account) {
  if (account === "Gustavo") return "bg-sky-100 text-sky-700";
  if (account === "Jessica") return "bg-rose-100 text-rose-700";
  return "bg-purple-100 text-purple-700";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  document.getElementById("toast-message").textContent = message;
  toast.classList.remove("opacity-0", "-translate-y-2");
  toast.classList.add("opacity-100", "translate-y-0");
  setTimeout(() => {
    toast.classList.add("opacity-0", "-translate-y-2");
    toast.classList.remove("opacity-100", "translate-y-0");
  }, 2600);
}

// =========================================================================
// RENDERIZAÇÃO DA INTERFACE (DASHBOARD, GRÁFICO E LISTAGENS)
// =========================================================================
function renderCategoryChips() {
  const container = document.getElementById("category-filter-chips");
  const allCats = [{ name: "Todas", icon: "grid" }, ...state.settings.categories];

  container.innerHTML = allCats
    .map((cat) => {
      const active = state.filterCategory === cat.name;
      return `
        <button onclick="selectCategoryFilter('${escapeHtml(cat.name)}')"
          class="shrink-0 px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 transition-all ${
            active
              ? "bg-[#103D82] text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
          }">
          <i data-lucide="${cat.icon || "tag"}" class="w-3.5 h-3.5"></i>
          <span>${escapeHtml(cat.name)}</span>
        </button>
      `;
    })
    .join("");
  lucide.createIcons();
}

window.renderApp = () => {
  // 1. Atualiza Título do Mês/Ano
  const dateObj = new Date(state.selectedYear, state.selectedMonth, 1);
  const monthName = dateObj.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("current-month-label").textContent = monthName;

  const prefix = getMonthYearPrefix(state.selectedYear, state.selectedMonth);
  const monthTransactions = state.transactions.filter((t) => (t.date || "").startsWith(prefix));

  // 2. Calcula saldos individuais por conta no mês selecionado
  const accountTotals = {
    Todas: { income: 0, expense: 0 },
    Conjunta: { income: 0, expense: 0 },
    Gustavo: { income: 0, expense: 0 },
    Jessica: { income: 0, expense: 0 }
  };

  monthTransactions.forEach((tx) => {
    const val = Number(tx.amount) || 0;
    const acc = accountTotals[tx.account] ? tx.account : "Conjunta";
    if (tx.type === "income") {
      accountTotals.Todas.income += val;
      accountTotals[acc].income += val;
    } else {
      accountTotals.Todas.expense += val;
      accountTotals[acc].expense += val;
    }
  });

  ["Todas", "Conjunta", "Gustavo", "Jessica"].forEach((acc) => {
    const bal = accountTotals[acc].income - accountTotals[acc].expense;
    const el = document.getElementById(`bal-${acc}`);
    if (el) {
      el.textContent = formatCurrency(bal);
      el.className = `text-sm font-extrabold mt-0.5 truncate ${
        bal >= 0 ? "text-slate-800" : "text-red-600"
      }`;
    }
  });

  // 3. Atualiza Card Principal do Topo
  const activeTotals = accountTotals[state.filterAccount] || accountTotals.Todas;
  const activeBalance = activeTotals.income - activeTotals.expense;
  const labels = state.settings.accountLabels;

  const subtitleMap = {
    Todas: "Saldo do Mês (Todas as Contas)",
    Conjunta: `Saldo do Mês (${labels.Conjunta})`,
    Gustavo: `Saldo do Mês (${labels.Gustavo})`,
    Jessica: `Saldo do Mês (${labels.Jessica})`
  };
  document.getElementById("balance-subtitle").textContent = subtitleMap[state.filterAccount];
  document.getElementById("total-balance").textContent = formatCurrency(activeBalance);
  document.getElementById("total-income").textContent = formatCurrency(activeTotals.income);
  document.getElementById("total-expense").textContent = formatCurrency(activeTotals.expense);

  // 4. Filtra transações para Gráfico e Listas
  const filteredByAccount = monthTransactions.filter((tx) =>
    state.filterAccount === "Todas" ? true : tx.account === state.filterAccount
  );

  const searchTerm = (document.getElementById("search-input")?.value || "").toLowerCase().trim();

  const fullyFiltered = filteredByAccount.filter((tx) => {
    const matchCat = state.filterCategory === "Todas" ? true : tx.category === state.filterCategory;
    const matchSearch = !searchTerm
      ? true
      : (tx.description || "").toLowerCase().includes(searchTerm) ||
        (tx.paymentMethod || "").toLowerCase().includes(searchTerm) ||
        (tx.category || "").toLowerCase().includes(searchTerm);
    return matchCat && matchSearch;
  });

  // 5. Atualiza Gráfico
  renderPieChart(filteredByAccount);

  // 6. Renderiza listas
  renderTransactionsList("dashboard-recent-list", fullyFiltered.slice(0, 6));
  renderTransactionsList("full-transactions-list", fullyFiltered);
  document.getElementById("transactions-count-badge").textContent =
    `${fullyFiltered.length} ${fullyFiltered.length === 1 ? "item" : "itens"}`;
};

function renderPieChart(transactions) {
  const expenses = transactions.filter((t) => t.type === "expense");
  const totalExpense = expenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  document.getElementById("chart-total-badge").textContent = formatCurrency(totalExpense);
  const accName = state.settings.accountLabels[state.filterAccount] || state.filterAccount;
  document.getElementById("chart-subtitle").textContent =
    state.filterAccount === "Todas"
      ? "Distribuição geral do mês"
      : `${accName} neste mês`;

  const canvas = document.getElementById("expenses-pie-chart");
  const emptyState = document.getElementById("chart-empty-state");
  const legendContainer = document.getElementById("chart-legend");

  if (expenses.length === 0 || totalExpense <= 0) {
    canvas.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.classList.add("flex");
    legendContainer.innerHTML = "";
    if (state.pieChartInstance) {
      state.pieChartInstance.destroy();
      state.pieChartInstance = null;
    }
    return;
  }

  canvas.classList.remove("hidden");
  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");

  const grouped = {};
  expenses.forEach((tx) => {
    const cat = tx.category || "Outros";
    grouped[cat] = (grouped[cat] || 0) + (Number(tx.amount) || 0);
  });

  const sortedEntries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const labels = sortedEntries.map(([cat]) => cat);
  const values = sortedEntries.map(([, val]) => val);
  const colors = labels.map((cat) => getCategoryMeta(cat).color);

  if (state.pieChartInstance) {
    state.pieChartInstance.destroy();
  }

  state.pieChartInstance = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 3,
          borderColor: "#FFFFFF",
          hoverOffset: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "64%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (state.hideValues) return ` ${ctx.label}: R$ •••••`;
              const val = ctx.parsed;
              const pct = ((val / totalExpense) * 100).toFixed(1);
              return ` ${ctx.label}: ${formatCurrency(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  legendContainer.innerHTML = sortedEntries
    .map(([cat, val]) => {
      const meta = getCategoryMeta(cat);
      const pct = ((val / totalExpense) * 100).toFixed(1);
      const isSelected = state.filterCategory === cat;
      return `
        <button onclick="selectCategoryFilter('${isSelected ? "Todas" : escapeHtml(cat)}')"
          class="w-full flex items-center justify-between py-1.5 px-2 rounded-xl hover:bg-slate-50 transition-colors ${
            isSelected ? "bg-blue-50/70 ring-1 ring-[#103D82]/30" : ""
          }">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${meta.color}"></span>
            <span class="text-xs font-semibold text-slate-700 truncate">${escapeHtml(cat)}</span>
            <span class="text-[11px] font-medium text-slate-400">${pct}%</span>
          </div>
          <span class="text-xs font-bold text-slate-800 shrink-0">${formatCurrency(val)}</span>
        </button>
      `;
    })
    .join("");
}

function renderTransactionsList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center">
        <p class="text-sm font-semibold text-slate-500">Nenhum lançamento encontrado</p>
        <p class="text-xs text-slate-400 mt-1">Ajuste os filtros ou toque no botão + abaixo.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items
    .map((tx) => {
      const meta = getCategoryMeta(tx.category);
      const isIncome = tx.type === "income";
      const accBadge = getAccountBadgeStyle(tx.account);
      const accDisplay = state.settings.accountLabels[tx.account] || tx.account;
      const installmentBadge =
        tx.installmentTotal > 1
          ? `<span class="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">${tx.installmentCurrent}/${tx.installmentTotal}</span>`
          : "";

      return `
        <div class="py-3.5 flex items-center justify-between gap-3 group">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style="background-color: ${meta.color}18; color: ${meta.color}">
              <i data-lucide="${meta.icon || "tag"}" class="w-5 h-5"></i>
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(tx.description)}</p>
                ${installmentBadge}
              </div>
              <div class="flex flex-wrap items-center gap-1.5 mt-1">
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${accBadge}">
                  ${escapeHtml(accDisplay)}
                </span>
                <span class="text-[11px] text-slate-400 font-medium">
                  ${formatDisplayDate(tx.date)} • ${escapeHtml(tx.paymentMethod || "Pix")}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <div class="text-right">
              <p class="text-sm font-extrabold ${isIncome ? "text-emerald-600" : "text-red-500"}">
                ${isIncome ? "+" : "-"} ${formatCurrency(tx.amount)}
              </p>
              <p class="text-[10px] text-slate-400 font-medium">${escapeHtml(tx.category)}</p>
            </div>

            <div class="flex items-center gap-1 pl-1">
              <button onclick="openEditTransaction('${tx.id}')" aria-label="Editar lançamento"
                class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-[#103D82] flex items-center justify-center transition-colors">
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="requestDeleteTransaction('${tx.id}')" aria-label="Excluir lançamento"
                class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 flex items-center justify-center transition-colors">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  lucide.createIcons();
}

// =========================================================================
// MODAL DE ADICIONAR & EDITAR LANÇAMENTO
// =========================================================================
function renderPaymentMethodButtons() {
  const grid = document.getElementById("payment-methods-grid");
  const methods = state.settings.paymentMethods;

  grid.innerHTML = methods
    .map((m) => {
      const active = state.formPayment === m;
      return `
        <button type="button" onclick="setPaymentMethod('${escapeHtml(m)}')"
          class="py-2.5 px-2 rounded-xl border-2 font-bold text-xs truncate transition-all ${
            active
              ? "border-[#103D82] bg-navy-100/60 text-[#103D82]"
              : "border-slate-200 bg-white text-slate-600"
          }">
          ${escapeHtml(m)}
        </button>
      `;
    })
    .join("");
}

window.setTransactionType = (type) => {
  state.formType = type;
  const btnExp = document.getElementById("type-btn-expense");
  const btnInc = document.getElementById("type-btn-income");

  if (type === "expense") {
    btnExp.className =
      "py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 bg-red-500 text-white shadow-sm transition-all";
    btnInc.className =
      "py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 text-slate-600 transition-all";
  } else {
    btnInc.className =
      "py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 bg-emerald-500 text-white shadow-sm transition-all";
    btnExp.className =
      "py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 text-slate-600 transition-all";
    const incomeCat = state.settings.categories.find((c) => /sal[áa]rio|renda/i.test(c.name));
    if (incomeCat) {
      document.getElementById("tx-category").value = incomeCat.name;
    }
  }
};

window.setTransactionAccount = (account) => {
  state.formAccount = account;
  ["Conjunta", "Gustavo", "Jessica"].forEach((acc) => {
    const btn = document.getElementById(`acc-btn-${acc}`);
    if (!btn) return;
    if (acc === account) {
      btn.className =
        "tx-acc-btn py-2.5 px-2 rounded-2xl border-2 border-[#103D82] bg-navy-100/60 text-[#103D82] font-bold text-xs flex flex-col items-center gap-1 transition-all";
    } else {
      btn.className =
        "tx-acc-btn py-2.5 px-2 rounded-2xl border-2 border-slate-200 bg-white text-slate-600 font-bold text-xs flex flex-col items-center gap-1 transition-all";
    }
  });
};

window.setPaymentMethod = (method) => {
  state.formPayment = method;
  renderPaymentMethodButtons();
};

window.updateInstallmentPreview = () => {
  const count = parseInt(document.getElementById("tx-installments").value, 10) || 1;
  const amount = parseFloat(document.getElementById("tx-amount").value) || 0;
  const box = document.getElementById("installment-mode-box");
  const preview = document.getElementById("installment-preview-text");

  if (count <= 1) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  const mode = document.querySelector('input[name="installmentMode"]:checked')?.value || "divide";
  const perMonth = mode === "divide" ? amount / count : amount;
  const formatted = perMonth.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  preview.textContent = `Serão criados ${count} lançamentos de ${formatted} (1 por mês a partir da data selecionada).`;
};

window.openTransactionModal = () => {
  document.getElementById("modal-title").textContent = "Novo Lançamento";
  document.getElementById("save-tx-btn").textContent = "Salvar Lançamento";
  document.getElementById("tx-id").value = "";
  document.getElementById("tx-group-id").value = "";
  document.getElementById("tx-amount").value = "";
  document.getElementById("tx-description").value = "";
  document.getElementById("tx-category").value = state.settings.categories[0]?.name || "Outros";
  document.getElementById("tx-installments").value = "1";
  document.getElementById("installments-section").classList.remove("hidden");
  document.getElementById("installment-mode-box").classList.add("hidden");

  const now = new Date();
  const day =
    now.getFullYear() === state.selectedYear && now.getMonth() === state.selectedMonth
      ? String(now.getDate()).padStart(2, "0")
      : "01";
  const defaultDate = `${state.selectedYear}-${String(state.selectedMonth + 1).padStart(2, "0")}-${day}`;
  document.getElementById("tx-date").value = defaultDate;

  setTransactionType("expense");
  setTransactionAccount(
    state.filterAccount !== "Todas" ? state.filterAccount : state.settings.defaultAccount
  );
  setPaymentMethod(state.settings.defaultPayment);

  document.getElementById("transaction-modal").classList.remove("hidden");
};

window.openEditTransaction = (txId) => {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;

  document.getElementById("modal-title").textContent = "Editar Lançamento";
  document.getElementById("save-tx-btn").textContent = "Atualizar Lançamento";
  document.getElementById("tx-id").value = tx.id;
  document.getElementById("tx-group-id").value = tx.groupId || "";
  document.getElementById("tx-amount").value = tx.amount;
  document.getElementById("tx-description").value = tx.description;

  // Garante que a categoria exista no select mesmo se tiver sido removida nas configurações
  const catSel = document.getElementById("tx-category");
  if (![...catSel.options].some((o) => o.value === tx.category)) {
    catSel.innerHTML += `<option value="${escapeHtml(tx.category)}">${escapeHtml(tx.category)}</option>`;
  }
  catSel.value = tx.category || "Outros";
  document.getElementById("tx-date").value = tx.date;

  document.getElementById("installments-section").classList.add("hidden");

  setTransactionType(tx.type || "expense");
  setTransactionAccount(tx.account || "Conjunta");
  setPaymentMethod(tx.paymentMethod || state.settings.defaultPayment);

  document.getElementById("transaction-modal").classList.remove("hidden");
};

window.closeTransactionModal = () => {
  document.getElementById("transaction-modal").classList.add("hidden");
};

window.handleTransactionSubmit = async (e) => {
  e.preventDefault();
  if (!state.user) return;

  const btn = document.getElementById("save-tx-btn");
  btn.disabled = true;
  btn.classList.add("opacity-70");

  try {
    const editId = document.getElementById("tx-id").value;
    const rawAmount = parseFloat(document.getElementById("tx-amount").value);
    const description = document.getElementById("tx-description").value.trim();
    const category = document.getElementById("tx-category").value;
    const date = document.getElementById("tx-date").value;
    const account = state.formAccount;
    const type = state.formType;
    const paymentMethod = state.formPayment;

    if (!rawAmount || rawAmount <= 0 || !description || !date) return;

    const colRef = getTransactionsCollection();

    if (editId) {
      const docRef = doc(db, "artifacts", appId, "public", "data", "couple_transactions", editId);
      await updateDoc(docRef, {
        amount: Number(rawAmount.toFixed(2)),
        description,
        category,
        date,
        account,
        type,
        paymentMethod,
        updatedAt: Date.now()
      });
      showToast("Lançamento atualizado!");
    } else {
      const installments = parseInt(document.getElementById("tx-installments").value, 10) || 1;
      const mode = document.querySelector('input[name="installmentMode"]:checked')?.value || "divide";

      if (installments === 1) {
        await addDoc(colRef, {
          amount: Number(rawAmount.toFixed(2)),
          description,
          category,
          date,
          account,
          type,
          paymentMethod,
          installmentCurrent: 1,
          installmentTotal: 1,
          groupId: null,
          createdBy: state.user.email || state.user.uid,
          createdAt: Date.now()
        });
        showToast("Lançamento salvo!");
      } else {
        const batch = writeBatch(db);
        const groupId = crypto.randomUUID();
        const baseInstallmentValue =
          mode === "divide"
            ? Math.floor((rawAmount / installments) * 100) / 100
            : Number(rawAmount.toFixed(2));

        for (let i = 0; i < installments; i++) {
          let currentAmount = baseInstallmentValue;
          if (mode === "divide" && i === installments - 1) {
            const previousSum = baseInstallmentValue * (installments - 1);
            currentAmount = Number((rawAmount - previousSum).toFixed(2));
          }

          const installmentDate = addMonthsToDateStr(date, i);
          const newDocRef = doc(colRef);

          batch.set(newDocRef, {
            amount: currentAmount,
            description: `${description} (${i + 1}/${installments})`,
            category,
            date: installmentDate,
            account,
            type,
            paymentMethod,
            installmentCurrent: i + 1,
            installmentTotal: installments,
            groupId,
            createdBy: state.user.email || state.user.uid,
            createdAt: Date.now() + i
          });
        }

        await batch.commit();
        showToast(`${installments} parcelas lançadas nos próximos meses!`);
      }
    }

    closeTransactionModal();
  } catch (err) {
    console.error("Erro ao salvar:", err);
    showToast("Erro ao salvar lançamento.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("opacity-70");
  }
};

// =========================================================================
// EXCLUSÃO (INDIVIDUAL OU TODAS AS PARCELAS)
// =========================================================================
window.requestDeleteTransaction = (txId) => {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;

  state.pendingDeleteTx = tx;
  const isInstallment = tx.installmentTotal > 1 && tx.groupId;

  document.getElementById("delete-modal-desc").textContent = isInstallment
    ? `"${tx.description}" faz parte de um parcelamento em ${tx.installmentTotal}x. Como deseja excluir?`
    : `Deseja realmente excluir "${tx.description}" (${formatCurrency(tx.amount)})?`;

  document.getElementById("btn-delete-single").textContent = isInstallment
    ? "Excluir apenas esta parcela"
    : "Excluir lançamento";

  document.getElementById("btn-delete-all-installments").classList.toggle("hidden", !isInstallment);
  document.getElementById("delete-modal").classList.remove("hidden");
};

window.closeDeleteModal = () => {
  state.pendingDeleteTx = null;
  document.getElementById("delete-modal").classList.add("hidden");
};

window.confirmDeleteTransaction = async (deleteAllGroup) => {
  const tx = state.pendingDeleteTx;
  if (!tx || !state.user) return;

  try {
    if (deleteAllGroup && tx.groupId) {
      const groupItems = state.transactions.filter((t) => t.groupId === tx.groupId);
      const batch = writeBatch(db);
      groupItems.forEach((item) => {
        const ref = doc(db, "artifacts", appId, "public", "data", "couple_transactions", item.id);
        batch.delete(ref);
      });
      await batch.commit();
      showToast(`${groupItems.length} parcelas excluídas.`);
    } else {
      const ref = doc(db, "artifacts", appId, "public", "data", "couple_transactions", tx.id);
      await deleteDoc(ref);
      showToast("Lançamento excluído.");
    }
  } catch (err) {
    console.error("Erro ao excluir:", err);
    showToast("Erro ao excluir lançamento.");
  } finally {
    closeDeleteModal();
  }
};

// =========================================================================
// INICIALIZAÇÃO DA PÁGINA
// =========================================================================
window.addEventListener("DOMContentLoaded", () => {
  syncSettingsToUI();
  lucide.createIcons();
  initAuth();
});