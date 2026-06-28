require("dotenv").config();

const path = require("path");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const yahooFinance = require("yahoo-finance2").default;

// =====================
// CONFIG
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key_change_in_production";
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LOCAL_AUTH = process.env.LOCAL_AUTH === 'true' && !IS_VERCEL;

if (!SUPABASE_CONFIGURED) {
  console.error("SUPABASE_URL et SUPABASE_ANON_KEY sont manquants ou mal configurés dans Vercel.");
}

console.log(`LOCAL_AUTH=${LOCAL_AUTH} - ${LOCAL_AUTH ? 'Using local auth fallback' : 'Using Supabase auth'}`);
console.log(`SUPABASE_CONFIGURED=${SUPABASE_CONFIGURED}`);
console.log(`IS_VERCEL=${IS_VERCEL}`);

const app = express();
const supabase = SUPABASE_CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const fs = require('fs');
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'local_db.json');

function ensureLocalDb() {
  const dir = path.dirname(LOCAL_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}

function readLocalDb() {
  ensureLocalDb();
  return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
}

function writeLocalDb(db) {
  ensureLocalDb();
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

// =====================
// MIDDLEWARE
// =====================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    res.status(401).json({ message: "Token invalide" });
  }
}

// =====================
// MARCHES
// =====================
const MARCHES = {
  US: { suffixe: "" },
  PARIS: { suffixe: ".PA" },
  TOKYO: { suffixe: ".T" },
  Londres: { suffixe: ".L" },
  FRANCFORT: { suffixe: ".DE" },
  TORONTO: { suffixe: ".TO" }
};

// =====================
// UTILS
// =====================
function nettoyerMarche(marche) {
  const valeur = String(marche || "US").trim().toUpperCase();
  return MARCHES[valeur] ? valeur : "US";
}

function nettoyerSymbole(symbole, marche = "US") {
  const valeur = String(symbole || "").trim().toUpperCase();
  const suffixe = MARCHES[nettoyerMarche(marche)].suffixe;

  if (!valeur || valeur.includes(".")) return valeur;

  return `${valeur}${suffixe}`;
}

function nettoyerQuantite(quantite) {
  const n = Number(quantite);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// =====================
// YAHOO FINANCE
// =====================
async function obtenirCours(symbole) {
  try {
    const quote = await yahooFinance.quote(symbole);

    const prix = Number(quote?.regularMarketPrice);

    if (!prix || prix <= 0) {
      throw new Error(`Prix invalide pour ${symbole}`);
    }

    return {
      symbole,
      prix,
      haut: Number(quote?.regularMarketDayHigh || 0),
      bas: Number(quote?.regularMarketDayLow || 0),
      ouverture: Number(quote?.regularMarketOpen || 0),
      precedent: Number(quote?.regularMarketPreviousClose || 0),
      devise: quote?.currency || "USD",
      nom: quote?.shortName || quote?.longName || symbole
    };
  } catch (err) {
    console.error("Yahoo error:", err.message);
    throw new Error("Erreur récupération cours Yahoo Finance");
  }
}

// =====================
// PORTFOLIO
// =====================
async function getPortefeuille(userId) {
  if (LOCAL_AUTH) {
    const db = readLocalDb();
    const user = Object.values(db.users).find(u => u.id === userId || u.username === userId);
    if (!user) return { argent: 0, positions: [], transactions: [] };
    return {
      argent: Number(user.argent ?? 0),
      positions: (user.positions || []).map(p => ({ symbole: p.symbole, quantite: Number(p.quantite) })),
      transactions: (user.transactions || []).slice(-8).reverse().map(t => ({ type: t.type, symbole: t.symbole, quantite: t.quantite, prixUnitaire: t.prix_unitaire, total: t.total, date: t.date }))
    };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const { data: portefeuille, error: pError } = await supabase
    .from("user_portfolios")
    .select("argent")
    .eq("user_id", userId)
    .single();

  if (pError) throw pError;

  const { data: positions, error: posError } = await supabase
    .from("user_positions")
    .select("symbole, quantite")
    .eq("user_id", userId)
    .gt("quantite", 0)
    .order("symbole", { ascending: true });

  if (posError) throw posError;

  const { data: transactions, error: transError } = await supabase
    .from("user_transactions")
    .select("type, symbole, quantite, prix_unitaire, total, date_transaction")
    .eq("user_id", userId)
    .order("date_transaction", { ascending: false })
    .limit(8);

  if (transError) throw transError;

  return {
    argent: Number(portefeuille?.argent ?? 0),
    positions: (positions || []).map(p => ({
      symbole: p.symbole,
      quantite: Number(p.quantite)
    })),
    transactions: (transactions || []).map(t => ({
      type: t.type,
      symbole: t.symbole,
      quantite: Number(t.quantite),
      prixUnitaire: Number(t.prix_unitaire),
      total: Number(t.total),
      date: t.date_transaction
    }))
  };
}

// =====================
// ACHAT
// =====================
async function acheterAction(userId, symbole, quantite) {
  const cours = await obtenirCours(symbole);
  const total = cours.prix * quantite;

  try {
    const { data: portefeuille, error: pError } = await supabase
      .from("user_portfolios")
      .select("argent")
      .eq("user_id", userId)
      .single();

    if (pError) throw pError;

    const argent = Number(portefeuille?.argent ?? 0);

    if (argent < total) {
      return { ok: false, message: "Fonds insuffisants." };
    }

    const { error: updateError } = await supabase
      .from("user_portfolios")
      .update({ argent: argent - total })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    const { data: existingPosition, error: existingPosError } = await supabase
      .from("user_positions")
      .select("quantite")
      .eq("user_id", userId)
      .eq("symbole", symbole)
      .single();

    if (existingPosError && existingPosError.code !== "PGRST116") {
      throw existingPosError;
    }

    if (existingPosition) {
      const { error: posUpdateError } = await supabase
        .from("user_positions")
        .update({ quantite: existingPosition.quantite + quantite })
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (posUpdateError) throw posUpdateError;
    } else {
      const { error: posInsertError } = await supabase
        .from("user_positions")
        .insert([{ user_id: userId, symbole, quantite }]);

      if (posInsertError) throw posInsertError;
    }

    const { error: transError } = await supabase
      .from("user_transactions")
      .insert([{
        user_id: userId,
        type: "ACHAT",
        symbole,
        quantite,
        prix_unitaire: cours.prix,
        total
      }]);

    if (transError) throw transError;

    return {
      ok: true,
      message: "Achat effectué.",
      cours,
      total
    };
  } catch (e) {
    throw e;
  }
}

// =====================
// VENTE
// =====================
async function vendreAction(userId, symbole, quantite) {
  const cours = await obtenirCours(symbole);
  const total = cours.prix * quantite;

  try {
    const { data: position, error: posError } = await supabase
      .from("user_positions")
      .select("quantite")
      .eq("user_id", userId)
      .eq("symbole", symbole)
      .single();

    if (posError) {
      if (posError.code === "PGRST116") {
        return { ok: false, message: "Pas assez d'actions." };
      }
      throw posError;
    }

    if (!position || position.quantite < quantite) {
      return { ok: false, message: "Pas assez d'actions." };
    }

    const { data: portefeuille, error: pError } = await supabase
      .from("user_portfolios")
      .select("argent")
      .eq("user_id", userId)
      .single();

    if (pError) throw pError;

    const { error: updateError } = await supabase
      .from("user_portfolios")
      .update({ argent: Number(portefeuille.argent) + total })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    const newQuantite = position.quantite - quantite;
    if (newQuantite <= 0) {
      const { error: deleteError } = await supabase
        .from("user_positions")
        .delete()
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (deleteError) throw deleteError;
    } else {
      const { error: posUpdateError } = await supabase
        .from("user_positions")
        .update({ quantite: newQuantite })
        .eq("user_id", userId)
        .eq("symbole", symbole);

      if (posUpdateError) throw posUpdateError;
    }

    const { error: transError } = await supabase
      .from("user_transactions")
      .insert([{
        user_id: userId,
        type: "VENTE",
        symbole,
        quantite,
        prix_unitaire: cours.prix,
        total
      }]);

    if (transError) throw transError;

    return {
      ok: true,
      message: "Vente effectuée.",
      cours,
      total
    };
  } catch (e) {
    throw e;
  }
}

// =====================
// AUTHENTIFICATION
// =====================
async function registerUser(username, password) {
  const trimmedUsername = String(username || "").trim();

  if (LOCAL_AUTH) {
    // Local registration
    ensureLocalDb();
    const db = readLocalDb();
    const existing = Object.values(db.users).find(u => String(u.username || "") === trimmedUsername);
    if (existing) throw new Error('Cet utilisateur existe déjà');
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const newUser = { id, username: trimmedUsername, password: hashedPassword, argent: 10000, positions: [], transactions: [], created_at: new Date().toISOString() };
    db.users[id] = newUser;
    writeLocalDb(db);
    const token = jwt.sign({ userId: id, username: trimmedUsername }, JWT_SECRET, { expiresIn: '7d' });
    return { token, username: trimmedUsername };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id")
    .eq("username", trimmedUsername)
    .maybeSingle();

  if (existingUserError) {
    throw existingUserError;
  }

  if (existingUser) {
    throw new Error("Cet utilisateur existe déjà");
  }

  const { data: newUser, error: insertError } = await supabase
    .from("users")
    .insert([{ username: trimmedUsername, password: hashedPassword }])
    .select("id, username")
    .single();

  if (insertError) throw insertError;

  // Créer le portefeuille de l'utilisateur
  const { error: portfolioError } = await supabase
    .from("user_portfolios")
    .insert([{
      user_id: newUser.id,
      argent: 10000
    }]);

  if (portfolioError) throw portfolioError;

  const token = jwt.sign(
    { userId: newUser.id, username: newUser.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, username: newUser.username };
}

async function loginUser(username, password) {
  const trimmedUsername = String(username || "").trim();

  if (LOCAL_AUTH) {
    ensureLocalDb();
    const db = readLocalDb();
    const user = Object.values(db.users).find(u => String(u.username || "") === trimmedUsername);
    if (!user) throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return { token, username: user.username };
  }

  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error("Supabase non configuré. Vérifiez les variables d'environnement dans Vercel.");
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, username, password")
    .eq("username", trimmedUsername)
    .single();

  if (userError) {
    if (userError.code === "PGRST116") {
      throw new Error("Nom d'utilisateur ou mot de passe incorrect");
    }
    throw userError;
  }

  if (!user) {
    throw new Error("Nom d'utilisateur ou mot de passe incorrect");
  }

  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    throw new Error("Nom d'utilisateur ou mot de passe incorrect");
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, username: user.username };
}

// =====================
// ROUTES AUTHENTIFICATION
// =====================
app.post("/api/register", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis" });
    }

    const result = await registerUser(username, password);
    res.json({ message: "Inscription réussie", ...result });
  } catch (e) {
    next(e);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Nom d'utilisateur et mot de passe requis" });
    }

    const result = await loginUser(username, password);
    res.json({ message: "Connexion réussie", ...result });
  } catch (e) {
    next(e);
  }
});

// =====================
// ROUTES API
// =====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", async (req, res) => {
  if (!SUPABASE_CONFIGURED && !LOCAL_AUTH) {
    return res.status(200).json({
      ok: false,
      message: "Supabase non configuré. Vérifie les variables d'environnement dans Vercel."
    });
  }
  res.json({ ok: true });
});

app.get("/api/portefeuille", verifyToken, async (req, res, next) => {
  try {
    res.json(await getPortefeuille(req.userId));
  } catch (e) {
    next(e);
  }
});

app.get("/api/cours/:symbole", async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.params.symbole, req.query.marche);
    res.json(await obtenirCours(symbole));
  } catch (e) {
    next(e);
  }
});

app.post("/api/acheter", verifyToken, async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.body.symbole, req.body.marche);
    const quantite = nettoyerQuantite(req.body.quantite);

    if (!symbole || !quantite) {
      return res.status(400).json({ message: "Invalid input" });
    }

    res.json(await acheterAction(req.userId, symbole, quantite));
  } catch (e) {
    next(e);
  }
});

app.post("/api/vendre", verifyToken, async (req, res, next) => {
  try {
    const symbole = nettoyerSymbole(req.body.symbole, req.body.marche);
    const quantite = nettoyerQuantite(req.body.quantite);

    if (!symbole || !quantite) {
      return res.status(400).json({ message: "Invalid input" });
    }

    res.json(await vendreAction(req.userId, symbole, quantite));
  } catch (e) {
    next(e);
  }
});

// =====================
// ERROR HANDLER
// =====================
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ message: err.message || String(err) });
});

// =====================
// START SERVER
// =====================
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Serveur: http://localhost:${PORT}`);
  });

  async function fermer() {
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", fermer);
  process.on("SIGTERM", fermer);
}

module.exports = app;