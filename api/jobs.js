import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) return res.status(500).json({ error: 'NOTION_DATABASE_ID non configuré' });

  // ── GET : liste des offres publiées ──────────────────────────────
  if (req.method === 'GET') {
    try {
      const response = await notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'État',
          status: { equals: 'Ouverte' },
        },
        sorts: [
          { property: 'Date de début', direction: 'ascending' },
          { timestamp: 'created_time', direction: 'descending' },
        ],
      });

      const jobs = response.results.map((page) => {
        const p = page.properties;
        return {
          id: page.id,
          date_creation: page.created_time,
          titre:       getText(p, 'Intitulé du poste', 'title'),
          entreprise:  getText(p, 'Entreprise', 'rich_text'),
          secteur:     getSelect(p, "Secteur d'activité"),
          contrat:     getSelect(p, 'Type de contrat'),
          date_debut:  getDate(p, 'Date de début'),
          lieu:        getText(p, 'Lieu', 'rich_text'),
          niveau:      getSelect(p, "Niveau d'expérience"),
          description: getText(p, 'Descriptif du poste', 'rich_text'),
          lien:        getUrl(p, "URL de l'offre"),
          source:      getSelect(p, 'Source'),
          logo:        getFileUrl(p, 'URL Logo'), 
        };
      });

      return res.status(200).json(jobs);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des offres' });
    }
  }

  // ── POST : soumettre une nouvelle offre ──────────────────────────
  if (req.method === 'POST') {
    try {
      const { titre, entreprise, secteur, contrat, date_debut, lieu, niveau, description, lien } = req.body;

      if (!titre || !entreprise) {
        return res.status(400).json({ error: 'Titre et entreprise sont obligatoires' });
      }

      const properties = {
        'Intitulé du poste': { title: [{ text: { content: titre } }] },
        'État': { status: { name: 'En attente' } },
      };

      if (entreprise)   properties['Entreprise']          = { rich_text: [{ text: { content: entreprise } }] };
      if (secteur)      properties["Secteur d'activité"]  = { select: { name: secteur } };
      if (contrat)      properties['Type de contrat']     = { select: { name: contrat } };
      if (lieu)         properties['Lieu']                = { rich_text: [{ text: { content: lieu } }] };
      if (niveau)       properties["Niveau d'expérience"] = { select: { name: niveau } };
      if (description)  properties['Descriptif du poste'] = { rich_text: [{ text: { content: description } }] };
      if (lien)         properties["URL de l'offre"]      = { url: lien };
      if (date_debut)   properties['Date de début']       = { date: { start: date_debut } };

      await notion.pages.create({ parent: { database_id: databaseId }, properties });

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Erreur lors de l'ajout de l'offre" });
    }
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}

// ── Fonctions Helpers ──────────────────────────────────────────────
function getText(props, key, type) {
  const items = props[key]?.[type] ?? [];
  return items.map((t) => t.plain_text).join('');
}

function getSelect(props, key) {
  return props[key]?.select?.name ?? '';
}

function getDate(props, key) {
  const start = props[key]?.date?.start;
  if (!start) return '';
  const d = new Date(start);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getUrl(props, key) {
  return props[key]?.url ?? '';
}

/**
 * Fonction "Radar" : Extrait l'URL du fichier même si le nom de la colonne est imprécis.
 */
function getFileUrl(props, exactColumnName) {
  // Fonction de minage interne pour trouver le lien peu importe où il est caché
  const extract = (p) => {
    if (!p) return '';
    // Si c'est un fichier en direct
    if (p.type === 'files' && p.files && p.files.length > 0) {
      return p.files[0].file?.url || p.files[0].external?.url || '';
    }
    // Si c'est une Agrégation (Rollup)
    if (p.type === 'rollup' && p.rollup?.type === 'array') {
      for (const item of p.rollup.array) {
        if (item.type === 'files' && item.files && item.files.length > 0) {
          return item.files[0].file?.url || item.files[0].external?.url || '';
        }
        if (item.type === 'url' && item.url) {
          return item.url;
        }
      }
    }
    if (p.type === 'url') return p.url || '';
    return '';
  };

  // 1. On essaie la porte d'entrée normale (avec le nom exact)
  let url = extract(props[exactColumnName]);
  if (url) return url;

  // 2. Plan de secours : on scanne TOUTES les propriétés de la ligne
  for (const key in props) {
    if (props[key].type === 'files' || props[key].type === 'rollup') {
      let fallback = extract(props[key]);
      if (fallback) return fallback;
    }
  }

  return '';
}
