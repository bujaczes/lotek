import { stubView } from './stub.js';

export const createNumberView = () =>
  stubView({
    title: (p) => `Liczba ${p.n}`,
    buildLead: (p) =>
      `Kariera liczby ${p.n}: licznik trafień, sparkline roczny, rozkład przerw, najdłuższa seria i pozycja na blankiecie. Wkrótce.`,
  });
