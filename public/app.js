const balance = document.querySelector("#balance");
const positions = document.querySelector("#positions");
const transactions = document.querySelector("#transactions");
const quoteMarket = document.querySelector("#quoteMarket");
const quoteSymbol = document.querySelector("#quoteSymbol");
const quoteButton = document.querySelector("#quoteButton");
const quoteResult = document.querySelector("#quoteResult");
const tradeForm = document.querySelector("#tradeForm");
const tradeMarket = document.querySelector("#tradeMarket");
const tradeSymbol = document.querySelector("#tradeSymbol");
const tradeQuantity = document.querySelector("#tradeQuantity");
const tradeButton = document.querySelector("#tradeButton");
const tradeMessage = document.querySelector("#tradeMessage");
const refreshButton = document.querySelector("#refreshButton");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const segments = document.querySelectorAll(".segment");

let currentAction = "acheter";

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function formatPrice(value, currency = "USD") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
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

function updateAuthButtons() {
  const token = localStorage.getItem("token");

  if (token) {
    loginButton.style.display = "none";
    logoutButton.style.display = "inline-block";
  } else {
    loginButton.style.display = "inline-block";
    logoutButton.style.display = "none";
  }
}

function setMessage(element, message, type = "muted") {
  element.className = type;
  element.textContent = message;
}

function renderPositions(items) {
  if (!items.length) {
    positions.innerHTML = '<div class="empty">Aucune action pour le moment.</div>';
    return;
  }

  positions.innerHTML = items
    .map((item) => `
      <div class="position-row">
        <div>
          <div class="symbol">${item.symbole}</div>
          <div class="muted">Position ouverte</div>
        </div>
        <div class="quantity">${item.quantite}</div>
      </div>
    `)
    .join("");
}

function renderTransactions(items) {
  if (!items.length) {
    transactions.innerHTML = '<div class="empty">Aucune operation enregistree.</div>';
    return;
  }

  transactions.innerHTML = items
    .map((item) => `
      <div class="history-row">
        <span class="badge ${item.type === "ACHAT" ? "buy" : "sell"}">${item.type}</span>
        <div>
          <div class="symbol">${item.symbole} x ${item.quantite}</div>
          <div class="muted">${formatDate(item.date)}</div>
        </div>
        <div class="money">${formatMoney(item.total)}</div>
      </div>
    `)
    .join("");
}

async function loadPortfolio() {
  const portefeuille = await api("/api/portefeuille");
  balance.textContent = formatMoney(portefeuille.argent);
  renderPositions(portefeuille.positions);
  renderTransactions(portefeuille.transactions);
}

async function searchQuote() {
  const symbole = quoteSymbol.value.trim().toUpperCase();
  const marche = quoteMarket.value;

  if (!symbole) {
    setMessage(quoteResult, "Entre un symbole.", "error");
    return;
  }

  quoteButton.disabled = true;
  setMessage(quoteResult, "Recherche du cours...", "muted");

  try {
    const cours = await api(`/api/cours/${encodeURIComponent(symbole)}?marche=${encodeURIComponent(marche)}`);
    quoteSymbol.value = cours.symbole;
    setMessage(
      quoteResult,
      `${cours.symbole} vaut ${formatPrice(cours.prix, cours.devise)}. Haut: ${formatPrice(cours.haut, cours.devise)}. Bas: ${formatPrice(cours.bas, cours.devise)}.`,
      "success"
    );
  } catch (error) {
    setMessage(quoteResult, error.message, "error");
  } finally {
    quoteButton.disabled = false;
  }
}

function updateAction(action) {
  currentAction = action;
  tradeButton.textContent = action === "acheter" ? "Acheter" : "Vendre";

  segments.forEach((segment) => {
    segment.classList.toggle("active", segment.dataset.action === action);
  });
}

async function submitTrade(event) {
  event.preventDefault();

  const symbole = tradeSymbol.value.trim().toUpperCase();
  const quantite = Number(tradeQuantity.value);
  const marche = tradeMarket.value;

  if (!symbole || !Number.isInteger(quantite) || quantite <= 0) {
    setMessage(tradeMessage, "Symbole ou quantite invalide.", "error");
    return;
  }

  tradeButton.disabled = true;
  setMessage(tradeMessage, "Ordre en cours...", "muted");

  try {
    const result = await api(`/api/${currentAction}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ symbole, quantite, marche })
    });

    tradeSymbol.value = symbole;
    setMessage(
      tradeMessage,
      `${result.message} Total: ${formatMoney(result.total)}.`,
      "success"
    );
    await loadPortfolio();
  } catch (error) {
    setMessage(tradeMessage, error.message, "error");
  } finally {
    tradeButton.disabled = false;
  }
}

segments.forEach((segment) => {
  segment.addEventListener("click", () => updateAction(segment.dataset.action));
});

loginButton.addEventListener("click", () => {
  window.location.href = "/login.html";
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});

quoteButton.addEventListener("click", searchQuote);
quoteSymbol.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchQuote();
  }
});
tradeForm.addEventListener("submit", submitTrade);
refreshButton.addEventListener("click", loadPortfolio);

updateAuthButtons();

loadPortfolio().catch((error) => {
  balance.textContent = "Erreur";
  renderPositions([]);
  renderTransactions([]);
  setMessage(tradeMessage, error.message, "error");
});
