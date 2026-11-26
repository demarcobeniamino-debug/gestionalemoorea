import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/index.css';
import { DatiProvider, useApp } from './dati/contesto';
import { Toasts } from './ui/primitivi';
import { Aggiornamento } from './ui/Aggiornamento';
import { Accesso } from './schermate/Accesso';
import { Sala } from './schermate/Sala';
import { ComandaSchermata } from './schermate/Comanda';
import { Conto } from './schermate/Conto';
import { Cucina } from './schermate/Cucina';
import { Design } from './schermate/Design';
import { DaFare } from './schermate/DaFare';
import { CartaSimulata } from './schermate/CartaSimulata';
import { Collegamento } from './schermate/Collegamento';
import { GestioneLayout } from './schermate/gestione/Layout';
import { Articoli } from './schermate/gestione/Articoli';
import { Categorie, Varianti } from './schermate/gestione/Menu';
import { SaleTavoli } from './schermate/gestione/SaleTavoli';
import { Fornitori, Movimenti, Scorte } from './schermate/gestione/Magazzino';
import { tieniAcceso } from './dati/piattaforma';

void tieniAcceso();

function Protetta({ children }: { children: React.ReactElement }) {
  const { operatore } = useApp();
  return operatore ? children : <Navigate to="/accesso" replace />;
}

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/sala" replace />} />
        <Route path="/accesso" element={<Accesso />} />
        <Route path="/sala" element={<Protetta><Sala /></Protetta>} />
        <Route path="/comanda/:id" element={<Protetta><ComandaSchermata /></Protetta>} />
        <Route path="/conto/:id" element={<Protetta><Conto /></Protetta>} />
        <Route path="/cucina" element={<Cucina />} />
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
        </Route>
        {/* Schermate delle fasi successive (recon S17-S53): segnaposto con il loro scopo. */}
        <Route path="/da-fare/:id" element={<DaFare />} />
        <Route path="*" element={<Navigate to="/sala" replace />} />
      </Routes>
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
