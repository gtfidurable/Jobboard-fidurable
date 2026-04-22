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
      // 1. On récupère toutes les offres
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

      const pages = response.results;

      // 2. On extrait les IDs uniques des entreprises via la Relation
      const companyIds = new Set();
      pages.forEach(page => {
        const relation = page.properties['Relation Pool logos entreprises']?.relation;
        if (relation && relation.length > 0) {
          companyIds.add(relation[0].id);
        }
      });

      // 3. On va chercher les logos directement à la source (dans l'Annuaire) en parallèle
      const companyLogos = {};
      await Promise.all(Array.from(companyIds).map(async (companyId) => {
        try {
          const companyPage = await notion.pages.retrieve({ page_id: companyId });
          let logoUrl = '';
          
          // On fouille les propriétés de l'entreprise pour trouver un fichier
          for (const key in companyPage.properties) {
            const prop = companyPage.properties[key];
            if (prop.type === 'files' && prop.files && prop.files.length > 0) {
              logoUrl = prop.files[0].file?.url || prop.files[0].external?.url || '';
              break; // On a trouvé l'image, on s'arrête
            }
          }
          companyLogos[companyId] = logoUrl;
        } catch (e) {
          console.error(`Impossible de récupérer l'entreprise ${companyId}`, e);
        }
      }));

      // 4. On assemble les offres avec les vrais logos
      const jobs = pages.map((page) => {
        const p = page.properties;
        const relation = p['Relation Pool logos entreprises']?.relation;
        const companyId = relation && relation.length > 0 ? relation[0].id : null;
        
        // On prend le logo de l'annuaire. S'il n'y en a pas, on tente l'ancienne méthode au cas où.
        const finalLogo = (companyId ? companyLogos[companyId] : '') || getFileUrl(p, 'URL Logo');

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
          logo:        finalLogo
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

// Fonction de secours classique
function getFileUrl(props, exactColumnName) {
  const extract = (p) => {
    if (!p) return '';
    if (p.type === 'files' && p.files && p.files.length > 0) {
      return p.files[0].file?.url || p.files[0].external?.url || '';
    }
    if (p.type === 'url') return p.url || '';
    return '';
  };
  
  let url = extract(props[exactColumnName]);
  if (url) return url;
  
  for (const key in props) {
    if (props[key].type === 'files') {
      let fallback = extract(props[key]);
      if (fallback) return fallback;
    }
  }
  return '';
}
