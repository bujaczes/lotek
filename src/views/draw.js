import { stubView } from './stub.js';

export const createDrawView = () =>
  stubView({
    title: (p) => `Losowanie nr ${p.nr}`,
    buildLead: (p) =>
      `Szczegóły losowania nr ${p.nr} wraz z werdyktem, chipami liczb i najbliższym sąsiadem — plus archiwum z wyszukiwarką. Wkrótce.`,
  });
