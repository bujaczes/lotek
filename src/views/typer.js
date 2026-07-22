import { stubView } from './stub.js';

export const createTyperView = () =>
  stubView({
    title: 'Typer',
    buildLead: () =>
      'Jeden deterministyczny zestaw na następne losowanie, pełne „dlaczego te liczby” i historia „Sprawdzam!” — trafienia Typera obok oczekiwanych 0,7347 na kupon. Wkrótce.',
  });
