import { Client } from '@notionhq/client';

  const notion = new Client({ auth: process.env.NOTION_API_KEY });

  export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!databaseId) {
      return res.status(500).json({ error: 'NOTION_DATABASE_ID non configuré' });
    }

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
          titre: getText(p, 'Intitulé du poste', 'title'),
          entreprise:  getText(p, 'Entreprise', 'rich_text'),
          secteur: getSelect(p, "Secteur d'activité"),
          contrat: getSelect(p, 'Type de contrat'),
          date_debut:  getDate(p, 'Date de début'),
          lieu:        getText(p, 'Lieu', 'rich_text'),
          niveau:      getSelect(p, "Niveau d'expérience", 'rich_text'),
          description: getText(p, 'Descriptif du poste', 'rich_text'),
          lien:        getUrl(p, "URL de l'offre"),
        };
      });

      res.status(200).json(jobs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur lors de la récupération des offres' });
    }
  }

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
