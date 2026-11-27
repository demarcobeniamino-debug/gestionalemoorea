import React, { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/index.css';
import { DatiProvider, useApp } from './dati/contesto';
import { Spinner, Toasts } from './ui/primitivi';
import { Aggiornamento } from './ui/Aggiornamento';
import { Accesso } from './schermate/Accesso';
import { Sala } from './schermate/Sala';
import { ComandaSchermata } from './schermate/Comanda';
import { Conto } from './schermate/Conto';
import { Cucina } from './schermate/Cucina';
import { CartaSimulata } from './schermate/CartaSimulata';
import { Collegamento } from './schermate/Collegamento';
import { tieniAcceso } from './dati/piattaforma';

void tieniAcceso();

// Gestione, Cassa e pagine rare si caricano al primo uso: la sala e la comanda partono prima.
const pigro = <K extends string>(f: () => Promise<{ [k in K]: React.ComponentType }>, nome: K) =>
  lazy(() => f().then((m) => ({ default: m[nome] })));
const GestioneLayout = pigro(() => import('./schermate/gestione/Layout'), 'GestioneLayout');
const Articoli = pigro(() => import('./schermate/gestione/Articoli'), 'Articoli');
const Categorie = pigro(() => import('./schermate/gestione/Menu'), 'Categorie');
const Varianti = pigro(() => import('./schermate/gestione/Menu'), 'Varianti');
const SaleTavoli = pigro(() => import('./schermate/gestione/SaleTavoli'), 'SaleTavoli');
const Scorte = pigro(() => import('./schermate/gestione/Magazzino'), 'Scorte');
const Movimenti = pigro(() => import('./schermate/gestione/Magazzino'), 'Movimenti');
const Fornitori = pigro(() => import('./schermate/gestione/Magazzino'), 'Fornitori');
const Stampanti = pigro(() => import('./schermate/gestione/Stampanti'), 'Stampanti');
const PagamentiGestione = pigro(() => import('./schermate/gestione/Impostazioni'), 'Pagamenti');
const PromozioniGestione = pigro(() => import('./schermate/gestione/Impostazioni'), 'Promozioni');
const MenuFissiGestione = pigro(() => import('./schermate/gestione/Impostazioni'), 'MenuFissi');
const Personale = pigro(() => import('./schermate/gestione/Personale'), 'Personale');
const ClientiGestione = pigro(() => import('./schermate/gestione/Clienti'), 'ClientiGestione');
const FattureGestione = pigro(() => import('./schermate/gestione/Fatture'), 'FattureGestione');
const Cassa = pigro(() => import('./schermate/Cassa'), 'Cassa');
const Design = pigro(() => import('./schermate/Design'), 'Design');
const DaFare = pigro(() => import('./schermate/DaFare'), 'DaFare');

const Attesa = () => <div className="grid h-full place-items-center bg-bg"><Spinner /></div>;


function Protetta({ children }: { children: React.ReactElement }) {
  const { operatore } = useApp();
  return operatore ? children : <Navigate to="/accesso" replace />;
}

function App() {
  return (
    <>
      <Suspense fallback={<Attesa />}>
      <Routes>
        <Route path="/" element={<Navigate to="/sala" replace />} />
        <Route path="/accesso" element={<Accesso />} />
        <Route path="/sala" element={<Protetta><Sala /></Protetta>} />
        <Route path="/comanda/:id" element={<Protetta><ComandaSchermata /></Protetta>} />
        <Route path="/conto/:id" element={<Protetta><Conto /></Protetta>} />
        <Route path="/cucina" element={<Cucina />} />
        <Route path="/cassa" element={<Protetta><Cassa /></Protetta>} />
        <Route path="/design" element={<Design />} />
        <Route path="/gestione" element={<Protetta><GestioneLayout /></Protetta>}>
          <Route index element={<Navigate to="articoli" replace />} />
          <Route path="articoli" element={<Articoli />} />
          <Route path="categorie" element={<Categorie />} />
          <Route path="varianti" element={<Varianti />} />
          <Route path="sale" element={<SaleTavoli />} />
          <Route path="magazzino" element={<Scorte />} />
          <Route path="movimenti" element={<Movimenti />} />
          <Route path="fornitori" element={<Fornitori />} />
          <Route path="stampanti" element={<Stampanti />} />
          <Route path="personale" element={<Personale />} />
          <Route path="pagamenti" element={<PagamentiGestione />} />
          <Route path="promozioni" element={<PromozioniGestione />} />
          <Route path="menu-fissi" element={<MenuFissiGestione />} />
          <Route path="clienti" element={<ClientiGestione />} />
          <Route path="fatture" element={<FattureGestione />} />
        </Route>
        {/* Schermate delle fasi successive (recon S17-S53): segnaposto con il loro scopo. */}
        <Route path="/da-fare/:id" element={<DaFare />} />
        <Route path="*" element={<Navigate to="/sala" replace />} />
      </Routes>
      </Suspense>
      <Toasts />
      <CartaSimulata />
      <Aggiornamento />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatiProvider schermataCollega={(p) => <Collegamento {...p} />}>
      <HashRouter><App /></HashRouter>
    </DatiProvider>
  </StrictMode>,
);
