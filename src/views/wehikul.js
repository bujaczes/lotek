import { stubView } from './stub.js';

export const createWehikulView = () =>
  stubView({
    title: 'Wehikuł czasu',
    buildLead: () =>
      'Wpisz swój ulubiony zestaw sześciu liczb, a policzymy, ile razy trafiłby 3, 4, 5 lub 6 od 1957 roku — z hipotetycznym bilansem. Wkrótce.',
  });
