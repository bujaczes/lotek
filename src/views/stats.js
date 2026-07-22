import { stubView } from './stub.js';

export const createStatsView = () =>
  stubView({
    title: 'Statystyki',
    buildLead: () =>
      'Histogram sum, „dywan” 70 lat losowań, pary z liftem i rekordy — z teoretyczną wartością odniesienia obok każdej liczby. Wkrótce.',
  });
