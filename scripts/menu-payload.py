#!/usr/bin/env python3
"""Dal JSON di importa-menu.py al formato compatto di importa_menu() (database) e della demo.
Uso: python3 scripts/menu-payload.py replica/menu-moorea.json > packages/core/src/menu-moorea.json"""
import json, sys
d = json.load(open(sys.argv[1]))
C = {c['chiave']: i for i, c in enumerate(d['categorie'])}
VINI = ('Bollicine', 'Bianchi', 'Rosati', 'Rossi', 'Grandi formati')

def descr(a):
    if a['categoria'] in VINI:
        return a['descrizione'].split(' · ')[0] + (f" · {a['gruppo']}" if a.get('gruppo') else '')
    if a['categoria'] == 'Distillati':
        return a.get('gruppo')
    if a['categoria'] in ('Bevande', 'Caffetteria', 'Birre', 'Vini al calice'):
        return None
    return a['descrizione'] or None

CARNE = ['Entrecôte alla Griglia', 'Filetto di Manzo al Pepe Verde e Rosa', 'Costine di Agnello alla Griglia']
# Varianti scritte nel menu del sito (cotture, senza glutine, aggiunte con il loro prezzo).
VARIANTI = [
    ['Cottura', 'al sangue', 0, CARNE], ['Cottura', 'media', 0, CARNE], ['Cottura', 'ben cotta', 0, CARNE],
    ['Senza', 'senza glutine', 0, ['Tartare di Tonno e Avocado', 'Gnocchi alla Genovese', 'Lasagna', 'Entrecôte alla Griglia']],
    ['Senza', 'senza avocado', 0, ['Tartare di Tonno e Avocado']],
    ['Senza', 'gnocchi al pomodoro', 0, ['Gnocchi alla Genovese']],
    ['Senza', 'senza glutine e senza lattosio', 200, ['Delizia al Limone']],
    ['Aggiunte', '+ gelato', 200, ['Tortino dal Cuore Caldo']],
    ['Aggiunte', '+ caffè', 100, ['Gelato Italiano']], ['Aggiunte', '+ cioccolato caldo', 100, ['Gelato Italiano']],
    ['Aggiunte', '+ amarene Fabbri', 100, ['Gelato Italiano']], ['Aggiunte', '+ caramello', 100, ['Gelato Italiano']],
]
nomi = {a['nome'] for a in d['articoli']}
mancanti = [n for v in VARIANTI for n in v[3] if n not in nomi]
if mancanti:
    sys.exit(f'Varianti su piatti non più in menu: {mancanti}')
json.dump({
    'fonte': d['fonte'], 'coperto': d['coperto'],
    'categorie': [[c['nome'], c['colore'], c['reparto'], c['uscita']] for c in d['categorie']],
    'articoli': [[C[a['categoria']], a['nome'], a['prezzo'], a['allergeni'], descr(a)] for a in d['articoli']],
    'varianti': VARIANTI,
}, sys.stdout, ensure_ascii=False, separators=(',', ':'))
