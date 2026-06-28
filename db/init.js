require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error("SUPABASE_URL et SUPABASE_ANON_KEY sont manquants dans le fichier .env");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Créer la table portefeuille
    console.log("Exécution du SQL de `db/schema.sql` pour créer les tables...");
    const fs = require('fs');
    const path = require('path');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    let pError = null;
    try {
      const rpcRes = await supabase.rpc('exec', { sql: schemaSql });
      pError = rpcRes?.error ?? null;
    } catch (err) {
      pError = err;
    }

    // Alternative : créer via INSERT si la table existe
    const { error: checkError } = await supabase
      .from("portefeuille")
      .select("id")
      .limit(1);

    if (checkError) {
      console.log("⚠️  La table portefeuille n'existe pas encore.");
      console.log("Veuillez créer les tables manuellement dans Supabase :");
      console.log(`
1. Ouvrez https://app.supabase.com
2. Allez dans "SQL Editor"
3. Copiez-collez le contenu de db/schema.sql
4. Exécutez les requêtes

Ou utilisez le SQL Editor avec ce code:
${require("fs").readFileSync(require("path").join(__dirname, "schema.sql"), "utf8")}
      `);
      process.exit(1);
    }

    // Initialiser la table portefeuille
    const { error: insertError } = await supabase
      .from("portefeuille")
      .upsert({ id: 1, argent: 10000 }, { onConflict: "id" });

    if (insertError) throw insertError;

    console.log("✓ Base Supabase initialisée avec succès!");
    console.log("✓ Portfolio créé avec 10000$ de capital");

  } catch (error) {
    console.error("Erreur pendant l'initialisation:", error.message);
    process.exit(1);
  }
}

main();

