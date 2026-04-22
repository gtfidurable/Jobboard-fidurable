import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) return res.status(500).json({ error: 'NOTION_DATABASE_ID non configuré' });

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
          titre:       getText(p, 'Intitulé du poste', 'title'),
          entreprise:  getText(p, 'Entreprise', 'rich_text'),
          logo:        getFileUrl(p, 'URL Logo'), 
          // LA LIGNE QUI VA NOUS DONNER LA VÉRITÉ :
          debug_raw:   p 
        };
      });

      return res.status(200).json(jobs);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur lors de la récupération des offres' });
    }
  }
  return res.status(405).json({ error: 'Méthode non autorisée' });
}

function getText(props, key, type) {
  const items = props[key]?.[type] ?? [];
  return items.map((t) => t.plain_text).join('');
}

function getFileUrl(props, exactColumnName) {
  const extract = (p) => {
    if (!p) return '';
    if (p.type === 'files' && p.files && p.files.length > 0) {
      return p.files[0].file?.url || p.files[0].external?.url || '';
    }
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

  let url = extract(props[exactColumnName]);
  if (url) return url;

  for (const key in props) {
    if (props[key].type === 'files' || props[key].type === 'rollup') {
      let fallback = extract(props[key]);
      if (fallback) return fallback;
    }
  }
  return '';
}
