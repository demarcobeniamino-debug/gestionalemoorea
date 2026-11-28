# Confronto con Passepartout Menu (27/11/2026)

Fonte: export completo di Menu del Moorea (82 tabelle CSV) + recon pubblico. Stato dopo la v0.8.0.

## Già alla pari (o meglio)
Sala con piantina e più sale · tavoli uniti e separati · sposta tavolo/piatti · banco e asporto · comanda per portate con marcia e sollecito · varianti, note, posto, allergie · voce libera · menu fissi con scelte · abbinamenti consigliati · promozioni a orario (happy hour) · messaggi ai reparti · monitor cucina · stampa comande ESC/POS (caratteri doppi) · preconto · conto unico, alla romana, sconti, omaggi · pagamenti: contanti, carta, buoni pasto per emittente, metodi su misura (Satispay…), sospeso al cliente, addebito in camera, caparra, pagamento misto · codice lotteria · Epson RT: scontrino, annullo, Z, stato RT, orologio, errori leggibili, collaudo guidato · proforma · elimina conto · cassetto (fondo, versamenti, prelievi, conteggio, atteso) · sospesi e incasso successivo · caparre · fattura elettronica XML da scontrino e riepilogativa · clienti con storico e allergie · prenotazioni (Table Flow) · magazzino con scarico da ricette · statistiche e chiusure · personale con PIN e ruoli · menu allineato ai 321 articoli attivi di Menu.

In più rispetto a Menu: avviso "nessuna cassa accesa" sui palmari, stampe vecchie sospese invece che sparate in cucina, collaudo RT guidato, app su iPhone/Android/Windows/Mac dallo stesso codice.

## Mancano ancora (in ordine di importanza)
1. **Funzionamento senza internet.** Menu ha un server in LAN; noi siamo in cloud. Subito: router 4G di riserva. Poi: modalità offline sulla cassa (coda locale e sincronizzazione).
2. **Reso parziale** (REFUND di alcune righe) dalla Cassa: oggi solo annullo dell'intero scontrino.
3. **Invio fatture allo SDI** tramite intermediario (oggi XML da caricare a mano o dal commercialista).
4. **Ristampa di una comanda** già inviata (copia per il reparto).
5. **Export corrispettivi/chiusure** per il commercialista (CSV/Excel).
6. **Listini per sala o fascia oraria** (Menu: ListinoXCategoriaXSala); le promozioni coprono l'happy hour.
7. **Fidelity**: tessere a punti, buoni sconto, gift card (Menu: Tessera, BuoniSconto, Promozioni a punti).
8. **Timbrature** del personale (Menu: Timbrature).
9. **Bilancia** (vendita a peso). POS: UniCredit collegato con Protocollo 17 dalla v0.8.3; FlatPay a mano.
10. **Menu multilingua / QR al tavolo**, monitor clienti, delivery con rider.

## Da fare al locale (dal 7 dicembre)
- Collaudo RT (Gestione → Stampanti → Collaudo RT): 10 minuti, a cassa chiusa.
- "Prova caratteri" su ogni Matchpower.
- Router 4G di riserva sulla rete del locale.
- Una serata in parallelo con Passepartout prima di spegnerlo.
