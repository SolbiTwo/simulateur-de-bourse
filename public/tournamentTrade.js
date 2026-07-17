const tournamentSelect = document.querySelector("#tournamentSelect");
const tradeMarket = document.querySelector("#tradeMarket");
const tradeSymbol = document.querySelector("#tradeSymbol");
const tradeQuantity = document.querySelector("#tradeQuantity");
const tradeButton = document.querySelector("#tradeButton");
const tradeMessage = document.querySelector("#tradeMessage");
const quotePriceEl = document.querySelector("#quotePrice");
const quoteTotalEl = document.querySelector("#quoteTotal");
const currentBudgetEl = document.querySelector("#currentBudget");
const currentStatusEl = document.querySelector("#currentStatus");
const positionsContainer = document.querySelector("#tournamentPositions");
const backToApp = document.querySelector("#backToApp");
const logoutButton = document.querySelector("#logoutButton");

let tournaments = [];
let selectedTournament = null;

function setMessage(element, message, type = "muted") {
  element.className = type;
  element.textContent = message;
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

async function api(url, options = {}) {
  const token = localStorage.getItem("token");

  if (!token) {
    window.location.href = "/login.html";
    return Promise.reject(new Error("Token manquant"));
  }

  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return Promise.reject(new Error("Token invalide"));
    }

    throw new Error(data.message || "Une erreur est survenue.");
  }

  return data;
}

function renderTournamentOptions(items) {
  tournaments = items || [];
  tournamentSelect.innerHTML = tournaments.length
    ? tournaments.map((item) => `<option value="${item.id}">${item.name} (${item.status})</option>`).join("")
    : '<option value="">Aucun tournoi disponible</option>';

  selectedTournament = tournaments[0] || null;
  updateTournamentSummary();
}

function updateTournamentSummary() {
  if (!selectedTournament) {
    currentBudgetEl.textContent = "-";
    currentStatusEl.textContent = "Aucun tournoi sélectionné";
    return;
  }

  currentBudgetEl.textContent = selectedTournament.myBudget != null
    ? formatMoney(selectedTournament.myBudget)
    : formatMoney(selectedTournament.budget);
  currentStatusEl.textContent = `${selectedTournament.status} · ${selectedTournament.participants?.length || 0} participant(s)`;
}

async function loadTournaments() {
  try {
    const items = await api("/api/tournaments");
    renderTournamentOptions(items.filter((t) => t.status === "OPEN" && t.joined));
    await refreshQuote();
    await refreshPositions();
  } catch (error) {
    setMessage(tradeMessage, error.message, "error");
  }
}

function updateQuoteDisplay(price) {
  quotePriceEl.textContent = price !== null ? formatMoney(price) : "-";
  const quantity = Number(tradeQuantity.value);
  quoteTotalEl.textContent = price !== null && Number.isInteger(quantity) && quantity > 0
    ? formatMoney(price * quantity)
    : "-";
}

function renderPositions(items) {
  if (!items || !items.length) {
    positionsContainer.innerHTML = '<div class="empty">Aucune position.</div>';
    return;
  }

  positionsContainer.innerHTML = items
    .map((item) => `
      <div class="position-row">
        <div>
          <div class="symbol">${item.symbole}</div>
          <div class="muted">${item.quantite} action(s)</div>
        </div>
        <div class="money">${formatMoney(item.total)}</div>
      </div>
    `)
    .join("");
}

async function refreshPositions() {
  try {
    const portefeuille = await api("/api/portefeuille");
    renderPositions(portefeuille.positions || []);
  } catch (error) {
    positionsContainer.innerHTML = '<div class="empty">Impossible de charger les positions.</div>';
  }
}

async function refreshQuote() {
  const symbole = tradeSymbol.value.trim().toUpperCase();
  const marche = tradeMarket.value;

  if (!symbole) {
    updateQuoteDisplay(null);
    return;
  }

  try {
    const cours = await api(`/api/cours/${encodeURIComponent(symbole)}?marche=${encodeURIComponent(marche)}`);
    updateQuoteDisplay(Number(cours.prix));
  } catch (error) {
    updateQuoteDisplay(null);
  }
}

function handleTournamentChange() {
  selectedTournament = tournaments.find((t) => String(t.id) === tournamentSelect.value) || null;
  updateTournamentSummary();
}

async function submitTrade(event) {
  event.preventDefault();

  if (!selectedTournament) {
    setMessage(tradeMessage, "Sélectionne un tournoi où tu participes.", "error");
    return;
  }

  const symbole = tradeSymbol.value.trim().toUpperCase();
  const quantite = Number(tradeQuantity.value);
  const marche = tradeMarket.value;

  if (!symbole || !Number.isInteger(quantite) || quantite <= 0) {
    setMessage(tradeMessage, "Symbole ou quantite invalide.", "error");
    return;
  }

  await refreshQuote();

  tradeButton.disabled = true;
  setMessage(tradeMessage, "Ordre en cours...", "muted");

  try {
    const result = await api(`/api/tournaments/${selectedTournament.id}/trade`, {
      method: "POST",
      body: JSON.stringify({ symbole, quantite, marche })
    });

    setMessage(tradeMessage, `${result.message} Total : ${formatMoney(result.total)}.`, "success");
    await loadTournaments();
    await refreshPositions();
  } catch (error) {
    setMessage(tradeMessage, error.message, "error");
  } finally {
    tradeButton.disabled = false;
  }
}

backToApp.addEventListener("click", () => {
  window.location.href = "/";
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});

tournamentSelect.addEventListener("change", handleTournamentChange);
tradeMarket.addEventListener("change", refreshQuote);
tradeSymbol.addEventListener("input", () => {
  if (tradeSymbol.value.trim().length >= 1) {
    refreshQuote();
  }
});
tradeQuantity.addEventListener("input", refreshQuote);
tradeButton.addEventListener("click", submitTrade);

loadTournaments().catch((error) => {
  setMessage(tradeMessage, error.message, "error");
  updateQuoteDisplay(null);
});
