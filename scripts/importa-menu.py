#!/usr/bin/env python3
"""Legge il menu pubblicato su mooreafoodclub.it/menu e produce il listino per la cassa.

Uso:  curl -s https://mooreafoodclub.it/menu -o menu.html
      python3 scripts/importa-menu.py menu.html > replica/menu-moorea.json

Il risultato è un JSON con categorie (nome, colore, reparto, uscita) e articoli
(nome, descrizione, prezzo in centesimi, allergeni, etichette).
"""
import json
import re
import sys
from html.parser import HTMLParser

ALLERGENI = {1: 'glutine', 2: 'crostacei', 3: 'uova', 4: 'pesce', 5: 'arachidi', 6: 'soia', 7: 'latte',
             8: 'frutta_a_guscio', 9: 'sedano', 10: 'senape', 11: 'sesamo', 12: 'solfiti', 13: 'lupini', 14: 'molluschi'}
ETICHETTE = {'Top', 'V', 'VG', 'GF', 'New Entry', '*'}
PREZZO = re.compile(r'^(\d+(?:,\d{1,2})?)€$')

# Categoria in cassa: (nome, colore, reparto, uscita). Le uscite: 0 subito, 1 antipasti, 2 primi, 3 secondi, 9 dolci.
CATEGORIE = {
    'Antipasti': ('Antipasti', '#f4a261', 'cucina', 1),
    'Pasta': ('Pasta', '#f2f4f7', 'cucina', 2),
    'Secondi': ('Secondi', '#e76f51', 'cucina', 3),
    'Contorni': ('Contorni', '#8fd694', 'cucina', 3),
    'Dolci': ('Dolci', '#c9a7eb', 'cucina', 9),
    'Cocktail': ('Cocktail', '#7cc8ff', 'bar', 0),
    'Mocktail': ('Analcolici', '#a3e4d7', 'bar', 0),
    'Distillati': ('Distillati', '#e9c46a', 'bar', 0),
    'Bevande': ('Acqua e bibite', '#a3acba', 'bar', 0),
    'Caffetteria': ('Caffè e tisane', '#d9b38c', 'bar', 9),
    'Birre': ('Birre', '#ffd166', 'bar', 0),
    'Vini al calice': ('Calici e amari', '#d4a5a5', 'bar', 0),
    'Bollicine': ('Bollicine', '#fff1b8', 'bar', 0),
    'Bianchi': ('Vini bianchi', '#f0e6a8', 'bar', 0),
    'Rosati': ('Vini rosati', '#ffb3c7', 'bar', 0),
    'Rossi': ('Vini rossi', '#c97b84', 'bar', 0),
    'Grandi formati': ('Grandi formati', '#b58ac9', 'bar', 0),
}


class Testo(HTMLParser):
    def __init__(self):
        super().__init__()
        self.t, self.salta = [], 0

    def handle_starttag(self, tag, a):
        if tag in ('script', 'style'):
            self.salta += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.salta -= 1

    def handle_data(self, d):
        d = d.strip()
        if d and not self.salta:
            self.t.append(d)


def cents(s):
    return round(float(s.replace(',', '.')) * 100)


def pulisci_legenda(blocco):
    """Toglie legenda V/VG/GF, tabella allergeni e note di fondo che si ripetono dopo ogni sezione."""
    out, i = [], 0
    while i < len(blocco):
        if blocco[i] == 'V —':
            # salta fino alla nota finale della sezione
            j = i
            while j < len(blocco) and not blocco[j].startswith('Elenco allergeni'):
                j += 1
            j += 1
            if j < len(blocco) and blocco[j] == '*':
                j += 2
            i = j
            continue
        out.append(blocco[i])
        i += 1
    return out


def cucina(t):
    sezioni = ['Antipasti', 'Pasta', 'Secondi', 'Contorni', 'Dolci']
    inizio = t.index('Dolci') + 1  # dopo la barra delle schede
    fine = t.index('Cocktails')
    blocco = pulisci_legenda(t[inizio:fine])
    articoli, sez, cur = [], None, []
    for tok in blocco:
        if tok in sezioni and not cur:
            sez = tok
            continue
        cur.append(tok)
        if PREZZO.match(tok):
            nome, resto = cur[0], cur[1:-1]
            etichette = [x for x in resto if x in ETICHETTE]
            allergeni = []
            if 'Allergeni' in resto:
                k = resto.index('Allergeni')
                codici = resto[k + 2] if k + 2 < len(resto) else ''
                allergeni = [ALLERGENI[int(c)] for c in re.findall(r'\d+', codici)]
                resto = resto[:k] + resto[k + 3:]
            descr = [x for x in resto if x not in ETICHETTE and x != 'Vedi foto']
            articoli.append({
                'categoria': sez, 'nome': nome, 'descrizione': '. '.join(x.rstrip('.') for x in descr) + ('.' if len(descr) > 1 else ''), 'prezzo': cents(PREZZO.match(tok)[1]),
                'allergeni': allergeni, 'etichette': [e for e in etichette if e != '*'], 'abbattuto': '*' in etichette,
            })
            cur = []
    return articoli


def cocktail(t):
    a, i = [], t.index('Special') + 1
    prezzo_special = cents(PREZZO.match(t[i])[1]); i += 1
    fine_special = t.index('Classici')
    while i < fine_special:
        nome = t[i]; i += 1
        etichette = []
        while t[i] in ETICHETTE:
            etichette.append(t[i]); i += 1
        a.append({'categoria': 'Cocktail', 'nome': nome, 'descrizione': t[i], 'prezzo': prezzo_special, 'allergeni': [], 'etichette': etichette})
        i += 1
    i = fine_special + 1
    fine = t.index('Mocktail – Senza Alcol')
    while i < fine:
        a.append({'categoria': 'Cocktail', 'nome': t[i], 'descrizione': t[i + 1], 'prezzo': cents(PREZZO.match(t[i + 2])[1]), 'allergeni': [], 'etichette': []})
        i += 3
    i = fine + 1
    prezzo_mock = cents(PREZZO.match(t[i])[1]); i += 1
    fine = t.index('Spirits')
    while i < fine:
        # Stesso nome di un cocktail (Aperol Spritz, Gin Tonic…): in cassa serve distinguerli.
        nome = t[i] if not any(x['nome'] == t[i] for x in a) else f'{t[i]} 0.0'
        a.append({'categoria': 'Mocktail', 'nome': nome, 'descrizione': t[i + 1], 'prezzo': prezzo_mock, 'allergeni': [], 'etichette': []})
        i += 2
    return a


def distillati(t):
    a, gruppo = [], None
    i, fine = t.index('Spirits') + 1, t.index('Bevande')
    while i < fine:
        tok = t[i]
        if tok.startswith('Tutti i drink'):
            break
        if i + 1 < fine and not PREZZO.match(t[i + 1]) and not t[i + 1].startswith(('28€',)):
            gruppo = tok; i += 1; continue
        prezzo = t[i + 1]
        if PREZZO.match(prezzo):
            a.append({'categoria': 'Distillati', 'nome': f'{tok}', 'gruppo': gruppo, 'descrizione': gruppo, 'prezzo': cents(PREZZO.match(prezzo)[1]), 'allergeni': [], 'etichette': []})
        else:  # Clase Azul: "28€ (3cl) · 50€ (6cl)"
            for p, ml in re.findall(r'(\d+)€ \((\d+cl)\)', prezzo):
                a.append({'categoria': 'Distillati', 'nome': f'{tok} {ml}', 'gruppo': gruppo, 'descrizione': gruppo, 'prezzo': int(p) * 100, 'allergeni': [], 'etichette': []})
        i += 2
    return a


def bevande(t):
    mappa = {'Acqua': 'Bevande', 'Soft Drink': 'Bevande', 'Caffetteria': 'Caffetteria', 'Tisane & Tè': 'Caffetteria',
             'Vino al Calice': 'Vini al calice', 'Birra alla Spina': 'Birre', 'Birra in Bottiglia': 'Birre',
             "Birra N'Artigiana": 'Birre', 'Amari': 'Vini al calice'}
    a, gruppo = [], None
    i, fine = t.index('Bevande') + 1, t.index('Carta dei Vini')
    while i < fine:
        tok = t[i]
        if tok in mappa and not PREZZO.match(t[i + 1]):
            gruppo = tok; i += 1; continue
        if tok in mappa and PREZZO.match(t[i + 1]) and tok == 'Vino al Calice':
            pass
        nome = tok
        if gruppo == "Birra N'Artigiana":
            nome = f"N'Artigiana {tok}"
        allergeni = ['glutine'] if gruppo and gruppo.startswith('Birra') and 'Gluten Free' not in tok else []
        a.append({'categoria': mappa[gruppo], 'nome': nome, 'gruppo': gruppo, 'descrizione': gruppo, 'prezzo': cents(PREZZO.match(t[i + 1])[1]), 'allergeni': allergeni, 'etichette': []})
        i += 2
    return a


def vini(t):
    a = []
    i, fine = t.index('Azzera filtri') + 1, t.index('Dove siamo', t.index('Azzera filtri'))
    gruppo = None
    while i < fine:
        tok = t[i]
        if ' – ' in tok and tok.split(' – ')[0] in ('Bollicine', 'Bianchi', 'Rosati', 'Rossi') or tok == 'Grandi Formati':
            gruppo = tok; i += 1; continue
        nome = tok; i += 1
        etichette = []
        while t[i] in ETICHETTE:
            etichette.append(t[i]); i += 1
        uvaggio = t[i]; i += 1
        note = []
        while not PREZZO.match(t[i]):
            note.append(t[i]); i += 1
        prezzo = cents(PREZZO.match(t[i])[1]); i += 1
        tipo = 'Grandi formati' if gruppo == 'Grandi Formati' else gruppo.split(' – ')[0]
        zona = None if gruppo == 'Grandi Formati' else gruppo.split(' – ')[1]
        a.append({'categoria': tipo, 'nome': nome, 'gruppo': zona, 'descrizione': f'{uvaggio} · ' + ', '.join(note).lower(),
                  'prezzo': prezzo, 'allergeni': [], 'etichette': etichette})
    return a


def main():
    p = Testo()
    p.feed(open(sys.argv[1], encoding='utf-8').read())
    t = p.t
    articoli = cucina(t) + cocktail(t) + distillati(t) + bevande(t) + vini(t)
    usate = []
    for x in articoli:
        if x['categoria'] not in usate:
            usate.append(x['categoria'])
    categorie = [{'chiave': c, 'nome': CATEGORIE[c][0], 'colore': CATEGORIE[c][1], 'reparto': CATEGORIE[c][2], 'uscita': CATEGORIE[c][3], 'ordine': i + 1}
                 for i, c in enumerate(usate)]
    coperto = next((cents(m[1]) for x in t if (m := re.search(r'Coperto - (\d+)€', x))), None)
    nomi = [x['nome'] for x in articoli]
    doppi = {n for n in nomi if nomi.count(n) > 1}
    if doppi:
        sys.exit(f'Nomi doppi nel menu: {doppi}')
    json.dump({'fonte': 'https://mooreafoodclub.it/menu', 'coperto': coperto, 'categorie': categorie, 'articoli': articoli},
              sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
