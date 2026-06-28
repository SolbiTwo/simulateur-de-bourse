require("dotenv").config();

const readline = require("readline");
const alpha = require("alphavantage")({ key: process.env.ALPHA_KEY });
const { createClient } = require("@supabase/supabase-js");

// =====================
// SUPABASE INIT
// =====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// =====================
// READLINE
// =====================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(text) {
  return new Promise((resolve) => rl.question(text, resolve));
}

// =====================
// YAHOO FINANCE
// =====================


async function obtenirPrix(symbole) {
  const data = await alpha.data.quote(symbole);
  const prix = Number(data["Global Quote"]["05. price"]);

  if (!prix) throw new Error("Prix invalide");

  return prix;
}

// =====================
// AFFICHER PORTFOLIO
// =====================
async function afficherPortefeuille() {
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portefeuille")
    .select("argent")
    .eq("id", 1)
    .single();

  if (portfolioError) throw portfolioError;

  const { data: positions, error: positionsError } = await supabase
    .from("positions")
    .select("symbole, quantite")
    .gt("quantite", 0)
    .order("symbole");

  if (positionsError) throw positionsError;

  console.log("\n=== PORTFOLIO ===");
  console.log(`Cash: ${portfolio.argent.toFixed(2)} $`);

  console.log("\nPositions:");
  if (!positions || positions.length === 0) {
    console.log("- Aucune position");
  } else {
    positions.forEach(({ symbole, quantite }) => {
      console.log(`- ${symbole}: ${quantite}`);
    });
  }
}

// =====================
// ACHAT
// =====================
async function acheterAction(symbole, quantite) {
  const prix = await obtenirPrix(symbole);
  const total = prix * quantite;

  const { data: portfolio, error: portfolioError } = await supabase
    .from("portefeuille")
    .select("argent")
    .eq("id", 1)
    .single();

  if (portfolioError) throw portfolioError;

  if (portfolio.argent < total) {
    console.log("Fonds insuffisants");
    return;
  }

  // Mettre à jour le cash
  const { error: updateError } = await supabase
    .from("portefeuille")
    .update({ argent: portfolio.argent - total })
    .eq("id", 1);

  if (updateError) throw updateError;

  // Mettre à jour ou créer la position
  const { data: existingPosition } = await supabase
    .from("positions")
    .select("quantite")
    .eq("symbole", symbole)
    .single();

  if (existingPosition) {
    const { error: posError } = await supabase
      .from("positions")
      .update({ quantite: existingPosition.quantite + quantite })
      .eq("symbole", symbole);
    if (posError) throw posError;
  } else {
    const { error: insertError } = await supabase
      .from("positions")
      .insert([{ symbole, quantite }]);
    if (insertError) throw insertError;
  }

  // Enregistrer la transaction
  const { error: transError } = await supabase
    .from("transactions")
    .insert([{
      type: "ACHAT",
      symbole,
      quantite,
      prix_unitaire: prix,
      total
    }]);

  if (transError) throw transError;

  console.log(`Achat: ${quantite} ${symbole} à ${prix.toFixed(2)}$`);
}

// =====================
// VENTE
// =====================
async function vendreAction(symbole, quantite) {
  const prix = await obtenirPrix(symbole);
  const total = prix * quantite;

  const { data: position, error: posError } = await supabase
    .from("positions")
    .select("quantite")
    .eq("symbole", symbole)
    .single();

  if (posError || !position || position.quantite < quantite) {
    console.log("Pas assez d'actions");
    return;
  }

  const { data: portfolio, error: portfolioError } = await supabase
    .from("portefeuille")
    .select("argent")
    .eq("id", 1)
    .single();

  if (portfolioError) throw portfolioError;

  // Mettre à jour le cash
  const { error: updateError } = await supabase
    .from("portefeuille")
    .update({ argent: portfolio.argent + total })
    .eq("id", 1);

  if (updateError) throw updateError;

  // Mettre à jour la position
  const { error: posUpdateError } = await supabase
    .from("positions")
    .update({ quantite: position.quantite - quantite })
    .eq("symbole", symbole);

  if (posUpdateError) throw posUpdateError;

  // Enregistrer la transaction
  const { error: transError } = await supabase
    .from("transactions")
    .insert([{
      type: "VENTE",
      symbole,
      quantite,
      prix_unitaire: prix,
      total
    }]);

  if (transError) throw transError;

  console.log(`Vente: ${quantite} ${symbole} à ${prix.toFixed(2)}$`);
}

// =====================
// MENU
// =====================
async function menu() {
  let running = true;

  while (running) {
    console.log("\n=== SIMULATEUR ===");
    console.log("1. Portfolio");
    console.log("2. Acheter");
    console.log("3. Vendre");
    console.log("4. Quitter");

    const choix = await question("Choix: ");

    try {
      if (choix === "1") {
        await afficherPortefeuille();
      }

      if (choix === "2") {
        const s = (await question("Symbole: ")).toUpperCase();
        const q = Number(await question("Quantité: "));
        await acheterAction(s, q);
      }

      if (choix === "3") {
        const s = (await question("Symbole: ")).toUpperCase();
        const q = Number(await question("Quantité: "));
        await vendreAction(s, q);
      }

      if (choix === "4") {
        running = false;
      }
    } catch (e) {
      console.log("Erreur:", e.message);
    }
  }
}

// =====================
// START
// =====================
(async () => {
  try {
    await menu();
  } finally {
    rl.close();
  }
})();

