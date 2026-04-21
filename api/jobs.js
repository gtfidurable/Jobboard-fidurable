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
          // C'est ici que la magie opère pour récupérer le logo via l'agrégation
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

      if (entreprise)   properties['Entreprise']           = { rich_text: [{ text: { content: entreprise } }] };
      if (secteur)      properties["Secteur d'activité"]  = { select: { name: secteur } };
      if (contrat)      properties['Type de contrat']      = { select: { name: contrat } };
      if (lieu)         properties['Lieu']                 = { rich_text: [{ text: { content: lieu } }] };
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

// Fonctions Helper
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
 * Fonction robuste pour récupérer l'URL d'un fichier.
 * Gère les colonnes "Fichiers" classiques ET les "Agrégations" (Rollup).
 */
function getFileUrl(props, key) {
  const prop = props[key];
  if (!prop) return '';

  let filesArray = [];

  // Cas 1 : La colonne est directement un champ "Fichiers et médias"
  if (prop.type === 'files') {
    filesArray = prop.files;
  } 
  // Cas 2 : La colonne est une "Agrégation" (Rollup)
  else if (prop.type === 'rollup' && prop.rollup.type === 'array') {
    // On cherche dans le tableau de l'agrégation le premier élément qui contient des fichiers
    const itemWithFiles = prop.rollup.array.find(item => item.type === 'files');
    if (itemWithFiles) {
      filesArray = itemWithFiles.files;
    }
  }

  if (!filesArray || filesArray.length === 0) return '';
  
  const fileObj = filesArray[0];
  // Renvoie l'URL Amazon (file) ou l'URL externe (external)
  return fileObj.file?.url || fileObj.external?.url || '';
}
