import { stubView } from './stub.js';

export const createNotFoundView = () =>
  stubView({
    eyebrow: '404',
    title: 'Nie ma takiej strony',
    buildLead: () => 'Ten adres nie prowadzi do żadnego losowania ani statystyki. Wróć na stronę główną i zacznij od ostatniego wyniku.',
  });
