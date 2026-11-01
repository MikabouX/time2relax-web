// Historique en ligne (facultatif), sous un nom d'utilisateur. Tant que ces deux valeurs sont vides,
// la page fonctionne uniquement dans le navigateur. Voir README.md pour les renseigner.
// La clé ci-dessous est une clé PUBLIQUE (« publishable » / « anon ») : elle est faite pour
// être visible dans la page. Ne mets jamais ici la clé « secret » ou « service_role ».
// Version web autonome (novembre 2026) : on choisit la page web OU l'application ; la page ne partage
// rien en ligne (tout reste dans le navigateur) et ne charge donc jamais le serveur. Les deux valeurs
// restent vides ; le code de synchronisation est conservé mais inactif.
window.T2R_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
